import { NextRequest } from "next/server";
import { Prisma, ExpenseType, type ExpenseApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { listExpensesForSession } from "@/lib/server/expenses-list";
import { ok, created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { expenseCreateSchema } from "@/lib/validations/expense.schema";
import { requireCompanyCode } from "@/lib/server/companies";
import { getApprovalStepCountForType, initialApprovalFields } from "@/lib/server/expense-approval";
import { applyDeferredExpenseDistributions } from "@/lib/server/deferred-expense-distribution";

function prismaErrorHint(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /PLANILLA/i.test(msg) ||
    /not found in enum/i.test(msg) ||
    /Invalid value for argument [`']type[`']/i.test(msg) ||
    /Value.*ExpenseType|ExpenseType.*enum/i.test(msg)
  ) {
    return "El tipo «Planilla» u otro valor de enum no coincide con la base de datos. Ejecute: npm run db:fix-planilla-enum (o npx prisma db push) y reinicie el servidor Next.";
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2003") {
      return "Referencia inválida: verifique contrato, origen o puesto seleccionados.";
    }
  }
  return null;
}

/** Reparte total en N partes; suma exacta en colones (centavos) */
function splitAmountAcrossMonths(total: number, months: number): number[] {
  if (months <= 1) return [total];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / months);
  const remainder = cents - base * months;
  const out: number[] = [];
  for (let i = 0; i < months; i++) {
    out.push((base + (i < remainder ? 1 : 0)) / 100);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { searchParams } = new URL(req.url);
    const contractId     = searchParams.get("contractId");
    const distributedTo  = searchParams.get("distributedTo"); // deferred expenses distributed to a contract
    const isDeferredParam = searchParams.get("isDeferred");
    const company = searchParams.get("company");
    const type = searchParams.get("type") as ExpenseType | null;
    const approvalStatusParam = searchParams.get("approvalStatus");
    const approvalStatus =
      approvalStatusParam && approvalStatusParam !== "all"
        ? (approvalStatusParam as ExpenseApprovalStatus | "PENDING")
        : null;
    const q = searchParams.get("q")?.trim();
    const page = parseInt(searchParams.get("page") ?? "1");
    const pageSize = parseInt(searchParams.get("pageSize") ?? "50");
    const limitParam = searchParams.get("limit");

    // Lightweight search endpoint used by pickers (e.g. inventory intake)
    if (q) {
      const where: Prisma.ExpenseWhereInput = {
        OR: [
          { description: { contains: q, mode: "insensitive" } },
          { referenceNumber: { contains: q, mode: "insensitive" } },
          { registroCxp: { contains: q, mode: "insensitive" } },
        ],
      };
      if (company) where.company = company;
      if (contractId) where.contractId = contractId;
      const take = Math.min(parseInt(limitParam ?? "15", 10), 50);
      const rows = await prisma.expense.findMany({
        where,
        select: {
          id: true,
          sequentialNo: true,
          description: true,
          referenceNumber: true,
          registroCxp: true,
          amount: true,
          periodMonth: true,
          type: true,
        },
        orderBy: { createdAt: "desc" },
        take,
      });
      return ok(
        rows.map((r) => ({ ...r, amount: parseFloat(r.amount.toString()) })),
      );
    }

    // Special case: fetch deferred expenses that have been distributed to a specific contract
    if (distributedTo && isDeferredParam === "true") {
      const dists = await prisma.expenseDistribution.findMany({
        where: {
          contractId: distributedTo,
          expense: { approvalStatus: { not: "REJECTED" } },
        },
        include: {
          expense: {
            include: {
              origin: { select: { id: true, name: true } },
              createdBy: { select: { name: true } },
            },
          },
        },
        orderBy: { expense: { periodMonth: "desc" } },
      });

      const serialized = dists.map(d => ({
        ...d.expense,
        amount: parseFloat(d.allocatedAmount.toString()), // show the allocated share
        fullAmount: parseFloat(d.expense.amount.toString()),
        equivalencePct: parseFloat(d.equivalencePct.toString()),
        allocatedAmount: parseFloat(d.allocatedAmount.toString()),
      }));

      return ok(serialized, { page: 1, pageSize: serialized.length, total: serialized.length, totalPages: 1 });
    }

    const result = await listExpensesForSession(session, {
      page,
      pageSize,
      contractId,
      company,
      type,
      approvalStatus,
    });

    return ok(result.data, result.meta);
  } catch (e) {
    return serverError("Error al obtener gastos", e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  try {
    const body = await req.json();
    const parsed = expenseCreateSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const {
      periodMonth,
      amount,
      spreadMonths: rawSpread,
      description,
      type,
      budgetLine,
      contractId,
      positionId,
      originId,
      referenceNumber,
      company,
      isDeferred,
      notes,
      registroCxp,
      registroTr,
      deferredIncludeContractIds: rawDeferredContractIds,
    } = parsed.data;

    const deferredIncludeContractIds =
      isDeferred && rawDeferredContractIds && rawDeferredContractIds.length > 0
        ? rawDeferredContractIds
        : [];

    const companyOk = await requireCompanyCode(prisma, company, { mustBeActive: true });
    if (!companyOk.ok) return badRequest(companyOk.message);

    if (isDeferred && deferredIncludeContractIds.length > 0) {
      const okIds = await prisma.contract.findMany({
        where: {
          id: { in: deferredIncludeContractIds },
          status: { in: ["ACTIVE", "PROLONGATION"] },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (okIds.length !== deferredIncludeContractIds.length) {
        return badRequest("Algunos contratos no son válidos o no están activos para reparto");
      }
    }

    const spreadMonths = isDeferred ? 1 : rawSpread;
    const [year, month] = periodMonth.split("-").map(Number);
    const start = new Date(year, month - 1, 1);

    const stepCount = await getApprovalStepCountForType(type);
    const approval = initialApprovalFields(stepCount);

    const common = {
      type,
      budgetLine,
      contractId,
      positionId: positionId || null,
      originId: originId || null,
      referenceNumber: referenceNumber || null,
      company,
      isDeferred,
      notes: notes || null,
      registroCxp: registroCxp?.trim() || null,
      registroTr: registroTr?.trim() || null,
      createdById: session.user.id,
      approvalStatus: approval.approvalStatus,
      currentApprovalStep: approval.currentApprovalStep,
      requiredApprovalSteps: approval.requiredApprovalSteps,
      deferredIncludeContractIds: isDeferred ? deferredIncludeContractIds : [],
    };

    const include = {
      contract: { select: { id: true, licitacionNo: true, client: true, company: true } },
      origin: { select: { id: true, name: true } },
    } as const;

    if (spreadMonths <= 1) {
      const expense = await prisma.expense.create({
        data: {
          ...common,
          description: description.trim(),
          amount,
          periodMonth: start,
        },
        include,
      });
      if (isDeferred) {
        await applyDeferredExpenseDistributions(prisma, expense.id);
      }
      const fresh = await prisma.expense.findUnique({
        where: { id: expense.id },
        include,
      });
      const row = fresh ?? expense;
      return created({
        expenses: [{ ...row, amount: parseFloat(row.amount.toString()) }],
        count: 1,
      });
    }

    const amounts = splitAmountAcrossMonths(amount, spreadMonths);
    const desc = description.trim();
    const createdRows = await prisma.$transaction(
      amounts.map((amt, i) =>
        prisma.expense.create({
          data: {
            ...common,
            description: `${desc} (mes ${i + 1}/${spreadMonths})`,
            amount: amt,
            periodMonth: new Date(year, month - 1 + i, 1),
          },
          include,
        })
      )
    );

    for (const row of createdRows) {
      if (isDeferred) {
        await applyDeferredExpenseDistributions(prisma, row.id);
      }
    }
    const ids = createdRows.map((r) => r.id);
    const refreshed = await prisma.expense.findMany({ where: { id: { in: ids } }, include });
    const byId = new Map(refreshed.map((e) => [e.id, e]));

    return created({
      expenses: createdRows.map((e) => {
        const r = byId.get(e.id) ?? e;
        return { ...r, amount: parseFloat(r.amount.toString()) };
      }),
      count: createdRows.length,
    });
  } catch (e) {
    const hint = prismaErrorHint(e);
    if (hint) return badRequest(hint);
    return serverError("Error al crear gasto", e);
  }
}
