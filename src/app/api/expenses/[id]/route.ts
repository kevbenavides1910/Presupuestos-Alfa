import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses, isAdmin } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";
import type { ExpenseBudgetLine, ExpenseType, Prisma } from "@prisma/client";
import { companyCodeSchema } from "@/lib/validations/company-code";
import { requireCompanyCode } from "@/lib/server/companies";
import { canViewExpenseDetail, isCurrentApprover } from "@/lib/server/expense-approval";
import { applyDeferredExpenseDistributionsTx } from "@/lib/server/deferred-expense-distribution";

type Ctx = { params: Promise<{ id: string }> };

const EXPENSE_TYPES = ["APERTURA", "UNIFORMS", "AUDIT", "ADMIN", "TRANSPORT", "FUEL", "PHONES", "PLANILLA", "OTHER"] as const;
const BUDGET_LINES = ["LABOR", "SUPPLIES", "ADMIN", "PROFIT"] as const;

const patchExpenseSchema = z
  .object({
    type: z.enum(EXPENSE_TYPES).optional(),
    budgetLine: z.enum(BUDGET_LINES).nullable().optional(),
    description: z.string().min(2, "Descripción muy corta").optional(),
    originId: z.string().nullable().optional(),
    referenceNumber: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    company: companyCodeSchema.nullable().optional(),
    registroCxp: z.string().nullable().optional(),
    registroTr: z.string().nullable().optional(),
    /** Vacío en API = todos los contratos activos en el reparto. */
    deferredIncludeContractIds: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (d) =>
      d.type !== undefined ||
      d.budgetLine !== undefined ||
      d.description !== undefined ||
      d.originId !== undefined ||
      d.referenceNumber !== undefined ||
      d.notes !== undefined ||
      d.company !== undefined ||
      d.registroCxp !== undefined ||
      d.registroTr !== undefined ||
      d.deferredIncludeContractIds !== undefined,
    { message: "Indique al menos un campo a actualizar" }
  );

const patchLimitedSchema = z
  .object({
    notes: z.string().nullable().optional(),
    registroCxp: z.string().nullable().optional(),
    registroTr: z.string().nullable().optional(),
    /** Los aprobadores actuales pueden ajustar el reparto antes de decidir. */
    deferredIncludeContractIds: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (d) =>
      d.notes !== undefined ||
      d.registroCxp !== undefined ||
      d.registroTr !== undefined ||
      d.deferredIncludeContractIds !== undefined,
    { message: "Indique al menos un campo a actualizar" }
  );

const expenseInclude = {
  contract: { select: { id: true, licitacionNo: true, client: true, company: true } },
  position: {
    include: {
      location: { select: { id: true, name: true } },
    },
  },
  origin: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  distributions: {
    include: { contract: { select: { licitacionNo: true, client: true } } },
  },
  approvals: {
    orderBy: { decidedAt: "asc" as const },
    include: { approver: { select: { id: true, name: true, email: true } } },
  },
  attachments: {
    orderBy: { createdAt: "asc" as const },
    include: { uploadedBy: { select: { id: true, name: true } } },
  },
} as const;

type ExpenseDetailRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

function serializeExpense(e: ExpenseDetailRow) {
  return {
    ...e,
    amount: parseFloat(e.amount.toString()),
    periodMonth: e.periodMonth.toISOString(),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    distributions: e.distributions.map((d) => ({
      ...d,
      equivalencePct: parseFloat(d.equivalencePct.toString()),
      allocatedAmount: parseFloat(d.allocatedAmount.toString()),
    })),
    approvals: e.approvals.map((a) => ({
      ...a,
      decidedAt: a.decidedAt.toISOString(),
    })),
    attachments: e.attachments.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
      downloadUrl: `/api/expenses/${e.id}/attachments/${a.id}`,
    })),
  };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  try {
    const can = await canViewExpenseDetail(session, id);
    if (!can) return forbidden();

    const expense = await prisma.expense.findUnique({
      where: { id },
      include: expenseInclude,
    });
    if (!expense) return notFound("Gasto no encontrado");

    return ok(serializeExpense(expense));
  } catch (e) {
    return serverError("Error al obtener gasto", e);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { id } = await params;
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) return notFound("Gasto no encontrado");

    const body = await req.json();

    if (canManageExpenses(session.user.role)) {
      const parsed = patchExpenseSchema.safeParse(body);
      if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

      const p = parsed.data;
      if (p.company !== undefined && p.company !== null) {
        const chk = await requireCompanyCode(prisma, p.company, { mustBeActive: true });
        if (!chk.ok) return badRequest(chk.message);
      }
      const data: {
        type?: ExpenseType;
        budgetLine?: ExpenseBudgetLine | null;
        description?: string;
        originId?: string | null;
        referenceNumber?: string | null;
        notes?: string | null;
        company?: string | null;
        registroCxp?: string | null;
        registroTr?: string | null;
        deferredIncludeContractIds?: string[];
      } = {};
      if (p.type !== undefined) data.type = p.type;
      if (p.budgetLine !== undefined) data.budgetLine = p.budgetLine;
      if (p.description !== undefined) data.description = p.description;
      if (p.originId !== undefined) data.originId = p.originId;
      if (p.referenceNumber !== undefined) data.referenceNumber = p.referenceNumber;
      if (p.notes !== undefined) data.notes = p.notes;
      if (p.company !== undefined) data.company = p.company;
      if (p.registroCxp !== undefined) data.registroCxp = p.registroCxp;
      if (p.registroTr !== undefined) data.registroTr = p.registroTr;

      if (p.deferredIncludeContractIds !== undefined) {
        if (!existing.isDeferred) return badRequest("Solo aplica a gastos diferidos");
        if (existing.approvalStatus === "REJECTED") {
          return badRequest("No se puede editar el reparto de un gasto rechazado");
        }
        const ids = p.deferredIncludeContractIds;
        if (ids.length > 0) {
          const okIds = await prisma.contract.findMany({
            where: {
              id: { in: ids },
              status: { in: ["ACTIVE", "PROLONGATION"] },
              deletedAt: null,
            },
            select: { id: true },
          });
          if (okIds.length !== ids.length) {
            return badRequest("Algunos contratos no son válidos o no están activos para reparto");
          }
        }
        data.deferredIncludeContractIds = ids;
      }

      const shouldReapplyDeferred = p.deferredIncludeContractIds !== undefined;

      if (shouldReapplyDeferred) {
        const updated = await prisma.$transaction(async (tx) => {
          await tx.expense.update({ where: { id }, data });
          await applyDeferredExpenseDistributionsTx(tx, id);
          const row = await tx.expense.findUnique({ where: { id }, include: expenseInclude });
          if (!row) throw new Error("Gasto no encontrado tras actualizar");
          return row;
        });
        return ok(serializeExpense(updated));
      }

      const updated = await prisma.expense.update({
        where: { id },
        data,
        include: expenseInclude,
      });

      return ok(serializeExpense(updated));
    }

    const isCreator = existing.createdById === session.user.id;
    const isApprover = await isCurrentApprover(session, id);
    const canMeta = isAdmin(session.user.role) || isCreator || isApprover;
    if (!canMeta) return forbidden();

    const parsed = patchLimitedSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const p = parsed.data;

    // Validación y preparación del reparto diferido (si se envió).
    // Solo aprobadores actuales o el creador pueden tocarlo en esta ruta limitada.
    let deferredIdsToSave: string[] | undefined;
    if (p.deferredIncludeContractIds !== undefined) {
      if (!existing.isDeferred) return badRequest("Solo aplica a gastos diferidos");
      if (existing.approvalStatus === "REJECTED") {
        return badRequest("No se puede editar el reparto de un gasto rechazado");
      }
      if (!isAdmin(session.user.role) && !isApprover && !isCreator) {
        return forbidden();
      }
      const ids = p.deferredIncludeContractIds;
      if (ids.length > 0) {
        const okIds = await prisma.contract.findMany({
          where: {
            id: { in: ids },
            status: { in: ["ACTIVE", "PROLONGATION"] },
            deletedAt: null,
          },
          select: { id: true },
        });
        if (okIds.length !== ids.length) {
          return badRequest("Algunos contratos no son válidos o no están activos para reparto");
        }
      }
      deferredIdsToSave = ids;
    }

    const baseData = {
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
      ...(p.registroCxp !== undefined ? { registroCxp: p.registroCxp } : {}),
      ...(p.registroTr !== undefined ? { registroTr: p.registroTr } : {}),
      ...(deferredIdsToSave !== undefined
        ? { deferredIncludeContractIds: deferredIdsToSave }
        : {}),
    };

    if (deferredIdsToSave !== undefined) {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.expense.update({ where: { id }, data: baseData });
        await applyDeferredExpenseDistributionsTx(tx, id);
        const row = await tx.expense.findUnique({ where: { id }, include: expenseInclude });
        if (!row) throw new Error("Gasto no encontrado tras actualizar");
        return row;
      });
      return ok(serializeExpense(updated));
    }

    const updated = await prisma.expense.update({
      where: { id },
      data: baseData,
      include: expenseInclude,
    });

    return ok(serializeExpense(updated));
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

    await prisma.expense.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError("Error al eliminar gasto", e);
  }
}
