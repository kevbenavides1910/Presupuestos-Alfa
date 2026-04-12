import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { ok, unauthorized, forbidden, notFound, serverError, badRequest } from "@/lib/api/response";
import { Decimal } from "@prisma/client/runtime/library";

type Ctx = { params: Promise<{ id: string }> };

function toNum(v: Decimal | number | string): number {
  return parseFloat(v.toString());
}

async function buildDistributions(expenseId: string, totalAmount: number) {
  // Only ACTIVE or PROLONGATION contracts across all companies
  const contracts = await prisma.contract.findMany({
    where: { status: { in: ["ACTIVE", "PROLONGATION"] }, deletedAt: null },
    orderBy: [{ company: "asc" }, { client: "asc" }],
  });

  // Use supplies budget (monthlyBilling × suppliesBudgetPct) as the weight
  const totalSuppliesBudget = contracts.reduce(
    (s, c) => s + toNum(c.monthlyBilling) * toNum(c.suppliesBudgetPct),
    0
  );
  if (totalSuppliesBudget === 0) return [];

  return contracts.map((c) => {
    const suppliesBudget = toNum(c.monthlyBilling) * toNum(c.suppliesBudgetPct);
    const eqPct = suppliesBudget / totalSuppliesBudget;
    return {
      expenseId,
      contractId: c.id,
      equivalencePct: eqPct,
      allocatedAmount: parseFloat((totalAmount * eqPct).toFixed(2)),
      // preview-only fields (not stored)
      licitacionNo: c.licitacionNo,
      client: c.client,
      company: c.company,
      suppliesBudget,
    };
  });
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  try {
    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) return notFound();
    if (!expense.isDeferred) return badRequest("Solo los gastos diferidos se distribuyen");

    const totalAmount = toNum(expense.amount);
    const rows = await buildDistributions(id, totalAmount);

    const preview = rows.map((r) => ({
      contractId: r.contractId,
      licitacionNo: r.licitacionNo,
      client: r.client,
      company: r.company,
      equivalencePct: r.equivalencePct,
      allocatedAmount: r.allocatedAmount,
      suppliesBudget: r.suppliesBudget,
    }));

    return ok(preview);
  } catch (e) {
    return serverError("Error al previsualizar distribución", e);
  }
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  const { id } = await params;
  try {
    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) return notFound();
    if (!expense.isDeferred) return badRequest("Solo los gastos diferidos se distribuyen");
    if (expense.isDistributed) return badRequest("Este gasto ya fue distribuido");

    const totalAmount = toNum(expense.amount);
    const rows = await buildDistributions(id, totalAmount);
    if (rows.length === 0) return badRequest("No hay contratos activos para distribuir");

    const distributions = rows.map((r) => ({
      expenseId: r.expenseId,
      contractId: r.contractId,
      equivalencePct: r.equivalencePct,
      allocatedAmount: r.allocatedAmount,
    }));

    await prisma.$transaction([
      prisma.expenseDistribution.deleteMany({ where: { expenseId: id } }),
      prisma.expenseDistribution.createMany({ data: distributions }),
      prisma.expense.update({ where: { id }, data: { isDistributed: true } }),
    ]);

    return ok({ distributed: true, count: distributions.length });
  } catch (e) {
    return serverError("Error al distribuir gasto", e);
  }
}
