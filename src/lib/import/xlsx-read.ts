import * as XLSX from "xlsx";

/** Primera hoja → filas como objetos usando la fila 1 como encabezados. */
export function readFirstSheetAsObjects(buffer: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true, raw: false });
  const name = wb.SheetNames[0];
  if (!name) return [];
  const sheet = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  return rows;
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
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
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

/** Fecha: serial Excel, Date, o string YYYY-MM-DD / DD/MM/YYYY */
export function parseDateCell(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const epoch = new Date(1899, 11, 30);
    const dt = new Date(epoch.getTime() + Math.round(v) * 86400000);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const dd = m1[1].padStart(2, "0");
    const mm = m1[2].padStart(2, "0");
    return `${m1[3]}-${mm}-${dd}`;
  }
  return null;
}
