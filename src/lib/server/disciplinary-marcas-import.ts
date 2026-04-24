import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import {
  pickCell,
  rowToNormalized,
  readFirstSheetAsObjects,
  parseDateCell,
  normalizeHeaderKey,
} from "@/lib/import/xlsx-read";
import {
  calculateVigencia,
  normalizeEmployeeCode,
  normalizeLicitacion,
  parseDisciplinaryStatus,
  parseOmisionesEntries,
  type OmisionEntry,
} from "@/lib/business/disciplinary";
import { pickPuntoOmitidoFromRow } from "@/lib/business/disciplinary-punto-omitido";
import { DuplicateImportError } from "@/lib/server/disciplinary-import";
import { buildOmisionPdfBytes } from "@/lib/server/disciplinary-omision-pdf";
import { loadBrandingLogoFile, loadDisciplinarySignatureFile } from "@/lib/server/disciplinary-pdf-logo";
import { createSmtpTransport, getSmtpConfig } from "@/lib/server/disciplinary-smtp";
import { mergeDisciplinaryCc, sendDisciplinaryOmisionEmail } from "@/lib/server/disciplinary-email";
import {
  allocateNextApercibimientoNumero,
  ensureDisciplinarySettingsRow,
  renderMailTemplate,
} from "@/lib/server/disciplinary-settings";
import {
  loadZoneDisciplinaryDefaultsMap,
  mergeDefaultsForZoneTexts,
  mergeZoneDisciplinaryDefaults,
} from "@/lib/server/disciplinary-zone-defaults";

export type MarcasImportResult = {
  batchId: string;
  rowsSheet: number;
  apercibimientosInserted: number;
  omisionesInserted: number;
  emailsSent: number;
  emailsSkipped: number;
  errors: { row: number; message: string }[];
};

export type MarcasPlannedRow = {
  codigo: string;
  nombre: string;
  cedula: string | null;
  /** Zona por defecto: maestro RRHH, si no hay, la del Excel. */
  zona: string | null;
  /** Zona en maestro (solo referencia en UI). */
  zonaMaestro: string | null;
  /** Zona leída del Excel (solo referencia en UI). */
  zonaExcel: string | null;
  sucursal: string | null;
  administrador: string | null;
  emailEmpleado: string | null;
  emailCcZona: string | null;
  omisionesCount: number;
  omisionesResumen: string;
  fechaEmision: string;
  numeroPreliminar: string;
  estado: string;
  vigencia: string;
};

export type MarcasPreviewResult = {
  checksum: string;
  rowsSheet: number;
  inspeccionMode: boolean;
  planned: MarcasPlannedRow[];
  wouldInsert: number;
  wouldSkipOmisiones: number;
  errors: { row: number; message: string }[];
};

type MarcasEmployeeGroup = {
  codigo: string;
  codigoRaw: string | null;
  nombreExcel: string | null;
  zona: string | null;
  sucursal: string | null;
  contrato: string | null;
  administrador: string | null;
  estadoRaw: unknown;
  fechaEmisionCandidates: Date[];
  omisiones: OmisionEntry[];
  rowNumbers: number[];
};

