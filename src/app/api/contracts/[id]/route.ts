import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canModifyContracts, isAdmin } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { contractUpdateSchema } from "@/lib/validations/contract.schema";
import { recalculateEquivalence, getTotalSuppliesBudget } from "@/lib/business/equivalence";
import { calcSuppliesBudget } from "@/lib/business/profitability";
import { getEffectiveMonthlyBilling } from "@/lib/business/effectiveBilling";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  const contract = await prisma.contract.findFirst({
    where: { id, deletedAt: null },
    include: {
      periods: { orderBy: { periodNumber: "asc" } },
    },
  });

  if (!contract) return notFound("Contrato no encontrado");

  const billingHistory = await prisma.billingHistory.findMany({
    where: { contractId: id },
    select: { periodMonth: true, monthlyBilling: true },
  });

  const baseBilling = parseFloat(contract.monthlyBilling.toString());
  const suppliesPctVal = parseFloat(contract.suppliesPct.toString());
  const suppliesBudgetPctVal = parseFloat(contract.suppliesBudgetPct.toString());
  // Un solo criterio: % insumos = tarjeta Insumos; si aún no sincronizado, usar columna legacy
  const pct = suppliesPctVal > 0 ? suppliesPctVal : suppliesBudgetPctVal;
  const billing = getEffectiveMonthlyBilling(baseBilling, billingHistory, new Date());
  const suppliesBudget = calcSuppliesBudget(billing, pct);

  // Supplies share across all active contracts
  const totalSuppliesBudget = await getTotalSuppliesBudget(new Date());
  const suppliesSharePct = totalSuppliesBudget > 0 ? suppliesBudget / totalSuppliesBudget : 0;

  return ok({
    ...contract,
    baseMonthlyBilling: baseBilling,
    monthlyBilling: billing,
    suppliesBudgetPct: pct,
    equivalencePct: parseFloat(contract.equivalencePct.toString()),
    suppliesBudget,
    totalSuppliesBudget,
    suppliesSharePct,
    laborPct: parseFloat(contract.laborPct.toString()),
    suppliesPct: parseFloat(contract.suppliesPct.toString()),
    adminPct: parseFloat(contract.adminPct.toString()),
    profitPct: parseFloat(contract.profitPct.toString()),
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id } = await params;
  const contract = await prisma.contract.findFirst({
    where: { id, deletedAt: null },
  });
  if (!contract) return notFound();

  try {
    const body = await req.json();
    const parsed = contractUpdateSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const { suppliesPct: sp, ...restPatch } = parsed.data;
    const data = {
      ...restPatch,
      ...(sp !== undefined ? { suppliesPct: sp, suppliesBudgetPct: sp } : {}),
    };
    const previousData = { ...contract };

    const updated = await prisma.contract.update({
      where: { id },
      data: {
        ...data,
        ...(data.startDate ? { startDate: new Date(data.startDate) } : {}),
        ...(data.endDate ? { endDate: new Date(data.endDate) } : {}),
        updatedById: session.user.id,
      },
    });

    // Historial de facturación: cada cambio en monthlyBilling queda vigente desde el 1º del mes en curso
    // hasta un cambio posterior (misma regla que getEffectiveMonthlyBilling / reporte anual).
    if (data.monthlyBilling !== undefined) {
      const prev = parseFloat(contract.monthlyBilling.toString());
      const next = data.monthlyBilling;
      if (Math.abs(prev - next) > 0.0001) {
        const now = new Date();
        const periodMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        await prisma.billingHistory.upsert({
          where: { contractId_periodMonth: { contractId: id, periodMonth } },
          create: {
            contractId: id,
            periodMonth,
            monthlyBilling: next,
            notes: "Actualización desde edición del contrato",
            createdById: session.user.id,
          },
          update: {
            monthlyBilling: next,
            notes: "Actualización desde edición del contrato",
            updatedAt: new Date(),
          },
        });
      }
    }

    // Recalculate global equivalence whenever anything that affects supplies budget changes
    if (
      data.positionsCount !== undefined ||
      data.monthlyBilling !== undefined ||
      sp !== undefined ||
      data.status !== undefined
    ) {
      await recalculateEquivalence();
    }

    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        contractId: contract.id,
        entityType: "Contract",
        entityId: contract.id,
        action: "UPDATE",
        previousData: JSON.stringify(previousData),
        newData: JSON.stringify(updated),
      },
    });

    return ok(updated);
  } catch (e) {
    return serverError("Error al actualizar contrato", e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden("Solo administradores pueden eliminar contratos");

  const { id } = await params;
  const contract = await prisma.contract.findFirst({
    where: { id, deletedAt: null },
  });
  if (!contract) return notFound();

  // Soft delete
  await prisma.contract.update({
    where: { id },
    data: { deletedAt: new Date(), status: "CANCELLED" },
  });

  // Recalculate global equivalence after removal
  await recalculateEquivalence();

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      contractId: contract.id,
      entityType: "Contract",
      entityId: contract.id,
      action: "DELETE",
      previousData: JSON.stringify(contract),
    },
  });

  return ok({ message: "Contrato eliminado" });
}
