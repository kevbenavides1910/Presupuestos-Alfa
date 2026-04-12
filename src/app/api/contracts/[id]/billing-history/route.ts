import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canModifyContracts } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { recalculateEquivalence } from "@/lib/business/equivalence";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/, "Formato YYYY-MM requerido"),
  monthlyBilling: z.number().positive("Debe ser mayor a 0"),
  notes: z.string().optional(),
});

function toMonthDate(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  const contract = await prisma.contract.findFirst({ where: { id, deletedAt: null } });
  if (!contract) return notFound();

  const history = await prisma.billingHistory.findMany({
    where: { contractId: id },
    orderBy: { periodMonth: "desc" },
  });

  return ok(history.map((h) => ({
    ...h,
    monthlyBilling: parseFloat(h.monthlyBilling.toString()),
    suppliesBudget: parseFloat(h.monthlyBilling.toString()) * parseFloat(contract.suppliesBudgetPct.toString()),
  })));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id } = await params;
  const contract = await prisma.contract.findFirst({ where: { id, deletedAt: null } });
  if (!contract) return notFound();

  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const { periodMonth, monthlyBilling, notes } = parsed.data;
    const date = toMonthDate(periodMonth);

    const entry = await prisma.billingHistory.upsert({
      where: { contractId_periodMonth: { contractId: id, periodMonth: date } },
      create: { contractId: id, periodMonth: date, monthlyBilling, notes, createdById: session.user.id },
      update: { monthlyBilling, notes, updatedAt: new Date() },
    });

    await recalculateEquivalence();

    return created({
      ...entry,
      monthlyBilling: parseFloat(entry.monthlyBilling.toString()),
      suppliesBudget: parseFloat(entry.monthlyBilling.toString()) * parseFloat(contract.suppliesBudgetPct.toString()),
    });
  } catch (e) {
    return serverError("Error al guardar facturación", e);
  }
}
