import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";
import type { CompanyName, ExpenseBudgetLine, ExpenseType } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const EXPENSE_TYPES = ["APERTURA", "UNIFORMS", "AUDIT", "ADMIN", "TRANSPORT", "FUEL", "PHONES", "PLANILLA", "OTHER"] as const;
const BUDGET_LINES = ["LABOR", "SUPPLIES", "ADMIN", "PROFIT"] as const;
const COMPANY_VALUES = ["CONSORCIO", "MONITOREO", "TANGO", "ALFA", "ALFATRONIC", "BENLO", "BENA", "JOBEN", "GRUPO", "ACE"] as const;

const patchExpenseSchema = z
  .object({
    type: z.enum(EXPENSE_TYPES).optional(),
    budgetLine: z.enum(BUDGET_LINES).nullable().optional(),
    description: z.string().min(2, "Descripción muy corta").optional(),
    originId: z.string().nullable().optional(),
    referenceNumber: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    company: z.enum(COMPANY_VALUES).nullable().optional(),
  })
  .refine(
    (d) =>
      d.type !== undefined ||
      d.budgetLine !== undefined ||
      d.description !== undefined ||
      d.originId !== undefined ||
      d.referenceNumber !== undefined ||
      d.notes !== undefined ||
      d.company !== undefined,
    { message: "Indique al menos un campo a actualizar" }
  );

const expenseInclude = {
  contract: { select: { id: true, licitacionNo: true, client: true, company: true } },
  position: { select: { id: true, name: true } },
  origin: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  distributions: {
    include: { contract: { select: { licitacionNo: true, client: true } } },
  },
} as const;

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  try {
    const { id } = await params;
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) return notFound("Gasto no encontrado");

    const body = await req.json();
    const parsed = patchExpenseSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const p = parsed.data;
    const data: {
      type?: ExpenseType;
      budgetLine?: ExpenseBudgetLine | null;
      description?: string;
      originId?: string | null;
      referenceNumber?: string | null;
      notes?: string | null;
      company?: CompanyName | null;
    } = {};
    if (p.type !== undefined) data.type = p.type;
    if (p.budgetLine !== undefined) data.budgetLine = p.budgetLine;
    if (p.description !== undefined) data.description = p.description;
    if (p.originId !== undefined) data.originId = p.originId;
    if (p.referenceNumber !== undefined) data.referenceNumber = p.referenceNumber;
    if (p.notes !== undefined) data.notes = p.notes;
    if (p.company !== undefined) data.company = p.company;

    const updated = await prisma.expense.update({
      where: { id },
      data,
      include: expenseInclude,
    });

    return ok({
      ...updated,
      amount: parseFloat(updated.amount.toString()),
      distributions: updated.distributions.map((d) => ({
        ...d,
        equivalencePct: parseFloat(d.equivalencePct.toString()),
        allocatedAmount: parseFloat(d.allocatedAmount.toString()),
      })),
    });
  } catch (e) {
    return serverError("Error al actualizar gasto", e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  try {
    const { id } = await params;
    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) return notFound("Gasto no encontrado");
    if (expense.isDistributed) return forbidden("No se puede eliminar un gasto ya distribuido");

    await prisma.expense.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError("Error al eliminar gasto", e);
  }
}
