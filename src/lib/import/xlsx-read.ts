import * as XLSX from "xlsx";

export type ReadSheetOptions = {
  /** Si existe una hoja con este nombre (sin distinguir mayúsculas), se usa en lugar de la primera. */
  preferredName?: string;
};

function pickSheetName(sheetNames: string[], preferredName?: string): string | undefined {
  if (preferredName) {
    const want = preferredName.trim().toLowerCase();
    const found = sheetNames.find((n) => n.trim().toLowerCase() === want);
    if (found) return found;
  }
  return sheetNames[0];
}

/** Hoja de trabajo → filas como objetos usando la fila 1 como encabezados. */
export function readFirstSheetAsObjects(
  buffer: ArrayBuffer,
  opts?: ReadSheetOptions
): Record<string, unknown>[] {
  // raw: true conserva números seriales y Date; raw: false suele formatear fechas a texto local que no siempre parseamos.
  const wb = XLSX.read(buffer, { type: "array", cellDates: true, raw: true });
  const name = pickSheetName(wb.SheetNames, opts?.preferredName);
  if (!name) return [];
  const sheet = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  return rows;
}

/**
 * Lee múltiples hojas de un mismo workbook. Para cada nombre lógico solicitado
 * intenta encontrar la hoja por alias (case-insensitive). Devuelve `null` para
 * hojas no encontradas para que el caller decida si son obligatorias.
 *
 * Ejemplo:
 *   readSheetsByAliases(buf, { historial: ["Historial"], stats: ["Estadisticas", "Estadísticas", "Tratamiento"] })
 */
export function readSheetsByAliases<K extends string>(
  buffer: ArrayBuffer,
  aliases: Record<K, string[]>,
): Record<K, Record<string, unknown>[] | null> {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true, raw: true });
  const out = {} as Record<K, Record<string, unknown>[] | null>;
  for (const key of Object.keys(aliases) as K[]) {
    const candidates = aliases[key];
    let sheetName: string | undefined;
    for (const c of candidates) {
      const want = c.trim().toLowerCase();
      const found = wb.SheetNames.find((n) => n.trim().toLowerCase() === want);
      if (found) {
        sheetName = found;
        break;
      }
    }
    if (!sheetName) {
      out[key] = null;
      continue;
    }
    const sheet = wb.Sheets[sheetName];
    out[key] = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: true,
    });
  }
  return out;
}

/** Normaliza claves de encabezado para buscar alias (minúsculas, sin acentos, espacios → _). */
export function normalizeHeaderKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** Convierte fila con cualquier encabezado a mapa por clave normalizada. */
export function rowToNormalized(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[normalizeHeaderKey(k)] = v;
  }
  return out;
}