function sha256Hex(buffer: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

function emptyToNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function toDateOrNull(v: unknown): Date | null {
  const ymd = parseDateCell(v);
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function sortOmisiones(entries: OmisionEntry[]): OmisionEntry[] {
  return [...entries].sort((a, b) => {
    const dt = a.fecha.getTime() - b.fecha.getTime();
    if (dt !== 0) return dt;
    if (!a.hora && !b.hora) return 0;
    if (!a.hora) return -1;
    if (!b.hora) return 1;
    return a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : 0;
  });
}

function mergeFirst<T>(current: T | null | undefined, next: T | null | undefined): T | null | undefined {
  if (current !== null && current !== undefined && String(current).trim() !== "") return current;
  return next;
}

export type MarcasZoneOverrideRow = {
  zona?: string;
  sucursal?: string;
};

function effectiveZonaSucursalForMarcas(
  g: MarcasEmployeeGroup,
  master: { zona: string | null | undefined } | undefined,
  overrides: Record<string, MarcasZoneOverrideRow> | undefined,
): { zona: string | null; sucursal: string | null } {
  const o = overrides?.[g.codigo];
  const baseZona = mergeFirst(master?.zona ?? null, g.zona) as string | null;
  const baseSucursal = g.sucursal;
  const zona =
    o && typeof o.zona === "string" ? (o.zona.trim() ? o.zona.trim() : null) : baseZona;
  const sucursal =
    o && typeof o.sucursal === "string"
      ? o.sucursal.trim()
        ? o.sucursal.trim()
        : null
      : baseSucursal;
  return { zona, sucursal };
}

/**
 * Fecha de emisión del apercibimiento (documento): columna «Fecha Emisión» del Excel si existe;
 * si no, `fallbackEmision` (fecha del lote al importar o «hoy» en vista previa). No usar la fecha de la omisión.
 */
function resolveFechaEmisionDocumento(candidates: Date[], fallbackEmision: Date): Date {
  if (candidates.length > 0) {
    return candidates.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  }
  return fallbackEmision;
}

const CR_TZ = "America/Costa_Rica";

/** Export tipo «detalle de inspecciones»: Estado = No Realizada, Usr Marca = CODIGO-NOMBRE */
function sheetLooksLikeInspeccionDetalle(sampleRow: Record<string, unknown>): boolean {
  if (!sampleRow || Object.keys(sampleRow).length === 0) return false;
  const keys = new Set(Object.keys(sampleRow).map((k) => normalizeHeaderKey(k)));
  return keys.has("usr_marca") && keys.has("estado");
}

function isEstadoMarcaNoRealizada(raw: unknown): boolean {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!s) return false;
  if (s === "realizada") return false;
  return s.includes("no real");
}

function parseUsrMarca(raw: unknown): { codigo: string; codigoRaw: string; nombre: string } | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d+)\s*-\s*(.+)$/);
  if (!m) return null;
  const codigoRaw = m[1];
  const codigo = normalizeEmployeeCode(codigoRaw);
  if (!codigo) return null;
  return { codigo, codigoRaw, nombre: m[2].trim() };
}

/** Fecha/hora de la marca programada en zona horaria CR (columna Fec Marca). */
function fecMarcaToOmisionEntry(fecRaw: unknown, puntoOmitido?: string | null): OmisionEntry | null {
  if (fecRaw === null || fecRaw === undefined || fecRaw === "") return null;
  const d = fecRaw instanceof Date ? fecRaw : new Date(String(fecRaw));
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: CR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const g = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value;
  const y = Number(g("year"));
  const mo = Number(g("month"));
  const day = Number(g("day"));
  const hh = (g("hour") ?? "00").padStart(2, "0");
  const mm = (g("minute") ?? "00").padStart(2, "0");
  const fecha = new Date(y, mo - 1, day);
  if (Number.isNaN(fecha.getTime())) return null;
  const pt = puntoOmitido?.trim() || null;
  return { fecha, hora: `${hh}:${mm}`, puntoOmitido: pt };
}

function omisionDedupeKey(o: OmisionEntry): string {
  const p = (o.puntoOmitido ?? "").trim();
  return `${o.fecha.getFullYear()}-${o.fecha.getMonth()}-${o.fecha.getDate()}-${o.hora ?? ""}-${p}`;
}

/**
 * Elige la hoja útil del libro: muchos archivos traen «Hoja1» como tabla dinámica (solo totales por
 * ubicación) y otra hoja con el detalle (`Usr Marca`, `Estado`, `Fec Marca`). Se prioriza la que
 * tenga más filas «No Realizada».
 */
function selectRowsForMarcasImport(buffer: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true, raw: true });
  let best: { rows: Record<string, unknown>[]; missed: number } | null = null;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
    if (rows.length === 0) continue;
    if (!sheetLooksLikeInspeccionDetalle(rows[0])) continue;

    let missed = 0;
    for (const raw of rows) {
      const est = pickCell(rowToNormalized(raw), ["Estado"]);
      if (isEstadoMarcaNoRealizada(est)) missed++;
    }
    const score = missed * 1_000_000 + rows.length;
    const bestScore = best ? best.missed * 1_000_000 + best.rows.length : -1;
    if (score > bestScore) best = { rows, missed };
  }

  if (best) return best.rows;
  return readFirstSheetAsObjects(buffer);
}

function summarizeOmisiones(sorted: OmisionEntry[], maxShow: number): string {
  const parts = sorted.slice(0, maxShow).map((o) => {
    const d = format(o.fecha, "dd/MM/yyyy", { locale: es });
    const h = o.hora?.trim() ? ` ${o.hora}` : "";
    const p = o.puntoOmitido?.trim() ? ` (${o.puntoOmitido.trim()})` : "";
    return `${d}${h}${p}`;
  });
  const more = sorted.length > maxShow ? ` (+${sorted.length - maxShow})` : "";
  return parts.join(", ") + more;
}

