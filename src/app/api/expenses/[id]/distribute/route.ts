import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { ok, unauthorized, forbidden, notFound, serverError, badRequest } from "@/lib/api/response";
import {
  applyDeferredExpenseDistributions,
  buildDeferredDistributionPreview,
} from "@/lib/server/deferred-expense-distribution";
import { Decimal } from "@prisma/client/runtime/library";

type Ctx = { params: Promise<{ id: string }> };

function toNum(v: Decimal | number | string): number {
  return parseFloat(v.toString());
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  try {
    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) return notFound();
    if (!expense.isDeferred) return badRequest("Solo los gastos diferidos se distribuyen");
    if (expense.approvalStatus === "REJECTED") {
      return badRequest("Este gasto fue rechazado; no aplica reparto en presupuesto");
    }

    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("contractIds");
    const overrideIds = raw
      ? raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null;
    const includeIds =
      overrideIds ?? (Array.isArray(expense.deferredIncludeContractIds) ? expense.deferredIncludeContractIds : []);

    const totalAmount = toNum(expense.amount);
    const rows = await buildDeferredDistributionPreview(prisma, id, totalAmount, includeIds);

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
    if (expense.approvalStatus === "REJECTED") {
      return badRequest("No se puede repartir un gasto rechazado");
    }

    await applyDeferredExpenseDistributions(prisma, id);

    const count = await prisma.expenseDistribution.count({ where: { expenseId: id } });
    if (count === 0) return badRequest("No hay contratos activos para distribuir con la selección actual");

    return ok({ distributed: true, count });
  } catch (e) {
    return serverError("Error al distribuir gasto", e);
  }
}