export function pickCell(norm: Record<string, unknown>, aliases: string[]): unknown {
  for (const a of aliases) {
    const key = normalizeHeaderKey(a);
    const v = norm[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (v instanceof Date) return v;
    if (String(v).trim() !== "") return v;
  }
  return undefined;
}

/**
 * Convierte texto numérico con formato local (CR/España: miles con punto, decimales con coma)
 * o US. Guion solo = 0.
 */
function parseLocaleNumberString(raw: string): number | null {
  let s = raw.replace(/\s/g, "").trim();
  if (!s) return null;
  if (/^[-–—]$/.test(s)) return 0;

  const commaIdx = s.lastIndexOf(",");
  const dotIdx = s.lastIndexOf(".");

  // Coma es separador decimal (última coma después del último punto, o única coma)
  if (commaIdx !== -1 && (dotIdx === -1 || commaIdx > dotIdx)) {
    const intPart = s.slice(0, commaIdx).replace(/\./g, "");
    const decPart = s.slice(commaIdx + 1).replace(/[^\d]/g, "");
    if (!/^\d+$/.test(decPart)) return null;
    const n = parseFloat(`${intPart}.${decPart}`);
    return Number.isNaN(n) ? null : n;
  }

  // Punto decimal estilo US y miles con coma: 1,234,567.89
  if (dotIdx !== -1 && commaIdx !== -1 && dotIdx > commaIdx) {
    const n = parseFloat(s.replace(/,/g, ""));
    return Number.isNaN(n) ? null : n;
  }

  // Solo puntos: 2.106.214 (miles repetidos) vs 2106214.91 (un decimal)
  if (dotIdx !== -1 && commaIdx === -1) {
    const dots = (s.match(/\./g) || []).length;
    if (dots > 1) {
      const n = parseFloat(s.replace(/\./g, ""));
      return Number.isNaN(n) ? null : n;
    }
    const n = parseFloat(s);
    return Number.isNaN(n) ? null : n;
  }

  // Solo comas como miles: 2,106,214
  if (commaIdx !== -1 && dotIdx === -1) {
    const commas = (s.match(/,/g) || []).length;
    if (commas > 1) {
      const n = parseFloat(s.replace(/,/g, ""));
      return Number.isNaN(n) ? null : n;
    }
    const n = parseFloat(s.replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }

  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/** Porcentaje en Excel: 0.08, 8, "8%", "8", "8,5%", "3,0" (coma decimal) → número 0–1 */
export function parsePercent(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number" && !Number.isNaN(v)) {
    if (v > 1 && v <= 100) return v / 100;
    return v;
  }
  const withoutPct = String(v).trim().replace(/%/g, "").trim();
  const n = parseLocaleNumberString(withoutPct);
  if (n === null || Number.isNaN(n)) return null;
  if (n > 1 && n <= 100) return n / 100;
  return n;
}

/**
 * Número desde Excel: formatos CR (₡ 2.106.214,91), US, guion como 0, fórmulas =a+b.
 */
export function parseNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;

  let s = String(v).trim();
  s = s.replace(/₡/g, "").replace(/[\s\u00A0\u202F]/g, "");
  s = s.replace(/\b(crc|colones?)\b/gi, "");

  // Excel a veces entrega la fórmula como texto: =12133580,45+9110729,66
  if (s.startsWith("=")) {
    const inner = s.slice(1).replace(/\s/g, "");
    const terms = inner.split(/[+]/).filter(Boolean);
    if (terms.length >= 2) {
      let sum = 0;
      for (const t of terms) {
        const n = parseLocaleNumberString(t);
        if (n === null) return null;
        sum += n;
      }
      return sum;
    }
    return parseLocaleNumberString(inner);
  }

  return parseLocaleNumberString(s);
}

function excelSerialToYmd(serialWhole: number): string | null {
  if (serialWhole < 200 || serialWhole > 200000) return null;
  const epoch = new Date(1899, 11, 30);
  const dt = new Date(epoch.getTime() + serialWhole * 86400000);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  if (y < 1900 || y > 2200) return null;
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Mes abreviado o nombre en español (Excel regional) → "01"…"12". */
function monthEsTokenToMm(token: string): string | null {
  const k = token
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .slice(0, 3);
  const map: Record<string, string> = {
    ene: "01",
    feb: "02",
    mar: "03",
    abr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    ago: "08",
    sep: "09",
    set: "09",
    oct: "10",
    nov: "11",
    dic: "12",
  };
  return map[k] ?? null;
}

/** Fecha: serial Excel, Date, o string YYYY-MM-DD / D/M/YYYY (y variantes con hora). */
export function parseDateCell(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number" && !Number.isNaN(v)) {
    const serial = Math.floor(Math.abs(v));
    const ymd = excelSerialToYmd(serial);
    if (ymd) return ymd;
  }
  let s = String(v)
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .replace(/[\s\u00A0\u202F]+/g, " ");
  // Celda de fecha guardada como texto con serial (p. ej. "44927" o "44927,5" con decimal regional).
  if (/^\d{5,7}([.,]\d+)?$/.test(s)) {
    const n = Math.floor(Number.parseFloat(s.replace(",", ".")));
    const ymd = excelSerialToYmd(n);
    if (ymd) return ymd;
  }
  const isoHead = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoHead) return isoHead[1];
  // "4/1/2023 0:00:00", "4/1/202312:00:00 a. m.", etc.
  const datePart = s.split(/\s+/)[0].split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const m1 = datePart.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m1) {
    const dd = m1[1].padStart(2, "0");
    const mm = m1[2].padStart(2, "0");
    return `${m1[3]}-${mm}-${dd}`;
  }
  const m2 = datePart.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
  if (m2) {
    let yy = Number.parseInt(m2[3], 10);
    yy += yy >= 70 ? 1900 : 2000;
    const dd = m2[1].padStart(2, "0");
    const mm = m2[2].padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }
  // 4-ene-2023, 04/ene/2024, 1-ene-25 (mes en letras, típico de Excel en español)
  const m3 = datePart.match(
    /^(\d{1,2})[\/\-.]([a-zA-Z\u00f1\u00d1\u00fc\u00dc\u00e1\u00e9\u00ed\u00f3\u00fa\u00c1\u00c9\u00cd\u00d3\u00da.]+)[\/\-.](\d{4}|\d{2})$/i
  );
  if (m3) {
    const mm = monthEsTokenToMm(m3[2]);
    if (mm) {
      let yy = Number.parseInt(m3[3], 10);
      if (m3[3].length === 2) yy += yy >= 70 ? 1900 : 2000;
      if (yy >= 1900 && yy <= 2200) {
        const dd = m3[1].padStart(2, "0");
        return `${yy}-${mm}-${dd}`;
      }
    }
  }
  return null;
}
