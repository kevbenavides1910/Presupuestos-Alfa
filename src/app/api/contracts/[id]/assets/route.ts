import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, notFound, serverError } from "@/lib/api/response";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { id: contractId } = await params;

  try {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, licitacionNo: true, client: true },
    });
    if (!contract) return notFound();

    const locations = await prisma.contractLocation.findMany({
      where: { contractId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        positions: {
          orderBy: [{ createdAt: "asc" }],
          include: {
            shifts: { orderBy: { sortOrder: "asc" } },
            assets: {
              where: { status: "ASSIGNED" },
              include: {
                type: true,
              },
              orderBy: [{ updatedAt: "desc" }],
            },
          },
        },
      },
    });

    return ok({ contract, locations });
  } catch (e) {
    return serverError("Error al obtener activos del contrato", e);
  }
}
