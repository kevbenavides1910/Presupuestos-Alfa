import type { Session } from "next-auth";
import type {
  ExpenseApprovalDecision,
  ExpenseApprovalStatus,
  ExpenseType,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";

export type BitacoraMode = "decisions" | "submissions";

function expenseScopeWhere(session: Session): Prisma.ExpenseWhereInput {
  if (isAdmin(session.user.role)) return {};
  if (session.user.company) return { company: session.user.company };
  return { id: { in: [] as string[] } };
}

export type BitacoraListParams = {
  mode: BitacoraMode;
  page?: number;
  pageSize?: number;
  /** ISO date (inclusive), UTC boundary: start of day local parsed as Date */
  from?: string | null;
  to?: string | null;
  approverUserId?: string | null;
  decision?: ExpenseApprovalDecision | null;
  company?: string | null;
  type?: ExpenseType | null;
  approvalStatus?: ExpenseApprovalStatus | null;
  q?: string | null;
};

function parseDayStart(s: string | null | undefined): Date | undefined {
  if (!s?.trim()) return undefined;
  const d = new Date(s.trim());
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDayEnd(s: string | null | undefined): Date | undefined {
  if (!s?.trim()) return undefined;
  const d = new Date(s.trim());
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Bitácora de aprobaciones de gastos: decisiones (ExpenseApproval) o envíos al flujo (gastos con pasos > 0).
 */
export async function listExpenseApprovalBitacora(session: Session, params: BitacoraListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25));
  const scope = expenseScopeWhere(session);

  if (params.mode === "decisions") {
    const expenseFilter: Prisma.ExpenseWhereInput = { ...scope };
    if (params.company && isAdmin(session.user.role)) {
      expenseFilter.company = params.company;
    }
    if (params.type) expenseFilter.type = params.type;
    if (params.q?.trim()) {
      const q = params.q.trim();
      const orParts: Prisma.ExpenseWhereInput[] = [
        { description: { contains: q, mode: "insensitive" } },
        { referenceNumber: { contains: q, mode: "insensitive" } },
      ];
      if (/^\d+$/.test(q)) {
        orParts.push({ sequentialNo: parseInt(q, 10) });
      }
      expenseFilter.OR = orParts;
    }

    const where: Prisma.ExpenseApprovalWhereInput = {
      expense: { is: expenseFilter },
    };
    if (params.approverUserId) where.approverUserId = params.approverUserId;
    if (params.decision) where.decision = params.decision;
    const fromD = parseDayStart(params.from ?? undefined);
    const toD = parseDayEnd(params.to ?? undefined);
    if (fromD || toD) {
      where.decidedAt = {};
      if (fromD) where.decidedAt.gte = fromD;
      if (toD) where.decidedAt.lte = toD;
    }

    const [rows, total] = await Promise.all([
      prisma.expenseApproval.findMany({
        where,
        include: {
          approver: { select: { id: true, name: true, email: true } },
          expense: {
            select: {
              id: true,
              sequentialNo: true,
              description: true,
              type: true,
              company: true,
              amount: true,
              approvalStatus: true,
              requiredApprovalSteps: true,
              currentApprovalStep: true,
              createdAt: true,
              createdBy: { select: { id: true, name: true, email: true } },
            },
          },
        },
        orderBy: { decidedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.expenseApproval.count({ where }),
    ]);

    const data = rows.map((r) => ({
      kind: "decision" as const,
      id: r.id,
      stepOrder: r.stepOrder,
      decision: r.decision,
      comment: r.comment,
      decidedAt: r.decidedAt.toISOString(),
      approver: r.approver,
      expense: {
        ...r.expense,
        amount: parseFloat(r.expense.amount.toString()),
        createdAt: r.expense.createdAt.toISOString(),
      },
    }));

    return {
      mode: "decisions" as const,
      data,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  // submissions: gastos que entraron a flujo (al menos un paso de aprobación configurado al crearse)
  const expenseFilter: Prisma.ExpenseWhereInput = {
    ...scope,
    requiredApprovalSteps: { gt: 0 },
  };
  if (params.company && isAdmin(session.user.role)) {
    expenseFilter.company = params.company;
  }
  if (params.type) expenseFilter.type = params.type;
  if (params.approvalStatus) expenseFilter.approvalStatus = params.approvalStatus;
  if (params.q?.trim()) {
    const q = params.q.trim();
    const orParts: Prisma.ExpenseWhereInput[] = [
      { description: { contains: q, mode: "insensitive" } },
      { referenceNumber: { contains: q, mode: "insensitive" } },
    ];
    if (/^\d+$/.test(q)) {
      orParts.push({ sequentialNo: parseInt(q, 10) });
    }
    expenseFilter.OR = orParts;
  }
  const fromC = parseDayStart(params.from ?? undefined);
  const toC = parseDayEnd(params.to ?? undefined);
  if (fromC || toC) {
    expenseFilter.createdAt = {};
    if (fromC) expenseFilter.createdAt.gte = fromC;
    if (toC) expenseFilter.createdAt.lte = toC;
  }

  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where: expenseFilter,
      select: {
        id: true,
        sequentialNo: true,
        description: true,
        type: true,
        company: true,
        amount: true,
        approvalStatus: true,
        requiredApprovalSteps: true,
        currentApprovalStep: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.expense.count({ where: expenseFilter }),
  ]);

  const data = expenses.map((e) => ({
    kind: "submission" as const,
    id: e.id,
    submittedAt: e.createdAt.toISOString(),
    submittedBy: e.createdBy,
    expense: {
      id: e.id,
      sequentialNo: e.sequentialNo,
      description: e.description,
      type: e.type,
      company: e.company,
      amount: parseFloat(e.amount.toString()),
      approvalStatus: e.approvalStatus,
      requiredApprovalSteps: e.requiredApprovalSteps,
      currentApprovalStep: e.currentApprovalStep,
    },
  }));

  return {
    mode: "submissions" as const,
    data,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/** Aprobadores que aparecen en la bitácora (ámbito del usuario), para filtros UI. */
export async function listApproverOptionsForBitacora(session: Session) {
  const scope = expenseScopeWhere(session);
  const approvals = await prisma.expenseApproval.findMany({
    where: { expense: { is: scope } },
    select: { approverUserId: true },
    take: 5000,
  });
  const ids = [...new Set(approvals.map((a) => a.approverUserId))];
  if (ids.length === 0) return [];
  return prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}