function parseMarcasWorkbookToGroups(buffer: ArrayBuffer): {
  sheetRows: Record<string, unknown>[];
  inspeccionMode: boolean;
  groups: Map<string, MarcasEmployeeGroup>;
  errors: { row: number; message: string }[];
} {
  const sheetRows = selectRowsForMarcasImport(buffer);
  const errors: { row: number; message: string }[] = [];
  const inspeccionMode = sheetRows.length > 0 && sheetLooksLikeInspeccionDetalle(sheetRows[0]);
  const groups = new Map<string, MarcasEmployeeGroup>();

  if (inspeccionMode) {
    let missedRows = 0;
    for (let i = 0; i < sheetRows.length; i++) {
      const sheetRow = i + 2;
      const raw = sheetRows[i];
      const norm = rowToNormalized(raw);
      const estadoVal = pickCell(norm, ["Estado"]);
      if (!isEstadoMarcaNoRealizada(estadoVal)) continue;
      missedRows++;

      const usr = pickCell(norm, ["Usr Marca", "USR Marca", "Usuario Marca", "User Marca"]);
      const parsed = parseUsrMarca(usr);
      if (!parsed) {
        errors.push({
          row: sheetRow,
          message: `Marca no realizada: «Usr Marca» vacío o no reconocido (espere CODIGO-NOMBRE): ${String(usr).slice(0, 80)}`,
        });
        continue;
      }

      const om = fecMarcaToOmisionEntry(
        pickCell(norm, ["Fec Marca", "Fec. Marca", "Fecha Marca"]),
        pickPuntoOmitidoFromRow(norm),
      );
      if (!om) {
        errors.push({ row: sheetRow, message: "Marca no realizada sin «Fec Marca» válida" });
        continue;
      }

      let g = groups.get(parsed.codigo);
      if (!g) {
        g = {
          codigo: parsed.codigo,
          codigoRaw: parsed.codigoRaw,
          nombreExcel: parsed.nombre,
          zona: emptyToNull(pickCell(norm, ["Ubicacion", "Ubicación", "Zona"])),
          sucursal: emptyToNull(pickCell(norm, ["Sucursal"])),
          contrato: null,
          administrador: emptyToNull(pickCell(norm, ["Administrador", "Admin"])),
          estadoRaw: estadoVal,
          fechaEmisionCandidates: [],
          omisiones: [],
          rowNumbers: [],
        };
        groups.set(parsed.codigo, g);
      } else {
        g.nombreExcel = mergeFirst(g.nombreExcel, parsed.nombre) as string | null;
        g.zona = mergeFirst(g.zona, emptyToNull(pickCell(norm, ["Ubicacion", "Ubicación", "Zona"]))) as string | null;
        g.sucursal = mergeFirst(g.sucursal, emptyToNull(pickCell(norm, ["Sucursal"]))) as string | null;
        g.administrador = mergeFirst(g.administrador, emptyToNull(pickCell(norm, ["Administrador", "Admin"]))) as string | null;
      }
      g.rowNumbers.push(sheetRow);

      const dk = omisionDedupeKey(om);
      const already = new Set(g.omisiones.map(omisionDedupeKey));
      if (!already.has(dk)) g.omisiones.push(om);
    }

    if (missedRows === 0) {
      errors.push({
        row: 1,
        message:
          "El archivo parece un detalle de inspecciones pero no hay filas con Estado «No Realizada». " +
          "Si solo ve totales por ubicación, use la hoja de detalle (ej. «…detalle_de_inspecciones…»).",
      });
    }
  } else {
    let sheetRow = 2;
    for (const raw of sheetRows) {
      const norm = rowToNormalized(raw);
      const codigoRaw = pickCell(norm, [
        "Código",
        "Codigo",
        "Código Empleado",
        "Codigo Empleado",
        "ID Empleado",
        "ID",
        "No Empleado",
        "No. Empleado",
        "Empleado",
      ]);
      const nombreRaw = pickCell(norm, ["Nombre", "Nombre Empleado", "Funcionario", "Nombre Completo"]);
      if (!codigoRaw && !nombreRaw) {
        sheetRow++;
        continue;
      }

      const codigo = normalizeEmployeeCode(codigoRaw);
      if (!codigo) {
        errors.push({ row: sheetRow, message: "Código de empleado vacío o inválido" });
        sheetRow++;
        continue;
      }

      let g = groups.get(codigo);
      if (!g) {
        g = {
          codigo,
          codigoRaw: emptyToNull(codigoRaw),
          nombreExcel: emptyToNull(nombreRaw),
          zona: emptyToNull(pickCell(norm, ["Zona"])),
          sucursal: emptyToNull(pickCell(norm, ["Sucursal"])),
          contrato: emptyToNull(
            pickCell(norm, [
              "Contrato",
              "Contrato/Licitación",
              "Licitación",
              "Licitacion",
              "N° Licitación",
              "No Licitacion",
            ]),
          ),
          administrador: emptyToNull(pickCell(norm, ["Administrador", "Admin"])),
          estadoRaw: pickCell(norm, ["Estado"]),
          fechaEmisionCandidates: [],
          omisiones: [],
          rowNumbers: [],
        };
        groups.set(codigo, g);
      } else {
        g.nombreExcel = mergeFirst(g.nombreExcel, emptyToNull(nombreRaw)) as string | null;
        g.zona = mergeFirst(g.zona, emptyToNull(pickCell(norm, ["Zona"]))) as string | null;
        g.sucursal = mergeFirst(g.sucursal, emptyToNull(pickCell(norm, ["Sucursal"]))) as string | null;
        g.contrato = mergeFirst(g.contrato, emptyToNull(pickCell(norm, ["Contrato", "Licitación", "Licitacion"]))) as string | null;
        g.administrador = mergeFirst(g.administrador, emptyToNull(pickCell(norm, ["Administrador", "Admin"]))) as string | null;
        if (!g.estadoRaw) g.estadoRaw = pickCell(norm, ["Estado"]);
      }

      g.rowNumbers.push(sheetRow);

      const feEmision = toDateOrNull(
        pickCell(norm, ["Fecha Emisión", "Fecha Emision", "Fecha de Emisión", "Fecha de emisión"]),
      );
      if (feEmision) g.fechaEmisionCandidates.push(feEmision);

      let omEntries = parseOmisionesEntries(
        pickCell(norm, [
          "Fecha de Omisión",
          "Fecha de Omision",
          "Fechas de Omisión",
          "Fechas de Omision",
          "Fecha Omisión",
          "Fecha Omision",
          "Fechas Omisión",
          "Omisiones",
          "Omisión",
          "Omision",
          "Marcas",
          "Fechas",
        ]),
      );
      if (omEntries.length === 0) {
        omEntries = parseOmisionesEntries(
          pickCell(norm, ["Fecha", "Día", "Dia", "Fecha marca", "Fecha Marca"]),
        );
      }
      const puntoFila = pickPuntoOmitidoFromRow(norm);
      const omConPunto = omEntries.map((e) => ({ ...e, puntoOmitido: e.puntoOmitido ?? puntoFila ?? null }));
      g.omisiones.push(...omConPunto);

      sheetRow++;
    }
  }

  return { sheetRows, inspeccionMode, groups, errors };
}

