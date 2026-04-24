import { prisma } from "@/lib/prisma";
import { normalizeEmployeeCode } from "@/lib/business/disciplinary";
import { normalizeHeaderKey } from "@/lib/import/xlsx-read";

export type EmployeeMasterImportResult = {
  rowsProcessed: number;
  upserted: number;
  errors: { row: number; message: string }[];
};

function stripBom(s: string): string {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

function detectDelimiter(headerLine: string): ";" | "," {
  const semi = (headerLine.match(/;/g) || []).length;
  const comma = (headerLine.match(/,/g) || []).length;
  return semi >= comma ? ";" : ",";
}

/** Parser CSV mínimo (comillas dobles, delimitador ; o ,). */
function parseCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (c === delim && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function emptyToNull(v: string | undefined): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function pickHeader(headers: Record<string, number>, ...aliases: string[]): number | undefined {
  for (const a of aliases) {
    const k = normalizeHeaderKey(a);
    const idx = headers[k];
    if (idx !== undefined) return idx;
  }
  return undefined;
}

/**
 * Importa maestro de empleados (CSV RRHH). Upsert por código normalizado.
 * Columnas reconocidas (cualquier orden, encabezados flexibles):
 * código, nombre, cédula, correo/email, zona, teléfono, cuenta bancaria / IBAN.
 */
export async function importDisciplinaryEmployeeMasterCsv(
  text: string,
  sourceFilename: string,
): Promise<EmployeeMasterImportResult> {
  const raw = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n").map((l) => l.trimEnd());
  const nonEmpty = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (nonEmpty.length < 2) {
    return { rowsProcessed: 0, upserted: 0, errors: [{ row: 1, message: "El CSV no tiene datos" }] };
  }

  const delim = detectDelimiter(nonEmpty[0]);
  const headerCells = parseCsvLine(nonEmpty[0], delim);
  const headers: Record<string, number> = {};
  headerCells.forEach((h, i) => {
    const k = normalizeHeaderKey(h);
    if (k) headers[k] = i;
  });

  const idxCodigo = pickHeader(
    headers,
    "Empleado",
    "Código",
    "Codigo",
    "Código Empleado",
    "Codigo Empleado",
    "ID Empleado",
    "ID",
    "No Empleado",
    "No. Empleado",
  );
  /** "Nombre" antes que "Empleado": en planillas como RRHH/PJ, "Empleado" es el código numérico. */
  const idxNombre = pickHeader(headers, "Nombre", "Nombre Completo", "Funcionario", "Nombre y Apellidos", "Empleado");
  const idxEmail = pickHeader(headers, "Email", "Correo", "Correo Electrónico", "Correo Electronico", "E-mail");
  const idxCedula = pickHeader(
    headers,
    "Cédula",
    "Cedula",
    "Identificación",
    "Identificacion",
    "No Identificación",
    "No Identificacion",
    "Número Identificación",
    "Numero Identificacion",
    "Documento Identidad",
    "Cédula Física",
    "Cedula Fisica",
  );
  const idxZona = pickHeader(headers, "Zona", "Región", "Region", "Área", "Area");
  const idxTel = pickHeader(headers, "Teléfono", "Telefono", "Celular", "Móvil", "Movil", "Phone");
  const idxCuenta = pickHeader(
    headers,
    "Cuenta Bancaria",
    "Numero Cuenta",
    "Número Cuenta",
    "Cuenta",
    "IBAN",
    "Cuenta IBAN",
    "No Cuenta",
    "Número de cuenta",
    "Numero de cuenta",
  );

  if (idxCodigo === undefined) {
    return {
      rowsProcessed: 0,
      upserted: 0,
      errors: [
        {
          row: 1,
          message:
            'No se encontró columna de código (ej. "Empleado", "Código", "ID Empleado"). Revise la fila de encabezados.',
        },
      ],
    };
  }

  const errors: EmployeeMasterImportResult["errors"] = [];
  let upserted = 0;

  for (let r = 1; r < nonEmpty.length; r++) {
    const rowNum = r + 1; // 1-based incl. header
    const cells = parseCsvLine(nonEmpty[r], delim);
    const codigoRaw = cells[idxCodigo] ?? "";
    const codigo = normalizeEmployeeCode(codigoRaw);
    if (!codigo) {
      const allEmpty = cells.every((c) => !String(c).trim());
      if (allEmpty) continue;
      errors.push({ row: rowNum, message: "Código de empleado vacío o inválido" });
      continue;
    }

    const nombre = idxNombre !== undefined ? emptyToNull(cells[idxNombre]) : null;
    const cedula = idxCedula !== undefined ? emptyToNull(cells[idxCedula]) : null;
    const email = idxEmail !== undefined ? emptyToNull(cells[idxEmail]) : null;
    const zona = idxZona !== undefined ? emptyToNull(cells[idxZona]) : null;
    const telefono = idxTel !== undefined ? emptyToNull(cells[idxTel]) : null;
    const cuentaBancaria = idxCuenta !== undefined ? emptyToNull(cells[idxCuenta]) : null;

    const extra: Record<string, string> = {};
    headerCells.forEach((h, i) => {
      const key = normalizeHeaderKey(h);
      if (!key) return;
      if (
        [idxCodigo, idxNombre, idxCedula, idxEmail, idxZona, idxTel, idxCuenta].includes(i)
      ) {
        return;
      }
      const v = emptyToNull(cells[i]);
      if (v) extra[h.trim()] = v;
    });

    try {
      await prisma.disciplinaryEmployeeMaster.upsert({
        where: { codigoEmpleado: codigo },
        create: {
          codigoEmpleado: codigo,
          codigoEmpleadoRaw: emptyToNull(codigoRaw),
          nombre,
          cedula,
          email,
          zona,
          telefono,
          cuentaBancaria,
          extra: Object.keys(extra).length ? extra : undefined,
          lastSourceFilename: sourceFilename.slice(0, 200),
        },
        update: {
          codigoEmpleadoRaw: emptyToNull(codigoRaw) ?? undefined,
          ...(nombre !== null ? { nombre } : {}),
          ...(cedula !== null ? { cedula } : {}),
          ...(email !== null ? { email } : {}),
          ...(zona !== null ? { zona } : {}),
          ...(telefono !== null ? { telefono } : {}),
          ...(cuentaBancaria !== null ? { cuentaBancaria } : {}),
          ...(Object.keys(extra).length ? { extra } : {}),
          lastSourceFilename: sourceFilename.slice(0, 200),
        },
      });
      upserted++;
    } catch (e) {
      errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : "Error al guardar fila",
      });
    }
  }

  return { rowsProcessed: nonEmpty.length - 1, upserted, errors };
}
