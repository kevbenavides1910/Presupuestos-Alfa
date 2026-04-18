import type { Prisma, PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

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

type DbClient = {
  contract: PrismaClient["contract"];
  expense: PrismaClient["expense"];
  expenseDistribution: PrismaClient["expenseDistribution"];
};

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

export async function applyDeferredExpenseDistributionsTx(
  tx: Prisma.TransactionClient,
  expenseId: string
): Promise<void> {
  const expense = await tx.expense.findUnique({ where: { id: expenseId } });
  if (!expense?.isDeferred) return;
  if (expense.approvalStatus === "REJECTED") return;

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
