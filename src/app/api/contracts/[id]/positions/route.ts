import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, notFound, serverError } from "@/lib/api/response";

type Ctx = { params: Promise<{ id: string }> };

/** Listado plano de puestos del contrato (p. ej. selector en gastos): «Ubicación › Puesto». */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id: contractId } = await params;
  try {
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true },
    });
    if (!contract) return notFound();

    const positions = await prisma.position.findMany({
      where: { location: { contractId } },
      include: {
        location: { select: { id: true, name: true } },
        shifts: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: [{ location: { name: "asc" } }, { name: "asc" }],
    });

    const data = positions.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      locationId: p.locationId,
      locationName: p.location.name,
      shifts: p.shifts.map((s) => ({
        id: s.id,
        label: s.label,
        hours: parseFloat(s.hours.toString()),
        sortOrder: s.sortOrder,
      })),
      label: `${p.location.name} › ${p.name}`,
    }));

    return ok(data);
  } catch (e) {
    return serverError("Error al obtener puestos", e);
  }
}
