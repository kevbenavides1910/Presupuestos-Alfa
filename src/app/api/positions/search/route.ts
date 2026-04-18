import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, serverError } from "@/lib/api/response";
import type { Prisma } from "@prisma/client";

// GET /api/positions/search?q=101&contractId=...&limit=20
// Busca puestos por número/nombre (también en la ubicación o contrato) y
// devuelve la información completa para autocompletar.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() ?? "";
    const contractId = searchParams.get("contractId");
    const activeOnly = searchParams.get("activeOnly") !== "false";
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 50);

    const where: Prisma.PositionWhereInput = {};

    if (contractId) {
      where.location = { contractId };
    } else if (activeOnly) {
      where.location = { contract: { status: { in: ["ACTIVE", "PROLONGATION"] } } };
    }

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { phoneLine: { contains: q, mode: "insensitive" } },
        { location: { name: { contains: q, mode: "insensitive" } } },
        { location: { contract: { licitacionNo: { contains: q, mode: "insensitive" } } } },
        { location: { contract: { client: { contains: q, mode: "insensitive" } } } },
      ];
    }

    const positions = await prisma.position.findMany({
      where,
      take: limit,
      orderBy: [{ name: "asc" }],
      include: {
        shifts: { orderBy: { sortOrder: "asc" } },
        location: {
          include: {
            contract: { select: { id: true, licitacionNo: true, client: true, status: true } },
          },
        },
      },
    });

    return ok(
      positions.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        phoneLine: p.phoneLine,
        shifts: p.shifts.map((s) => ({
          id: s.id,
          label: s.label,
          hours: parseFloat(String(s.hours)),
        })),
        location: {
          id: p.location.id,
          name: p.location.name,
          contract: p.location.contract,
        },
      })),
    );
  } catch (e) {
    return serverError("Error al buscar puestos", e);
  }
}
