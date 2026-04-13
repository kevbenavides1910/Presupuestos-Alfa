import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { deferredExpenseSchema } from "@/lib/validations/expense.schema";
import { fromMonthString } from "@/lib/utils/format";
import { requireCompanyCode } from "@/lib/server/companies";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { searchParams } = new URL(req.url);
  const company = searchParams.get("company");
  const month = searchParams.get("month");

  const where: Record<string, unknown> = {};
  if (session.user.company) where.company = session.user.company;
  else if (company) where.company = company;
  if (month) where.periodMonth = fromMonthString(month);

  const expenses = await prisma.deferredExpense.findMany({
    where,
    orderBy: [{ periodMonth: "desc" }, { createdAt: "desc" }],
    include: { distributions: { include: { contract: { select: { licitacionNo: true, client: true } } } } },
  });

  return ok(expenses.map((e) => ({
    ...e,
    totalAmount: parseFloat(e.totalAmount.toString()),
    distributions: e.distributions.map((d) => ({
      ...d,
      equivalencePct: parseFloat(d.equivalencePct.toString()),
      allocatedAmount: parseFloat(d.allocatedAmount.toString()),
    })),
  })));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  try {
    const body = await req.json();
    const parsed = deferredExpenseSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const data = parsed.data;
    const companyOk = await requireCompanyCode(prisma, data.company, { mustBeActive: true });
    if (!companyOk.ok) return badRequest(companyOk.message);

    const expense = await prisma.deferredExpense.create({
      data: {
        ...data,
        periodMonth: fromMonthString(data.periodMonth),
        createdById: session.user.id,
      },
    });

    return created({ ...expense, totalAmount: parseFloat(expense.totalAmount.toString()) });
  } catch (e) {
    return serverError("Error al crear gasto diferido", e);
  }
}
