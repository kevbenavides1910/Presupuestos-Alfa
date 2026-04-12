import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache"; // 👈 IMPORTACIÓN NUEVA
import { prisma } from "@/lib/prisma";
import { getSession, canModifyContracts } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { recalculateEquivalence } from "@/lib/business/equivalence";
import { periodSchema } from "@/lib/validations/contract.schema";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  const periods = await prisma.contractPeriod.findMany({
    where: { contractId: id },
    orderBy: { periodNumber: "asc" },
  });

  return ok(periods);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id } = await params;
  try {
    const body = await req.json();
    const parsed = periodSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    // Get next period number
    const lastPeriod = await prisma.contractPeriod.findFirst({
      where: { contractId: id },
      orderBy: { periodNumber: "desc" },
    });
    const periodNumber = (lastPeriod?.periodNumber ?? 0) + 1;

    const period = await prisma.contractPeriod.create({
      data: {
        contractId: id,
        periodNumber,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
        monthlyBilling: parsed.data.monthlyBilling,
        notes: parsed.data.notes,
      },
    });

    // Update contract status, endDate, AND monthlyBilling! 👈
    const newBilling = parsed.data.monthlyBilling;
    await prisma.contract.update({
      where: { id },
      data: { 
        status: "PROLONGATION", 
        endDate: new Date(parsed.data.endDate),
        monthlyBilling: newBilling,
      },
    });

    // Historial: vigencia desde el mes de inicio del período (misma lógica que facturación efectiva)
    const sd = new Date(parsed.data.startDate);
    const periodMonth = new Date(sd.getFullYear(), sd.getMonth(), 1);
    await prisma.billingHistory.upsert({
      where: { contractId_periodMonth: { contractId: id, periodMonth } },
      create: {
        contractId: id,
        periodMonth,
        monthlyBilling: newBilling,
        notes: "Actualización por prórroga / nuevo período",
        createdById: session.user.id,
      },
      update: {
        monthlyBilling: newBilling,
        notes: "Actualización por prórroga / nuevo período",
        updatedAt: new Date(),
      },
    });

    await recalculateEquivalence();

    // Limpiar el caché de Next.js para que la interfaz se actualice de inmediato 👈
    revalidatePath(`/contracts/${id}`);
    revalidatePath(`/contracts`);

    return created(period);
  } catch (e) {
    return serverError("Error al crear prórroga", e);
  }
}