async function loadMarcasImportEnrichment(codigos: string[]) {
  const allContracts = await prisma.contract.findMany({
    where: { deletedAt: null },
    select: { licitacionNo: true, client: true },
  });
  const contractClientByLicitacion = new Map<string, string>();
  for (const c of allContracts) {
    const key = normalizeLicitacion(c.licitacionNo);
    if (key) contractClientByLicitacion.set(key, c.client);
  }

  const masters = await prisma.disciplinaryEmployeeMaster.findMany({
    where: { codigoEmpleado: { in: codigos } },
  });
  const masterByCodigo = new Map(masters.map((m) => [m.codigoEmpleado, m]));
  const zoneDisciplineDefaults = await loadZoneDisciplinaryDefaultsMap();
  return { contractClientByLicitacion, masterByCodigo, zoneDisciplineDefaults };
}

/** Analiza el Excel sin escribir en BD (checksum incluido para validar al confirmar). */
export async function previewDisciplinaryMarcasWorkbook(buffer: ArrayBuffer): Promise<MarcasPreviewResult> {
  const checksum = sha256Hex(buffer);
  const { sheetRows, inspeccionMode, groups, errors } = parseMarcasWorkbookToGroups(buffer);
  const { masterByCodigo, zoneDisciplineDefaults } = await loadMarcasImportEnrichment([...groups.keys()]);

  const planned: MarcasPlannedRow[] = [];
  let wouldSkipOmisiones = 0;

  for (const g of groups.values()) {
    const sortedOm = sortOmisiones(g.omisiones);
    if (sortedOm.length === 0) {
      wouldSkipOmisiones++;
      for (const rn of g.rowNumbers) {
        errors.push({ row: rn, message: "Sin fechas de omisión en la fila (grupo " + g.codigo + ")" });
      }
      continue;
    }

    const fechaEmision = resolveFechaEmisionDocumento(g.fechaEmisionCandidates, new Date());

    const estado = parseDisciplinaryStatus(g.estadoRaw);
    const vigencia = calculateVigencia(fechaEmision, estado);

    const master = masterByCodigo.get(g.codigo);
    const nombre =
      (g.nombreExcel && g.nombreExcel.trim()) ||
      (master?.nombre && master.nombre.trim()) ||
      `Empleado ${g.codigo}`;

    const effZona = mergeFirst(master?.zona ?? null, g.zona) as string | null;
    const zd = mergeDefaultsForZoneTexts(zoneDisciplineDefaults, effZona, g.zona, master?.zona ?? null);
    let administrador = g.administrador;
    if (zd?.administrator) {
      administrador = mergeFirst(administrador, zd.administrator) as string | null;
    }

    const numeroPreliminar = `OM-${fechaEmision.getFullYear()}-______`;
    const emailEmpleado = master?.email?.trim() || null;
    let emailCcZona: string | null = null;
    if (zd?.administratorEmail?.trim()) {
      const ccAddr = zd.administratorEmail.trim();
      if (!emailEmpleado || ccAddr.toLowerCase() !== emailEmpleado.toLowerCase()) {
        emailCcZona = ccAddr;
      }
    }

    planned.push({
      codigo: g.codigo,
      nombre,
      cedula: master?.cedula?.trim() || null,
      zona: effZona,
      zonaMaestro: master?.zona?.trim() || null,
      zonaExcel: g.zona,
      sucursal: g.sucursal,
      administrador,
      emailEmpleado,
      emailCcZona,
      omisionesCount: sortedOm.length,
      omisionesResumen: summarizeOmisiones(sortedOm, 4),
      fechaEmision: fechaEmision.toISOString(),
      numeroPreliminar,
      estado,
      vigencia,
    });
  }

  return {
    checksum,
    rowsSheet: sheetRows.length,
    inspeccionMode,
    planned,
    wouldInsert: planned.length,
    wouldSkipOmisiones,
    errors,
  };
}

