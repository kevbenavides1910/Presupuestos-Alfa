import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, serverError } from "@/lib/api/response";

/**
 * Listado global de ubicaciones (todos los contratos) con su zona asignada.
 * Usado por la pantalla de mantenimientos para asignar/cambiar zonas masivamente.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const url = req.nextUrl;
    const zoneId = url.searchParams.get("zoneId");
    const unassigned = url.searchParams.get("unassigned") === "1";
    const q = url.searchParams.get("q")?.trim().toLowerCase();

    const where: {
      zoneId?: string | null;
      contract?: { deletedAt: null };
    } = {
      contract: { deletedAt: null },
    };
    if (unassigned) {
      where.zoneId = null;
    } else if (zoneId) {
      where.zoneId = zoneId;
    }

    const locations = await prisma.contractLocation.findMany({
      where,
      include: {
        contract: { select: { id: true, licitacionNo: true, client: true, company: true } },
        zone: { select: { id: true, name: true } },
        _count: { select: { positions: true } },
      },
      orderBy: [{ contract: { client: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
      take: 1000,
    });

    let data = locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      description: loc.description,
      sortOrder: loc.sortOrder,
      contract: loc.contract,
      zone: loc.zone,
      zoneId: loc.zoneId,
      positionsCount: loc._count.positions,
    }));

    if (q) {
      data = data.filter((d) => {
        return (
          d.name.toLowerCase().includes(q) ||
          d.contract.client.toLowerCase().includes(q) ||
          d.contract.licitacionNo.toLowerCase().includes(q) ||
          (d.zone?.name?.toLowerCase().includes(q) ?? false)
        );
      });
    }

    return ok(data);
  } catch (e) {
    return serverError("Error al obtener ubicaciones", e);
  }
}
