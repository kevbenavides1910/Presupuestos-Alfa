import type {
  DisciplinaryCycleAccion,
  DisciplinaryStatus,
  DisciplinaryVigencia,
} from "@prisma/client";
import { parseDateCell } from "@/lib/import/xlsx-read";

/**
 * Normaliza el código de empleado para que las llaves entre Historial y Tratamiento
 * crucen correctamente:
 * - trim
 * - mayúsculas
 * - si todo el contenido (sin separadores) es numérico, quitamos ceros a la izquierda
 *   para evitar que "00123" no cruce con "123".
 *
 * Devuelve "" si la entrada está vacía. Quien usa este helper debe decidir si filtra
 * filas con código vacío.
 */
export function normalizeEmployeeCode(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) {
    const stripped = s.replace(/^0+/, "");
    return stripped || "0";
  }
  return s.toUpperCase();
}

const STATUS_MAP: Record<string, DisciplinaryStatus> = {
  emitido: "EMITIDO",
  emitida: "EMITIDO",
  entregado: "ENTREGADO",
  entregada: "ENTREGADO",
  firmado: "FIRMADO",
  firmada: "FIRMADO",
  anulado: "ANULADO",
  anulada: "ANULADO",
  cancelado: "ANULADO",
};

export function parseDisciplinaryStatus(raw: unknown): DisciplinaryStatus {
  if (!raw) return "EMITIDO";
  const k = String(raw)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return STATUS_MAP[k] ?? "EMITIDO";
}

const CYCLE_ACCION_MAP: Record<string, DisciplinaryCycleAccion> = {
  cobrado: "COBRADO",
  cobrada: "COBRADO",
  pagado: "COBRADO",
  pagada: "COBRADO",
  "dado de baja": "DADO_DE_BAJA",
  "dada de baja": "DADO_DE_BAJA",
  baja: "DADO_DE_BAJA",
  retirado: "DADO_DE_BAJA",
};

export function parseCycleAccion(raw: unknown): {
  accion: DisciplinaryCycleAccion;
  raw: string | null;
} {
  if (!raw) return { accion: "OTRO", raw: null };
  const original = String(raw).trim();
  if (!original) return { accion: "OTRO", raw: null };
  const k = original
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return { accion: CYCLE_ACCION_MAP[k] ?? "OTRO", raw: original };
}

/**
 * Vigencia derivada del negocio. Reglas (legacy de la app de escritorio):
 *
 * - Estado FIRMADO  → FINALIZADO (cerrado, ya no cuenta).
 * - Estado ANULADO  → ANULADO   (no cuenta para totales).
 * - Caso contrario, según días transcurridos desde la emisión:
 *     <  7 días → VIGENTE
 *     7-29     → VENCIDO
 *     >= 30    → PRESCRITO
 *
 * `now` se inyecta para tests. Si no se pasa, se usa la fecha actual.
 */
export function calculateVigencia(
  fechaEmision: Date,
  estado: DisciplinaryStatus,
  now: Date = new Date(),
): DisciplinaryVigencia {
  if (estado === "ANULADO") return "ANULADO";
  if (estado === "FIRMADO") return "FINALIZADO";

  const ms = now.getTime() - fechaEmision.getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 7) return "VIGENTE";
  if (days < 30) return "VENCIDO";
  return "PRESCRITO";
}

export type ClosedCycleParsed = {
  cerradoEl: Date | null;
  accion: DisciplinaryCycleAccion;
  accionRaw: string | null;
  monto: number | null;
  count: number | null;
  omissions: number | null;
  lastDate: Date | null;
  fechaConvocatoria: Date | null;
  nombre: string | null;
  zona: string | null;
  raw: Record<string, unknown>;
};

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function asInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/[₡$\s]/g, "");
  if (!s) return null;
  // Acepta separador miles europeo (1.234,56) o americano (1,234.56)
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma > lastDot) {
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = s.replace(/,/g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function asDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  // ISO directo
  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) return iso;
  // dd/mm/yyyy [hh:mm[:ss]]
  const m = s.match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (m) {
    let yy = parseInt(m[3], 10);
    if (yy < 100) yy += yy >= 70 ? 1900 : 2000;
    const mm = parseInt(m[2], 10) - 1;
    const dd = parseInt(m[1], 10);
    const hh = m[4] ? parseInt(m[4], 10) : 0;
    const mi = m[5] ? parseInt(m[5], 10) : 0;
    const ss = m[6] ? parseInt(m[6], 10) : 0;
    const d = new Date(yy, mm, dd, hh, mi, ss);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function pickField(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in o && o[k] !== null && o[k] !== undefined && o[k] !== "") {
      return o[k];
    }
    // versión normalizada (sin acentos, minúsculas)
    const normK = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const oKey of Object.keys(o)) {
      const normO = oKey.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normO === normK && o[oKey] !== null && o[oKey] !== undefined && o[oKey] !== "") {
        return o[oKey];
      }
    }
  }
  return undefined;
}

