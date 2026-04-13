import { contractCreateSchema, type ContractCreateInput } from "@/lib/validations/contract.schema";
import { pickCell, parseNumber, parsePercent, parseDateCell, rowToNormalized } from "./xlsx-read";
import { parseClientTypeCell, parseCompanyCell, parseContractStatusCell } from "./parse-enums";

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function parseIntCell(v: unknown): number | null {
  const n = parseNumber(v);
  if (n === null) return null;
  const i = Math.round(n);
  if (!Number.isFinite(i)) return null;
  return i;
}

/** Distribución por defecto cuando el Excel no trae las cuatro partidas (suma 100%). */
const DEFAULT_PCT = {
  laborPct: 0.65,
  suppliesPct: 0.15,
  adminPct: 0.12,
  profitPct: 0.08,
};

/**
 * Completa porcentajes faltantes con valores por defecto y normaliza para que sumen 1.
 * Así la importación no exige columnas J–M ni que cuadren a mano.
 */
function distributionFromImport(
  labor: number | null,
  supplies: number | null,
  admin: number | null,
  profit: number | null
): { laborPct: number; suppliesPct: number; adminPct: number; profitPct: number } {
  let l = labor ?? DEFAULT_PCT.laborPct;
  let s = supplies ?? DEFAULT_PCT.suppliesPct;
  let a = admin ?? DEFAULT_PCT.adminPct;
  let p = profit ?? DEFAULT_PCT.profitPct;
  const sum = l + s + a + p;
  if (sum <= 0) {
    return { ...DEFAULT_PCT };
  }
  if (Math.abs(sum - 1) > 0.0001) {
    l /= sum;
    s /= sum;
    a /= sum;
    p /= sum;
  }
  return { laborPct: l, suppliesPct: s, adminPct: a, profitPct: p };
}

/** Fila Excel (objeto con cabeceras) → entrada create contrato. `sheetRow` = número de fila en hoja (1 = encabezado). */
export function contractRowFromSheet(
  row: Record<string, unknown>,
  sheetRow: number,
  companyCatalog: { code: string; name: string }[]
): { ok: true; data: ContractCreateInput } | { ok: false; sheetRow: number; message: string } {
  const norm = rowToNormalized(row);

  const licitacionNo = str(
    pickCell(norm, ["licitacion_no", "licitacion", "no_licitacion", "licitacionno", "n_licitacion"])
  );
  if (!licitacionNo) {
    return { ok: false, sheetRow, message: "Falta número de licitación" };
  }

  const company = parseCompanyCell(pickCell(norm, ["empresa", "company", "compania"]), companyCatalog);
  if (!company) {
    return { ok: false, sheetRow, message: "Empresa inválida o vacía" };
  }

  const client = str(pickCell(norm, ["cliente", "client", "razon_social"]));
  const clientType = parseClientTypeCell(pickCell(norm, ["tipo_cliente", "client_type", "tipo"]));
  if (!clientType) {
    return { ok: false, sheetRow, message: "Tipo de cliente inválido (Pública / Privada o PUBLIC / PRIVATE)" };
  }

  const officersParsed = parseIntCell(pickCell(norm, ["oficiales", "officers_count", "oficiales_count"]));
  const positionsParsed = parseIntCell(pickCell(norm, ["puestos", "positions_count", "puestos_count"]));
  const startRaw = pickCell(norm, [
    "fecha_inicio",
    "inicio",
    "start_date",
    "fecha_de_inicio",
    "fecha_inicial",
    "inicio_contrato",
    "fecha_inicio_contrato",
  ]);
  const endRaw = pickCell(norm, [
    "fecha_fin",
    "fin",
    "end_date",
    "fecha_de_cierre",
    "cierre",
    "fecha_final",
    "fin_contrato",
    "fecha_fin_contrato",
  ]);
  const startDate = parseDateCell(startRaw);
  const endDate = parseDateCell(endRaw);
  if (!startDate) {
    const hint =
      startRaw !== undefined && startRaw !== null && String(startRaw).trim() !== ""
        ? ` (valor: «${String(startRaw).slice(0, 60)}»)`
        : "";
    return { ok: false, sheetRow, message: `Fecha de inicio inválida o vacía${hint}` };
  }
  if (!endDate) {
    const hint =
      endRaw !== undefined && endRaw !== null && String(endRaw).trim() !== ""
        ? ` (valor: «${String(endRaw).slice(0, 60)}»)`
        : "";
    return { ok: false, sheetRow, message: `Fecha de cierre inválida o vacía${hint}` };
  }

  const monthlyBilling = parseNumber(pickCell(norm, ["facturacion_mensual", "monthly_billing", "facturacion"]));
  const laborPctRaw = parsePercent(pickCell(norm, ["labor_pct", "mano_obra", "mano_de_obra_pct", "mo_pct"]));
  const suppliesPctRaw = parsePercent(pickCell(norm, ["supplies_pct", "insumos_pct", "insumos"]));
  const adminPctRaw = parsePercent(pickCell(norm, ["admin_pct", "gasto_admin_pct", "administrativo_pct"]));
  const profitPctRaw = parsePercent(pickCell(norm, ["profit_pct", "utilidad_pct", "utilidad"]));
  const { laborPct, suppliesPct, adminPct, profitPct } = distributionFromImport(
    laborPctRaw,
    suppliesPctRaw,
    adminPctRaw,
    profitPctRaw
  );

  if (monthlyBilling === null || monthlyBilling <= 0) {
    return { ok: false, sheetRow, message: "Facturación mensual debe ser un número positivo" };
  }
  const officersCount = Math.max(1, officersParsed ?? 0);
  const positionsCount = Math.max(1, positionsParsed ?? 0);

  const statusRaw = pickCell(norm, ["estado", "status"]);
  const status = statusRaw !== undefined && statusRaw !== null && String(statusRaw).trim() !== ""
    ? parseContractStatusCell(statusRaw)
    : "ACTIVE";
  if (!status) {
    return { ok: false, sheetRow, message: "Estado de contrato no reconocido" };
  }

  const notesRaw = pickCell(norm, ["notas", "notes", "observaciones"]);
  const notes = notesRaw !== undefined && notesRaw !== null && String(notesRaw).trim() !== ""
    ? String(notesRaw).trim()
    : undefined;

  const raw = {
    licitacionNo,
    company,
    client: client.length >= 2 ? client : null,
    clientType,
    officersCount,
    positionsCount,
    startDate,
    endDate,
    monthlyBilling,
    laborPct,
    suppliesPct,
    adminPct,
    profitPct,
    status,
    notes,
  };

  if (!raw.client) {
    return { ok: false, sheetRow, message: "Cliente requerido (mín. 2 caracteres)" };
  }

  const parsed = contractCreateSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors;
    const msg = Object.values(first).flat()[0] ?? parsed.error.message;
    return { ok: false, sheetRow, message: String(msg) };
  }

  return { ok: true, data: parsed.data };
}

/** Si la fila está totalmente vacía (sin licitación ni cliente), se puede omitir. */
export function isEmptyContractRow(row: Record<string, unknown>): boolean {
  const norm = rowToNormalized(row);
  const lic = str(
    pickCell(norm, ["licitacion_no", "licitacion", "no_licitacion", "licitacionno", "n_licitacion"])
  );
  const client = str(pickCell(norm, ["cliente", "client", "razon_social"]));
  return !lic && !client;
}