/** PDF de vista previa para un código de empleado del mismo Excel (sin persistir). */
export async function buildMarcasPreviewPdfForCodigo(
  buffer: ArrayBuffer,
  codigoRaw: string,
  pdfOptions?: { zona?: string; sucursal?: string },
): Promise<Uint8Array | null> {
  const codigo = normalizeEmployeeCode(codigoRaw);
  if (!codigo) return null;

  const { groups } = parseMarcasWorkbookToGroups(buffer);
  const g = groups.get(codigo);
  if (!g) return null;

  const sortedOm = sortOmisiones(g.omisiones);
  if (sortedOm.length === 0) return null;

  const { contractClientByLicitacion, masterByCodigo, zoneDisciplineDefaults } =
    await loadMarcasImportEnrichment([...groups.keys()]);

  const fechaEmision = resolveFechaEmisionDocumento(g.fechaEmisionCandidates, new Date());

  const contratoRaw = g.contrato;
  const contratoNormalizado = normalizeLicitacion(contratoRaw);
  const cliente = contratoNormalizado ? contractClientByLicitacion.get(contratoNormalizado) ?? null : null;

  const master = masterByCodigo.get(g.codigo);
  const nombre =
    (g.nombreExcel && g.nombreExcel.trim()) ||
    (master?.nombre && master.nombre.trim()) ||
    `Empleado ${g.codigo}`;

  const baseZona = mergeFirst(master?.zona ?? null, g.zona) as string | null;
  const pdfZona =
    pdfOptions && typeof pdfOptions.zona === "string"
      ? pdfOptions.zona.trim()
        ? pdfOptions.zona.trim()
        : null
      : baseZona;
  const zd = mergeDefaultsForZoneTexts(zoneDisciplineDefaults, pdfZona, g.zona, master?.zona ?? null);
  let administrador = g.administrador;
  if (zd?.administrator) {
    administrador = mergeFirst(administrador, zd.administrator) as string | null;
  }

  const numeroPreliminar = `OM-${fechaEmision.getFullYear()}-PREVIEW`;
  const settings = await ensureDisciplinarySettingsRow();
  const [brandingLogoFile, signatureImageFile] = await Promise.all([
    loadBrandingLogoFile(),
    loadDisciplinarySignatureFile(),
  ]);

  const pdfSucursal =
    pdfOptions && typeof pdfOptions.sucursal === "string"
      ? pdfOptions.sucursal.trim()
        ? pdfOptions.sucursal.trim()
        : null
      : g.sucursal;

  return buildOmisionPdfBytes({
    numero: numeroPreliminar,
    codigoEmpleado: g.codigo,
    nombreEmpleado: nombre,
    fechaEmision,
    cedula: master?.cedula?.trim() || null,
    zona: pdfZona,
    sucursal: pdfSucursal,
    administrador,
    omisiones: sortedOm.map((e) => ({
      fecha: e.fecha,
      hora: e.hora,
      puntoOmitido: e.puntoOmitido ?? null,
    })),
    documentTitle: settings.documentTitle,
    documentLegalText: settings.documentLegalText,
    documentIntroTemplate: settings.documentIntroTemplate,
    documentFooter: settings.documentFooter,
    formCode: settings.documentFormCode,
    formRevision: settings.documentFormRevision,
    formVersion: settings.documentFormVersion,
    formSubtitle: settings.documentFormSubtitle,
    brandingLogoFile,
    signatureImageFile,
  });
}