/**
 * Parsea el JSON de `closed_cycles_json` proveniente del Excel. Acepta:
 * - string JSON (lo más común)
 * - array ya parseado
 * - JSON inválido / vacío → []
 *
 * Cada elemento tiene campos típicos: cerrado_el, accion, monto, count, omissions,
 * last_date, fecha_convocatoria, nombre, zona.
 */
export function parseClosedCyclesJson(raw: unknown): ClosedCycleParsed[] {
  if (raw === null || raw === undefined || raw === "") return [];
  let arr: unknown;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      arr = JSON.parse(trimmed);
    } catch {
      return [];
    }
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr)) return [];

  const out: ClosedCycleParsed[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const accionRaw = pickField(o, "accion", "acción", "action");
    const accionParsed = parseCycleAccion(accionRaw);
    out.push({
      cerradoEl: asDate(pickField(o, "cerrado_el", "cerradoEl", "closed_at", "fecha_cierre")),
      accion: accionParsed.accion,
      accionRaw: accionParsed.raw,
      monto: asNumber(pickField(o, "monto", "amount", "valor")),
      count: asInt(pickField(o, "count", "cantidad")),
      omissions: asInt(pickField(o, "omissions", "omisiones")),
      lastDate: asDate(pickField(o, "last_date", "lastDate", "ultima_fecha")),
      fechaConvocatoria: asDate(pickField(o, "fecha_convocatoria", "fechaConvocatoria")),
      nombre: asString(pickField(o, "nombre", "name")),
      zona: asString(pickField(o, "zona", "zone")),
      raw: o,
    });
  }
  return out;
}

/**
 * Parsea una celda del Excel que puede contener UNA o VARIAS fechas de omisión de marca.
 *
 * Separadores aceptados: coma, punto y coma, barra vertical, salto de línea, tabulador.
 * Cada token se intenta parsear como fecha (serial Excel, Date, "dd/mm/yyyy", ISO…).
 * Se deduplican fechas repetidas y se ordenan ascendentes.
 *
 * Devuelve un array de Date (hora local 00:00) o vacío si no hay fechas válidas.
 *
 * Nota: acepta un `Date` único o número serial sin separadores.
 */
/**
 * Regex que captura TODAS las fechas (con hora opcional pegada) que aparecen en
 * una cadena, sin importar con qué separador vengan (coma, punto y coma, espacio,
 * "y", salto de línea, "/", tabulador, "-", etc.). Soporta:
 *   - ISO        : 2026-04-19  ó  2026-04-19T07:30  ó  2026-04-19 07:30:15
 *   - dd/mm/yyyy : 19/04/2026, 19-04-2026, 19.04.2026 (también con yy: 19/04/26)
 *   - dd/mes/yy  : 19-abr-2026, 19/ene/25 (mes en letras, español)
 *
 * Hora opcional al final de cada fecha: "HH:mm[:ss] [am/pm]" separada por
 * espacio (o `T` en ISO). Ejemplos válidos:
 *   - "19/04/2026 07:30"
 *   - "19/04/2026 7:30 a.m."
 *   - "2026-04-19T15:42:08"
 */
