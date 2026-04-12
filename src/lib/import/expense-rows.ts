import { expenseCreateSchema, type ExpenseCreateInput } from "@/lib/validations/expense.schema";
import { pickCell, parseNumber, rowToNormalized } from "./xlsx-read";
import { parseBoolCell, parseCompanyCell, parseExpenseBudgetLineCell, parseExpenseTypeCell } from "./parse-enums";

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

/** Mes período YYYY-MM */
function parsePeriodMonth(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (month >= 1 && month <= 12) return `${year}-${String(month).padStart(2, "0")}`;
  }
  return null;
}

/**
 * Mapea fila Excel a datos de gasto.
 * `contractIdByLicitacion` debe incluir la licitación indicada en la columna (si no es diferido).
 */
export function expenseRowFromSheet(
  row: Record<string, unknown>,
  sheetRow: number,
  contractIdByLicitacion: Map<string, { id: string; company: string }>,
  originIdByName: Map<string, string>
): { ok: true; data: ExpenseCreateInput } | { ok: false; sheetRow: number; message: string } {
  const norm = rowToNormalized(row);

  const type = parseExpenseTypeCell(pickCell(norm, ["tipo", "type", "tipo_gasto"]));
  if (!type) {
    return { ok: false, sheetRow, message: "Tipo de gasto no reconocido" };
  }

  const budgetLine = parseExpenseBudgetLineCell(
    pickCell(norm, ["partida", "budget_line", "linea_presupuestaria", "partida_presupuestaria"])
  );
  if (!budgetLine) {
    return { ok: false, sheetRow, message: "Partida presupuestaria inválida (Mano de obra, Insumos, etc.)" };
  }

  const description = str(pickCell(norm, ["descripcion", "description", "concepto"]));
  const amount = parseNumber(pickCell(norm, ["monto", "amount", "importe", "total"]));
  const periodMonth = parsePeriodMonth(pickCell(norm, ["mes", "periodo", "period_month", "mes_periodo"]));

  const licitacionNo = str(
    pickCell(norm, ["licitacion_no", "licitacion", "contrato", "no_licitacion", "licitacionno"])
  );

  const deferredRaw = pickCell(norm, ["diferido", "is_deferred", "global", "diferido_global"]);
  const isDeferred =
    deferredRaw !== undefined && deferredRaw !== null && String(deferredRaw).trim() !== ""
      ? parseBoolCell(deferredRaw)
      : false;
  if (isDeferred === null) {
    return { ok: false, sheetRow, message: "Valor de «diferido» inválido (sí/no)" };
  }

  let contractId: string | undefined;
  let companyFromContract: string | undefined;

  if (!isDeferred) {
    if (!licitacionNo) {
      return { ok: false, sheetRow, message: "Indique licitación del contrato o marque gasto como diferido" };
    }
    const c = contractIdByLicitacion.get(licitacionNo.trim());
    if (!c) {
      return { ok: false, sheetRow, message: `No hay contrato con licitación «${licitacionNo.trim()}»` };
    }
    contractId = c.id;
    companyFromContract = c.company;
  }

  const companyCell = pickCell(norm, ["empresa", "company", "compania"]);
  const companyParsed = companyCell !== undefined && companyCell !== null && String(companyCell).trim() !== ""
    ? parseCompanyCell(companyCell)
    : null;
  const company = companyParsed ?? (companyFromContract as ExpenseCreateInput["company"]);
  if (!company) {
    return {
      ok: false,
      sheetRow,
      message: "Empresa requerida (columna o deducida del contrato)",
    };
  }

  if (!description || description.length < 2) {
    return { ok: false, sheetRow, message: "Descripción requerida (mín. 2 caracteres)" };
  }
  if (amount === null || amount <= 0) {
    return { ok: false, sheetRow, message: "Monto debe ser un número positivo" };
  }
  if (!periodMonth) {
    return { ok: false, sheetRow, message: "Mes inválido (use YYYY-MM o mes/año)" };
  }

  const originName = str(pickCell(norm, ["origen", "origin", "origen_gasto"]));
  let originId: string | undefined;
  if (originName) {
    const key = originName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    originId = originIdByName.get(key);
    if (!originId) {
      return { ok: false, sheetRow, message: `Origen «${originName}» no encontrado en catálogo` };
    }
  }

  const referenceNumber = str(pickCell(norm, ["referencia", "reference", "reference_number", "numero_referencia"]));
  const notesRaw = pickCell(norm, ["notas", "notes", "observaciones"]);
  const notes =
    notesRaw !== undefined && notesRaw !== null && String(notesRaw).trim() !== ""
      ? String(notesRaw).trim()
      : undefined;

  const spreadRaw = pickCell(norm, ["meses_prorrateo", "spread_months", "prorrateo"]);
  const spreadMonths = spreadRaw !== undefined && spreadRaw !== null && String(spreadRaw).trim() !== ""
    ? Math.round(Number(parseNumber(spreadRaw)))
    : 1;

  const raw: Record<string, unknown> = {
    type,
    budgetLine,
    description,
    amount,
    periodMonth,
    contractId,
    originId,
    referenceNumber: referenceNumber || undefined,
    company,
    isDeferred,
    notes,
    spreadMonths: Number.isFinite(spreadMonths) && spreadMonths >= 1 ? spreadMonths : 1,
  };

  const parsed = expenseCreateSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors;
    const msg = Object.values(first).flat()[0] ?? parsed.error.message;
    return { ok: false, sheetRow, message: String(msg) };
  }

  return { ok: true, data: parsed.data };
}

/** Licitaciones a resolver contra la BD (filas no vacías, no diferidas, con número de licitación). */
export function collectLicitacionesFromExpenseRows(rows: Record<string, unknown>[]): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    if (isEmptyExpenseRow(row)) continue;
    const norm = rowToNormalized(row);
    const lic = str(
      pickCell(norm, ["licitacion_no", "licitacion", "contrato", "no_licitacion", "licitacionno"])
    );
    const deferredRaw = pickCell(norm, ["diferido", "is_deferred", "global", "diferido_global"]);
    const isDeferred =
      deferredRaw !== undefined && deferredRaw !== null && String(deferredRaw).trim() !== ""
        ? parseBoolCell(deferredRaw)
        : false;
    if (isDeferred === true) continue;
    if (lic) out.add(lic.trim());
  }
  return [...out];
}

export function isEmptyExpenseRow(row: Record<string, unknown>): boolean {
  const norm = rowToNormalized(row);
  const desc = str(pickCell(norm, ["descripcion", "description", "concepto"]));
  const amt = pickCell(norm, ["monto", "amount", "importe"]);
  return !desc && (amt === undefined || amt === null || String(amt).trim() === "");
}
