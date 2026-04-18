import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, serverError } from "@/lib/api/response";
import type { AssetMovementType, Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") as AssetMovementType | null;
    const typeId = searchParams.get("typeId");
    const assetId = searchParams.get("assetId");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "200", 10), 500);

    const where: Prisma.AssetMovementWhereInput = {};
    if (type) where.type = type;
    if (assetId) where.assetId = assetId;
    if (typeId) where.asset = { typeId };

    const rows = await prisma.assetMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        asset: { include: { type: true } },
        fromPosition: {
          include: {
            location: {
              include: {
                contract: { select: { licitacionNo: true } },
                zone: { select: { id: true, name: true } },
              },
            },
          },
        },
        toPosition: {
          include: {
            location: {
              include: {
                contract: { select: { licitacionNo: true } },
                zone: { select: { id: true, name: true } },
              },
            },
          },
        },
        expense: { select: { id: true, description: true, referenceNumber: true } },
      },
    });
    return ok(rows);
  } catch (e) {
    return serverError("Error al obtener movimientos", e);
  }
}