// Patrón de hora en grupo NO-CAPTURING.
const TIME_PATTERN = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s*[aApP]\.?\s*[mM]\.?)?`;
const DATE_GLOBAL_REGEX = new RegExp(
  [
    // ISO yyyy-mm-dd [T|space hh:mm[:ss]]
    String.raw`(?<![\d/.-])\d{4}-\d{1,2}-\d{1,2}(?:[T\s]+${TIME_PATTERN})?(?![\d/.-])`,
    // dd[/.-]mm[/.-]yyyy [hh:mm]
    String.raw`(?<![\d/.-])\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}(?:\s+${TIME_PATTERN})?(?![\d/.-])`,
    // dd[/.-]mm[/.-]yy [hh:mm]
    String.raw`(?<![\d/.-])\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2}(?:\s+${TIME_PATTERN})?(?![\d/.-])`,
    // dd[/.-]mes-letras[/.-]yyyy|yy [hh:mm]
    String.raw`(?<![\w/.-])\d{1,2}[\/\-.][a-zA-Z\u00f1\u00d1\u00e1\u00e9\u00ed\u00f3\u00fa\u00c1\u00c9\u00cd\u00d3\u00da.]{3,9}[\/\-.]\d{2,4}(?:\s+${TIME_PATTERN})?(?![\w/.-])`,
  ].join("|"),
  "g",
);

/** Regex de extracción de hora (capturing) sobre un token ya recortado. */
const TIME_EXTRACT_REGEX = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([aApP]\.?\s*[mM]\.?)?\s*$/;

/**
 * Normaliza una hora textual a "HH:mm" o "HH:mm:ss". Devuelve null si no es
 * válida. Soporta:
 *   - "07:30", "7:30"
 *   - "7:30:15"
 *   - "7:30 a.m.", "7:30 PM", "7:30am"
 *   - "00:00" → null (medianoche se considera "sin hora", típica del Excel
 *     cuando la celda no llevaba componente horario)
 */
export function parseTimeString(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([aApP]\.?\s*[mM]\.?)?$/);
  if (!m) return null;
  let h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  const sec = m[3] ? Number.parseInt(m[3], 10) : null;
  const ampm = (m[4] ?? "").toLowerCase().replace(/[.\s]/g, "");
  if (ampm === "am" || ampm === "pm") {
    if (h < 1 || h > 12) return null;
    if (ampm === "am" && h === 12) h = 0;
    if (ampm === "pm" && h !== 12) h += 12;
  }
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  if (sec !== null && (sec < 0 || sec > 59)) return null;
  // Medianoche exacta: típico de fechas sin hora real (Excel pone 00:00).
  // Lo tratamos como ausencia de hora para no contaminar la UI con horas falsas.
  if (h === 0 && min === 0 && (sec === null || sec === 0)) return null;
  const hh = String(h).padStart(2, "0");
  const mm = String(min).padStart(2, "0");
  if (sec !== null) return `${hh}:${mm}:${String(sec).padStart(2, "0")}`;
  return `${hh}:${mm}`;
}

/** Extrae hora pegada al final de un token "fecha [hora]" si la hubiera. */
function extractHoraFromToken(token: string): string | null {
  const m = token.match(TIME_EXTRACT_REGEX);
  return parseTimeString(m ? m[0] : null);
}

/** Extrae la hora desde un valor Date si no es 00:00 exacta. */
function horaFromDate(d: Date): string | null {
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  if (h === 0 && m === 0 && s === 0) return null;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  if (s) return `${hh}:${mm}:${String(s).padStart(2, "0")}`;
  return `${hh}:${mm}`;
}

/**
 * Convierte la fracción de un serial Excel a "HH:mm" o "HH:mm:ss" (o null si es 0).
 * Excel guarda fechas como `dias.fraccionDelDia`, donde 0.5 = 12:00, 0.25 = 06:00, etc.
 */
function horaFromExcelSerial(n: number): string | null {
  const frac = Math.abs(n) - Math.floor(Math.abs(n));
  if (frac === 0) return null;
  // Redondeo a segundo para evitar derivas binarias del float.
  const totalSec = Math.round(frac * 86400);
  if (totalSec === 0 || totalSec >= 86400) return null;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  if (s) return `${hh}:${mm}:${String(s).padStart(2, "0")}`;
  return `${hh}:${mm}`;
}

/**
 * Extrae todas las fechas de omisión presentes en una celda del Excel.
 *
 * El Excel original puede traer 1..N fechas en una sola casilla, separadas por
 * coma, punto y coma, barra vertical, salto de línea, espacios o por palabras
 * como "y" / "al". Este parser captura TODAS y devuelve `Date[]` deduplicado y
 * ordenado ascendentemente.
 *
 * Casos cubiertos:
 *   - Date u objeto serial Excel directo → un único elemento.
 *   - "19/04/2026"
 *   - "19/04/2026, 20/04/2026"
 *   - "19/04/2026; 20/04/2026"
 *   - "19/04/2026 20/04/2026"   ← separadas sólo por espacio
 *   - "19/04/2026 y 20/04/2026"
 *   - "19/04/2026\n20/04/2026"
 *   - "19-abr-2026, 20-abr-2026"
 *   - "2026-04-19 / 2026-04-20"
 */
export interface OmisionEntry {
  fecha: Date;
  /** "HH:mm" o "HH:mm:ss"; null si la celda no traía componente horario o era 00:00. */
  hora: string | null;
}

/**
 * Versión enriquecida de `parseOmisionesFechas`: además de la fecha, captura la
 * HORA cuando el Excel la incluya (ya sea como texto "19/04/2026 07:30", como
 * Date con hora, o como serial Excel con fracción del día).
 *
 * Mantiene las mismas reglas:
 *   - NO deduplica (varias omisiones del mismo día son distintas).
 *   - Ordena cronológicamente (por fecha+hora cuando hay hora; estable cuando no).
 */
export function parseOmisionesEntries(raw: unknown): OmisionEntry[] {
  if (raw === null || raw === undefined || raw === "") return [];

  /** Tupla (token a parsear como fecha, hora ya conocida si aplica). */
  type Tok = { value: unknown; horaPreknown: string | null };
  const tokens: Tok[] = [];

  if (raw instanceof Date) {
    tokens.push({ value: raw, horaPreknown: horaFromDate(raw) });
  } else if (typeof raw === "number") {
    tokens.push({ value: raw, horaPreknown: horaFromExcelSerial(raw) });
  } else {
    // Normalizamos espacios raros (NBSP, narrow NBSP, marcas de dirección RTL/LTR)
    // antes de aplicar la regex para que coincidan los lookarounds.
    const s = String(raw)
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/[\u00A0\u202F]/g, " ")
      .trim();
    if (!s) return [];

    // 1) Estrategia principal: capturar TODAS las fechas (con su hora opcional)
    //    que aparezcan, sin importar el separador.
    const matches = s.match(DATE_GLOBAL_REGEX);
    if (matches && matches.length > 0) {
      for (const m of matches) {
        // El match puede ser "19/04/2026 07:30" o solo "19/04/2026".
        // Separamos hora y fecha para que parseDateCell no se confunda con el
        // sufijo horario.
        const horaTextual = extractHoraFromToken(m);
        // Quitamos la hora para quedarnos con la parte de fecha pura.
        const fechaText = horaTextual
          ? m.replace(TIME_EXTRACT_REGEX, "").trim()
          : m;
        tokens.push({ value: fechaText, horaPreknown: horaTextual });
      }
    } else {
      // 2) Fallback: dividir por separadores tradicionales.
      const parts = s.split(/[,;|\n\r\t]+/).map((t) => t.trim()).filter(Boolean);
      const list = parts.length > 0 ? parts : [s];
      for (const p of list) {
        const horaTextual = extractHoraFromToken(p);
        const fechaText = horaTextual ? p.replace(TIME_EXTRACT_REGEX, "").trim() : p;
        tokens.push({ value: fechaText, horaPreknown: horaTextual });
      }
    }
  }

  const out: OmisionEntry[] = [];
  for (const t of tokens) {
    const ymd = parseDateCell(t.value);
    if (!ymd) continue;
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    if (Number.isNaN(dt.getTime())) continue;
    out.push({ fecha: dt, hora: t.horaPreknown });
  }
  // Orden cronológico: primero por fecha, luego por hora (sin hora < con hora).
  out.sort((a, b) => {
    const dt = a.fecha.getTime() - b.fecha.getTime();
    if (dt !== 0) return dt;
    if (!a.hora && !b.hora) return 0;
    if (!a.hora) return -1;
    if (!b.hora) return 1;
    return a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : 0;
  });
  return out;
}

/**
 * Wrapper retrocompatible: devuelve sólo las fechas (sin hora). Mantiene la
 * firma anterior de `parseOmisionesFechas` para no romper consumidores legacy.
 *
 * Para el importer y reportes nuevos, usar `parseOmisionesEntries` que sí
 * conserva la hora.
 */
export function parseOmisionesFechas(raw: unknown): Date[] {
  return parseOmisionesEntries(raw).map((e) => e.fecha);
}

/**
 * Normaliza un número de contrato/licitación para emparejar con `Contract.licitacionNo`.
 * - trim
 * - colapsa espacios y guiones repetidos
 * - mayúsculas
 * Devuelve null si la entrada queda vacía.
 *
 * Importante: esta normalización es solo para LOOKUP. El valor original se guarda
 * aparte (`contrato`) para no perder formato cuando el usuario lo capturó con
 * mayúsculas y espacios particulares.
 */
export function normalizeLicitacion(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s
    .toUpperCase()
    .replace(/[\s\u00A0]+/g, " ")
    .replace(/-+/g, "-")
    .trim();
}

/** Conjunto cerrado de etiquetas para mostrar en UI (sin lógica de cálculo). */
export const STATUS_LABEL: Record<DisciplinaryStatus, string> = {
  EMITIDO: "Emitido",
  ENTREGADO: "Entregado",
  FIRMADO: "Firmado",
  ANULADO: "Anulado",
};

export const VIGENCIA_LABEL: Record<DisciplinaryVigencia, string> = {
  VIGENTE: "Vigente",
  VENCIDO: "Vencido",
  PRESCRITO: "Prescrito",
  FINALIZADO: "Finalizado",
  ANULADO: "Anulado",
};

export const VIGENCIA_COLOR: Record<DisciplinaryVigencia, string> = {
  VIGENTE: "bg-blue-100 text-blue-700",
  VENCIDO: "bg-amber-100 text-amber-800",
  PRESCRITO: "bg-slate-200 text-slate-700",
  FINALIZADO: "bg-emerald-100 text-emerald-800",
  ANULADO: "bg-rose-100 text-rose-700",
};

export const STATUS_COLOR: Record<DisciplinaryStatus, string> = {
  EMITIDO: "bg-blue-100 text-blue-700",
  ENTREGADO: "bg-amber-100 text-amber-800",
  FIRMADO: "bg-emerald-100 text-emerald-800",
  ANULADO: "bg-rose-100 text-rose-700",
};
