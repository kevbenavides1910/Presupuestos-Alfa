import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, conflict, serverError } from "@/lib/api/response";
import { adminExpenseSchema } from "@/lib/validations/expense.schema";
import { fromMonthString } from "@/lib/utils/format";
import { CompanyName } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { searchParams } = new URL(req.url);
  const company = searchParams.get("company") as CompanyName | null;
  const month = searchParams.get("month");

  const where: Record<string, unknown> = {};
  if (session.user.company) where.company = session.user.company;
  else if (company) where.company = company;
  if (month) where.periodMonth = fromMonthString(month);

  const expenses = await prisma.adminExpense.findMany({
    where,
    orderBy: [{ periodMonth: "desc" }],
  });

  return ok(expenses.map((e) => ({
    ...e,
    transport: parseFloat(e.transport.toString()),
    adminCosts: parseFloat(e.adminCosts.toString()),
    phones: parseFloat(e.phones.toString()),
    phoneLines: parseFloat(e.phoneLines.toString()),
    fuel: parseFloat(e.fuel.toString()),
    otherAmount: parseFloat(e.otherAmount.toString()),
    totalAmount: parseFloat(e.totalAmount.toString()),
  })));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  try {
    const body = await req.json();
    const parsed = adminExpenseSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const data = parsed.data;
    const periodMonth = fromMonthString(data.periodMonth);

    // Check duplicate
    const existing = await prisma.adminExpense.findUnique({
      where: { company_periodMonth: { company: data.company, periodMonth } },
    });
    if (existing) return conflict("Ya existe un registro de gastos administrativos para esta empresa y período");

    const totalAmount = data.transport + data.adminCosts + data.phones + data.phoneLines + data.fuel + data.otherAmount;

    const expense = await prisma.adminExpense.create({
      data: { ...data, periodMonth, totalAmount, createdById: session.user.id },
    });

    return created({ ...expense, totalAmount: parseFloat(expense.totalAmount.toString()) });
  } catch (e) {
    return serverError("Error al crear gastos administrativos", e);
  }
}
