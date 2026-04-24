import type { Prisma, PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { assignableContractStatusWhereInput } from "@/lib/server/assignable-contract-where";

function toNum(v: Decimal | number | string): number {
  return parseFloat(v.toString());
}

export type DeferredPreviewRow = {
  expenseId: string;
  contractId: string;
  equivalencePct: number;
  allocatedAmount: number;
  licitacionNo: string;
  client: string;
  company: string;
  suppliesBudget: number;
};

export type ManualAllocRow = { contractId: string; amount: number };

type DbClient = {
  contract: PrismaClient["contract"];
  expense: PrismaClient["expense"];
  expenseDistribution: PrismaClient["expenseDistribution"];
};

/**
 * Interpreta JSON guardado en Expense.deferredManualAllocations.
 */
export function parseDeferredManualAllocationsJson(json: unknown): ManualAllocRow[] | null {
  if (json === null || json === undefined) return null;
  if (!Array.isArray(json)) return null;
  const out: ManualAllocRow[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object") return null;
    const o = row as Record<string, unknown>;
    const contractId = o.contractId;
    const amount = o.amount;
    if (typeof contractId !== "string" || contractId.length < 1) return null;
    const n = typeof amount === "number" ? amount : typeof amount === "string" ? parseFloat(amount) : NaN;
    if (!Number.isFinite(n) || n <= 0) return null;
    out.push({ contractId, amount: n });
  }
  return out.length > 0 ? out : null;
}

/** Ajusta hasta 1 centavo de diferencia para que la suma en centavos coincida con el total del gasto. */
export function normalizeManualAllocationsToTotalCents(
  rows: ManualAllocRow[],
  totalAmount: number
): ManualAllocRow[] {
  const totalCents = Math.round(totalAmount * 100);
  const cents = rows.map((r) => ({
    contractId: r.contractId,
    cents: Math.round(r.amount * 100),
  }));
  const sum = cents.reduce((s, r) => s + r.cents, 0);
  const diff = totalCents - sum;
  if (Math.abs(diff) > 1) {
    throw new Error(
      `La suma manual (${(sum / 100).toFixed(2)}) no coincide con el monto del gasto (${totalAmount.toFixed(2)})`
    );
  }
  if (diff !== 0 && cents.length > 0) {
    const last = cents[cents.length - 1];
    cents[cents.length - 1] = { ...last, cents: last.cents + diff };
  }
  return cents.map((r) => ({ contractId: r.contractId, amount: r.cents / 100 }));
}

/** Valida que los IDs existan y sean asignables (misma regla que buscador de contratos en gastos). */
export async function validateManualAllocationsAgainstContracts(
  db: Pick<PrismaClient, "contract">,
  rows: ManualAllocRow[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ids = [...new Set(rows.map((r) => r.contractId))];
  const contracts = await db.contract.findMany({
    where: {
      id: { in: ids },
      deletedAt: null,
      ...assignableContractStatusWhereInput(),
    },
    select: { id: true },
  });
  if (contracts.length !== ids.length) {
    return { ok: false, message: "Algunos contratos no son válidos o no están activos para reparto" };
  }
  return { ok: true };
}

/**
 * Reparto proporcional por presupuesto de insumos (facturación × % insumos) entre contratos ACTIVE/PROLONGATION.
 * Si includeContractIds está vacío, se usan todos los contratos elegibles.
 * Si tiene valores, solo esos IDs (deben ser un subconjunto de los elegibles).
 */
export async function buildDeferredDistributionPreview(
  db: DbClient,
  expenseId: string,
  totalAmount: number,
  includeContractIds: string[]
): Promise<DeferredPreviewRow[]> {
  const contracts = await db.contract.findMany({
    where: { status: { in: ["ACTIVE", "PROLONGATION"] }, deletedAt: null },
    orderBy: [{ company: "asc" }, { client: "asc" }],
  });

  let selected = contracts;
  if (includeContractIds.length > 0) {
    const idSet = new Set(includeContractIds);
    selected = contracts.filter((c) => idSet.has(c.id));
  }

  const totalSuppliesBudget = selected.reduce(
    (s, c) => s + toNum(c.monthlyBilling) * toNum(c.suppliesBudgetPct),
    0
  );
  if (totalSuppliesBudget === 0) return [];

  return selected.map((c) => {
    const suppliesBudget = toNum(c.monthlyBilling) * toNum(c.suppliesBudgetPct);
    const eqPct = suppliesBudget / totalSuppliesBudget;
    return {
      expenseId,
      contractId: c.id,
      equivalencePct: eqPct,
      allocatedAmount: parseFloat((totalAmount * eqPct).toFixed(2)),
      licitacionNo: c.licitacionNo,
      client: c.client,
      company: c.company,
      suppliesBudget,
    };
  });
}

function previewToCreateRows(
  rows: DeferredPreviewRow[]
): { expenseId: string; contractId: string; equivalencePct: number; allocatedAmount: number }[] {
  return rows.map((r) => ({
    expenseId: r.expenseId,
    contractId: r.contractId,
    equivalencePct: r.equivalencePct,
    allocatedAmount: r.allocatedAmount,
  }));
}

async function applyManualDeferredDistributionsTx(
  tx: Prisma.TransactionClient,
  expenseId: string,
  expense: { amount: Decimal; deferredManualAllocations: unknown; company: string | null }
): Promise<void> {
  const manual = parseDeferredManualAllocationsJson(expense.deferredManualAllocations);
  const totalAmount = toNum(expense.amount);

  if (!manual?.length) {
    await tx.expenseDistribution.deleteMany({ where: { expenseId } });
    await tx.expense.update({ where: { id: expenseId }, data: { isDistributed: false } });
    return;
  }

  let normalized: ManualAllocRow[];
  try {
    normalized = normalizeManualAllocationsToTotalCents(manual, totalAmount);
  } catch {
    await tx.expenseDistribution.deleteMany({ where: { expenseId } });
    await tx.expense.update({ where: { id: expenseId }, data: { isDistributed: false } });
    return;
  }

  const contractIds = [...new Set(normalized.map((r) => r.contractId))];
  const contracts = await tx.contract.findMany({
    where: {
      id: { in: contractIds },
      deletedAt: null,
      ...assignableContractStatusWhereInput(),
    },
    select: { id: true, licitacionNo: true, client: true, company: true },
  });
  const byId = new Map(contracts.map((c) => [c.id, c]));
  if (contractIds.some((id) => !byId.has(id))) {
    await tx.expenseDistribution.deleteMany({ where: { expenseId } });
    await tx.expense.update({ where: { id: expenseId }, data: { isDistributed: false } });
    return;
  }

  const data = normalized.map((r) => {
    const eq = totalAmount > 0 ? r.amount / totalAmount : 0;
    return {
      expenseId,
      contractId: r.contractId,
      equivalencePct: eq,
      allocatedAmount: r.amount,
    };
  });

  await tx.expenseDistribution.deleteMany({ where: { expenseId } });
  await tx.expenseDistribution.createMany({ data });
  await tx.expense.update({
    where: { id: expenseId },
    data: {
      isDistributed: true,
      deferredIncludeContractIds: contractIds,
    },
  });
}

export async function applyDeferredExpenseDistributionsTx(
  tx: Prisma.TransactionClient,
  expenseId: string
): Promise<void> {
  const expense = await tx.expense.findUnique({ where: { id: expenseId } });
  if (!expense?.isDeferred) return;
  if (expense.approvalStatus === "REJECTED") return;

  if (expense.deferredManualDistribution) {
    await applyManualDeferredDistributionsTx(tx, expenseId, expense);
    return;
  }

  const includeIds = expense.deferredIncludeContractIds ?? [];
  const totalAmount = toNum(expense.amount);
  const preview = await buildDeferredDistributionPreview(tx, expenseId, totalAmount, includeIds);

  if (preview.length === 0) {
    await tx.expenseDistribution.deleteMany({ where: { expenseId } });
    await tx.expense.update({ where: { id: expenseId }, data: { isDistributed: false } });
    return;
  }

  const data = previewToCreateRows(preview);
  await tx.expenseDistribution.deleteMany({ where: { expenseId } });
  await tx.expenseDistribution.createMany({ data });
  await tx.expense.update({ where: { id: expenseId }, data: { isDistributed: true } });
}

export async function applyDeferredExpenseDistributions(prisma: PrismaClient, expenseId: string): Promise<void> {
  await prisma.$transaction((tx) => applyDeferredExpenseDistributionsTx(tx, expenseId));
}
