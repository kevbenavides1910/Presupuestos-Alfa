import { prisma } from "@/lib/prisma";
import { recalculateEquivalence } from "./equivalence";
import { Decimal } from "@prisma/client/runtime/library";

function toNum(v: Decimal | number | string): number {
  return parseFloat(v.toString());
}

export interface DistributionPreview {
  contractId: string;
  licitacionNo: string;
  client: string;
  company: string;
  equivalencePct: number;
  allocatedAmount: number;
}

/** Contracts in ACTIVE or PROLONGATION status, ordered consistently. */
async function getActiveContracts() {
  return prisma.contract.findMany({
    where: {
      status: { in: ["ACTIVE", "PROLONGATION"] },
      deletedAt: null,
    },
    orderBy: [{ company: "asc" }, { client: "asc" }],
  });
}

export async function previewDeferredDistribution(
  deferredExpenseId: string
): Promise<DistributionPreview[]> {
  const expense = await prisma.deferredExpense.findUniqueOrThrow({
    where: { id: deferredExpenseId },
  });

  // Refresh global equivalence before preview
  await recalculateEquivalence();

  const contracts = await getActiveContracts();
  const totalAmount = toNum(expense.totalAmount);

  return contracts.map((c) => ({
    contractId: c.id,
    licitacionNo: c.licitacionNo,
    client: c.client,
    company: c.company,
    equivalencePct: toNum(c.equivalencePct),
    allocatedAmount: parseFloat((totalAmount * toNum(c.equivalencePct)).toFixed(2)),
  }));
}

export async function distributeDeferredExpense(deferredExpenseId: string): Promise<DistributionPreview[]> {
  const expense = await prisma.deferredExpense.findUniqueOrThrow({
    where: { id: deferredExpenseId },
  });

  if (expense.isDistributed) {
    throw new Error("Este gasto diferido ya fue distribuido.");
  }

  await recalculateEquivalence();

  const contracts = await getActiveContracts();
  const totalAmount = toNum(expense.totalAmount);

  const distributions = contracts.map((c) => {
    const eqPct = toNum(c.equivalencePct);
    return {
      deferredExpenseId,
      contractId: c.id,
      equivalencePct: eqPct,
      allocatedAmount: parseFloat((totalAmount * eqPct).toFixed(2)),
    };
  });

  await prisma.$transaction([
    prisma.deferredDistribution.deleteMany({ where: { deferredExpenseId } }),
    prisma.deferredDistribution.createMany({ data: distributions }),
    prisma.deferredExpense.update({
      where: { id: deferredExpenseId },
      data: { isDistributed: true },
    }),
  ]);

  return contracts.map((c, i) => ({
    contractId: c.id,
    licitacionNo: c.licitacionNo,
    client: c.client,
    company: c.company,
    equivalencePct: distributions[i].equivalencePct,
    allocatedAmount: distributions[i].allocatedAmount,
  }));
}

export async function distributeAdminExpense(adminExpenseId: string): Promise<DistributionPreview[]> {
  const expense = await prisma.adminExpense.findUniqueOrThrow({
    where: { id: adminExpenseId },
  });

  if (expense.isDistributed) {
    throw new Error("Este gasto administrativo ya fue distribuido.");
  }

  await recalculateEquivalence();

  const contracts = await getActiveContracts();
  const totalAmount = toNum(expense.totalAmount);

  const distributions = contracts.map((c) => {
    const eqPct = toNum(c.equivalencePct);
    return {
      adminExpenseId,
      contractId: c.id,
      equivalencePct: eqPct,
      allocatedAmount: parseFloat((totalAmount * eqPct).toFixed(2)),
    };
  });

  await prisma.$transaction([
    prisma.adminDistribution.deleteMany({ where: { adminExpenseId } }),
    prisma.adminDistribution.createMany({ data: distributions }),
    prisma.adminExpense.update({
      where: { id: adminExpenseId },
      data: { isDistributed: true },
    }),
  ]);

  return contracts.map((c, i) => ({
    contractId: c.id,
    licitacionNo: c.licitacionNo,
    client: c.client,
    company: c.company,
    equivalencePct: distributions[i].equivalencePct,
    allocatedAmount: distributions[i].allocatedAmount,
  }));
}