/**
 * Importa Excel plano de «marcas» o export «detalle de inspecciones»:
 * - Detalle: columnas Usr Marca (CODIGO-NOMBRE), Estado (No Realizada), Fec Marca.
 * - Plano legacy: columnas de código + fechas de omisión en una fila.
 * Agrupa por empleado y crea un apercibimiento por persona.
 */
export async function importDisciplinaryMarcasWorkbook(
  buffer: ArrayBuffer,
  filename: string,
  uploadedById: string,
  options: {
    sendEmail: boolean;
    /** Por código de empleado: zona/sucursal editadas en la vista previa (mismas claves que en el análisis). */
    zoneOverrides?: Record<string, MarcasZoneOverrideRow>;
  },
): Promise<MarcasImportResult> {
  const checksum = sha256Hex(buffer);
  const previous = await prisma.disciplinaryImportBatch.findUnique({
    where: { checksum },
    select: {
      id: true,
      filename: true,
      createdAt: true,
      uploadedBy: { select: { name: true } },
    },
  });
  if (previous) {
    throw new DuplicateImportError({
      id: previous.id,
      filename: previous.filename,
      createdAt: previous.createdAt,
      uploadedByName: previous.uploadedBy?.name ?? null,
    });
  }

  const { sheetRows, inspeccionMode, groups, errors } = parseMarcasWorkbookToGroups(buffer);
  const { contractClientByLicitacion, masterByCodigo, zoneDisciplineDefaults } =
    await loadMarcasImportEnrichment([...groups.keys()]);

  const batch = await prisma.disciplinaryImportBatch.create({
    data: {
      filename,
      checksum,
      uploadedById,
      rowsHistorial: sheetRows.length,
      rowsTratamiento: 0,
      notes: inspeccionMode ? "import_marcas_inspeccion" : "import_marcas",
    },
  });

  let apercibimientosInserted = 0;
  let omisionesInserted = 0;
  let emailsSent = 0;
  let emailsSkipped = 0;

  const settings = await ensureDisciplinarySettingsRow();
  const [brandingLogoFile, signatureImageFile] = await Promise.all([
    loadBrandingLogoFile(),
    loadDisciplinarySignatureFile(),
  ]);
  const smtp = options.sendEmail ? await getSmtpConfig() : null;
  const transport = smtp && options.sendEmail ? await createSmtpTransport() : null;

  for (const g of groups.values()) {
    const sortedOm = sortOmisiones(g.omisiones);
    if (sortedOm.length === 0) {
      for (const rn of g.rowNumbers) {
        errors.push({ row: rn, message: "Sin fechas de omisión en la fila (grupo " + g.codigo + ")" });
      }
      continue;
    }

    const fechaEmision = resolveFechaEmisionDocumento(g.fechaEmisionCandidates, batch.createdAt);

    const estado = parseDisciplinaryStatus(g.estadoRaw);
    const vigencia = calculateVigencia(fechaEmision, estado);
    const contratoRaw = g.contrato;
    const contratoNormalizado = normalizeLicitacion(contratoRaw);
    const cliente = contratoNormalizado ? contractClientByLicitacion.get(contratoNormalizado) ?? null : null;

    const master = masterByCodigo.get(g.codigo);
    const nombre =
      (g.nombreExcel && g.nombreExcel.trim()) ||
      (master?.nombre && master.nombre.trim()) ||
      `Empleado ${g.codigo}`;

    const { zona: effZona, sucursal: effSucursal } = effectiveZonaSucursalForMarcas(
      g,
      master,
      options.zoneOverrides,
    );
    const zd = mergeDefaultsForZoneTexts(
      zoneDisciplineDefaults,
      effZona,
      g.zona,
      master?.zona ?? null,
    );
    if (zd?.administrator) {
      g.administrador = mergeFirst(g.administrador, zd.administrator) as string | null;
    }

    let numero: string;
    try {
      numero = await allocateNextApercibimientoNumero(fechaEmision);
    } catch (e) {
      for (const rn of g.rowNumbers) {
        errors.push({
          row: rn,
          message: `No se pudo asignar número de apercibimiento (código ${g.codigo}): ${e instanceof Error ? e.message : String(e)}`,
        });
      }
      continue;
    }

    const exists = await prisma.disciplinaryApercibimiento.findUnique({
      where: { numero },
      select: { id: true },
    });
    if (exists) {
      for (const rn of g.rowNumbers) {
        errors.push({
          row: rn,
          message: `El número ${numero} ya existe (código ${g.codigo}); reintente el import`,
        });
      }
      continue;
    }

    try {
      const created = await prisma.disciplinaryApercibimiento.create({
        data: {
          numero,
          fechaEmision,
          codigoEmpleado: g.codigo,
          codigoEmpleadoRaw: g.codigoRaw,
          nombreEmpleado: nombre,
          zona: effZona,
          sucursal: effSucursal,
          cantidadOmisiones: sortedOm.length,
          administrador: g.administrador,
          estado,
          vigencia,
          contrato: contratoRaw,
          contratoNormalizado,
          cliente,
          importBatchId: batch.id,
          planoOrigen: "import_marcas",
        },
        select: { id: true },
      });

      const omRes = await prisma.disciplinaryOmission.createMany({
        data: sortedOm.map((e, idx) => ({
          apercibimientoId: created.id,
          fecha: e.fecha,
          hora: e.hora,
          puntoOmitido: e.puntoOmitido?.trim() || null,
          secuencia: idx,
        })),
      });
      omisionesInserted += omRes.count;
      apercibimientosInserted++;

      const emailTo = master?.email?.trim();
      let zoneAdminCc: string | undefined;
      if (zd?.administratorEmail?.trim()) {
        const ccAddr = zd.administratorEmail.trim();
        if (!emailTo || ccAddr.toLowerCase() !== emailTo.toLowerCase()) {
          zoneAdminCc = ccAddr;
        }
      }

      if (options.sendEmail && emailTo && smtp && transport) {
        const pdfBytes = await buildOmisionPdfBytes({
          numero,
          codigoEmpleado: g.codigo,
          nombreEmpleado: nombre,
          fechaEmision,
          cedula: master?.cedula?.trim() || null,
          zona: effZona,
          sucursal: effSucursal,
          administrador: g.administrador,
          omisiones: sortedOm.map((e) => ({
            fecha: e.fecha,
            hora: e.hora,
            puntoOmitido: e.puntoOmitido ?? null,
          })),
          documentTitle: settings.documentTitle,
          documentLegalText: settings.documentLegalText,
          documentIntroTemplate: settings.documentIntroTemplate,
          documentFooter: settings.documentFooter,
          formCode: settings.documentFormCode,
          formRevision: settings.documentFormRevision,
          formVersion: settings.documentFormVersion,
          formSubtitle: settings.documentFormSubtitle,
          brandingLogoFile,
          signatureImageFile,
        });
        const safeFile = `Apercibimiento-${numero.replace(/[^a-zA-Z0-9-_.]/g, "_")}.pdf`;
        const subject = renderMailTemplate(settings.emailSubjectTemplate, {
          numero,
          nombre,
          codigo: g.codigo,
          omisiones_count: sortedOm.length,
          zona: effZona,
          administrador: g.administrador,
        });
        const text = renderMailTemplate(settings.emailBodyTemplate, {
          numero,
          nombre,
          codigo: g.codigo,
          omisiones_count: sortedOm.length,
          zona: effZona,
          administrador: g.administrador,
        });
        try {
          await sendDisciplinaryOmisionEmail({
            transport,
            from: smtp.from,
            to: emailTo,
            cc: mergeDisciplinaryCc(emailTo, settings.emailFixedCc, zoneAdminCc),
            subject,
            text,
            pdfFilename: safeFile,
            pdfBytes,
          });
          await prisma.disciplinaryApercibimiento.update({
            where: { id: created.id },
            data: { correoEnviadoA: emailTo },
          });
          emailsSent++;
        } catch (e) {
          errors.push({
            row: g.rowNumbers[0] ?? 0,
            message: `Correo no enviado (${g.codigo}): ${e instanceof Error ? e.message : "error SMTP"}`,
          });
        }
      } else if (options.sendEmail) {
        emailsSkipped++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al crear apercibimiento";
      for (const rn of g.rowNumbers) errors.push({ row: rn, message: msg });
    }
  }

  await prisma.disciplinaryImportBatch.update({
    where: { id: batch.id },
    data: {
      rowsInserted: apercibimientosInserted,
      rowsSkipped: groups.size - apercibimientosInserted,
      errorsJson: errors.length > 0 ? (errors as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });

  return {
    batchId: batch.id,
    rowsSheet: sheetRows.length,
    apercibimientosInserted,
    omisionesInserted,
    emailsSent,
    emailsSkipped,
    errors,
  };
}

function normalizeHoraMatchKey(hora: string | null | undefined): string {
  if (!hora?.trim()) return "";
  const m = hora.trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (!m) return hora.trim().toLowerCase();
  const hh = String(parseInt(m[1], 10)).padStart(2, "0");
  const mm = String(parseInt(m[2], 10)).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Claves calendario + hora para emparejar omisión en BD con la fila del Excel (UTC y local). */
function omissionMatchKeysFromDbRow(fecha: Date, hora: string | null | undefined): string[] {
  const h = normalizeHoraMatchKey(hora);
  const kUtc = `${fecha.getUTCFullYear()}-${fecha.getUTCMonth()}-${fecha.getUTCDate()}-${h}`;
  const kLoc = `${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}-${h}`;
  return kUtc === kLoc ? [kUtc] : [kUtc, kLoc];
}

function omissionMatchKeyFromParsed(e: OmisionEntry): string {
  const d = e.fecha;
  const h = normalizeHoraMatchKey(e.hora);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${h}`;
}

export type RetrofillPuntoOmitidoResult = {
  batchId: string;
  apercibimientosConCambios: number;
  omisionesActualizadas: number;
  omisionesSinCoincidencia: number;
  avisos: string[];
};

/**
 * Vuelve a analizar el mismo Excel de marcas y copia `puntoOmitido` (y coherencia de filas)
 * a las omisiones ya guardadas del lote. Útil tras añadir columnas en el import o para corregir histórico.
 */
export async function retrofillPuntoOmitidoFromMarcasWorkbook(
  buffer: ArrayBuffer,
  batchId: string,
): Promise<RetrofillPuntoOmitidoResult> {
  const batch = await prisma.disciplinaryImportBatch.findUnique({
    where: { id: batchId },
    select: { id: true, notes: true },
  });
  if (!batch) {
    throw new Error("Lote no encontrado");
  }
  if (!batch.notes?.startsWith("import_marcas")) {
    throw new Error("Solo aplica a lotes de importación de marcas (notas import_marcas).");
  }

  const { groups } = parseMarcasWorkbookToGroups(buffer);
  const apercibimientos = await prisma.disciplinaryApercibimiento.findMany({
    where: { importBatchId: batchId },
    include: {
      omisiones: { orderBy: [{ fecha: "asc" }, { hora: "asc" }, { secuencia: "asc" }] },
    },
  });

  let omisionesActualizadas = 0;
  let omisionesSinCoincidencia = 0;
  let apercibimientosConCambios = 0;
  const avisos: string[] = [];

  for (const ap of apercibimientos) {
    const g = groups.get(ap.codigoEmpleado);
    if (!g || g.omisiones.length === 0) {
      if (avisos.length < 45) {
        avisos.push(`Sin filas de omisión en el Excel para ${ap.codigoEmpleado} (${ap.numero}).`);
      }
      continue;
    }

    const parsedSorted = sortOmisiones(g.omisiones);
    const pool = parsedSorted.map((e) => ({ e, used: false }));
    let cambiosEnEste = 0;

    for (const row of ap.omisiones) {
      const keys = omissionMatchKeysFromDbRow(row.fecha, row.hora);
      const hit = pool.find((p) => !p.used && keys.includes(omissionMatchKeyFromParsed(p.e)));
      if (!hit) {
        omisionesSinCoincidencia++;
        if (avisos.length < 45) {
          avisos.push(
            `Sin coincidencia: ${ap.numero} / ${ap.codigoEmpleado} — fecha ${row.fecha.toISOString().slice(0, 10)} hora "${row.hora ?? ""}"`,
          );
        }
        continue;
      }
      const nuevo = hit.e.puntoOmitido?.trim() || null;
      const actual = row.puntoOmitido?.trim() || null;
      if (actual !== nuevo) {
        await prisma.disciplinaryOmission.update({
          where: { id: row.id },
          data: { puntoOmitido: nuevo },
        });
        omisionesActualizadas++;
        cambiosEnEste++;
      }
      hit.used = true;
    }
    if (cambiosEnEste > 0) apercibimientosConCambios++;
  }

  if (avisos.length > 45) {
    avisos.splice(45);
    avisos.push("(Lista de avisos truncada.)");
  }

  return {
    batchId,
    apercibimientosConCambios,
    omisionesActualizadas,
    omisionesSinCoincidencia,
    avisos,
  };
}
