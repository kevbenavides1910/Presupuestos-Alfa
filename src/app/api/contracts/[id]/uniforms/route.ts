import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { uniformExpenseSchema } from "@/lib/validations/expense.schema";
import { fromMonthString } from "@/lib/utils/format";
import { UNIFORM_ITEMS } from "@/lib/utils/constants";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  const expenses = await prisma.uniformExpense.findMany({
    where: { contractId: id },
    orderBy: { periodMonth: "desc" },
  });

  return ok(expenses.map((e) => ({
    ...e,
    totalCost: parseFloat(e.totalCost.toString()),
  })));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  const { id } = await params;
  try {
    const body = await req.json();
    const parsed = uniformExpenseSchema.safeParse({ ...body, contractId: id });
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const data = parsed.data;
    const periodMonth = fromMonthString(data.periodMonth);

    // Calculate total
    let totalCost = 0;
    for (const item of UNIFORM_ITEMS) {
      const qty = data[item.qtyKey as keyof typeof data] as number ?? 0;
      const cost = data[item.costKey as keyof typeof data] as number ?? 0;
      totalCost += qty * cost;
    }

    const expense = await prisma.uniformExpense.upsert({
      where: { contractId_periodMonth: { contractId: id, periodMonth } },
      update: { ...data, periodMonth, totalCost, createdById: session.user.id },
      create: { ...data, contractId: id, periodMonth, totalCost, createdById: session.user.id },
    });

    return created({ ...expense, totalCost: parseFloat(expense.totalCost.toString()) });
  } catch (e) {
    return serverError("Error al registrar gasto de uniformes", e);
  }
}
