import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

const assignSchema = z.object({
  action: z.literal("ASSIGN"),
  toPositionId: z.string().min(1),
  notes: z.string().optional().nullable(),
});

const returnSchema = z.object({
  action: z.literal("RETURN"),
  notes: z.string().optional().nullable(),
});

const issueSchema = z.object({
  action: z.literal("ISSUE"),
  reason: z.enum(["LOST", "DAMAGED", "DISPOSED", "OTHER"]),
  notes: z.string().optional().nullable(),
});

const movementSchema = z.discriminatedUnion("action", [assignSchema, returnSchema, issueSchema]);

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  const { id } = await params;
  try {
    const body = await req.json();
    const parsed = movementSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) return notFound();

    const data = parsed.data;

    if (data.action === "ASSIGN") {
      if (asset.status !== "IN_STOCK") {
        return badRequest("Sólo se pueden asignar activos que estén en stock.");
      }
      const position = await prisma.position.findUnique({ where: { id: data.toPositionId } });
      if (!position) return badRequest("Puesto destino no existe");

      // Si ya hay un activo ASSIGNED del mismo tipo en el puesto destino, se desplaza
      // automáticamente al estado PENDING_RETURN (queda visible en la pantalla
      // "Pendientes de devolución" hasta que físicamente sea devuelto al stock).
      const previousAtPosition = await prisma.asset.findMany({
        where: {
          typeId: asset.typeId,
          currentPositionId: data.toPositionId,
          status: "ASSIGNED",
          NOT: { id },
        },
        select: { id: true },
      });

      const result = await prisma.$transaction(async (tx) => {
        if (previousAtPosition.length > 0) {
          await tx.asset.updateMany({
            where: { id: { in: previousAtPosition.map((p) => p.id) } },
            data: { status: "PENDING_RETURN" },
          });
        }
        const mv = await tx.assetMovement.create({
          data: {
            assetId: id,
            type: "ASSIGN",
            toPositionId: data.toPositionId,
            notes: data.notes?.trim() || null,
            createdById: session.user.id,
          },
        });
        await tx.asset.update({
          where: { id },
          data: { status: "ASSIGNED", currentPositionId: data.toPositionId },
        });
        return { mv, displaced: previousAtPosition.length };
      });
      return created({ id: result.mv.id, displaced: result.displaced });
    }

    if (data.action === "RETURN") {
      const isAssigned = asset.status === "ASSIGNED";
      const isPendingReturn = asset.status === "PENDING_RETURN";
      if ((!isAssigned && !isPendingReturn) || !asset.currentPositionId) {
        return badRequest("El activo no está asignado ni pendiente de devolución.");
      }
      const fromPositionId = asset.currentPositionId;
      const result = await prisma.$transaction(async (tx) => {
        const mv = await tx.assetMovement.create({
          data: {
            assetId: id,
            type: "RETURN",
            fromPositionId,
            notes: data.notes?.trim() || null,
            createdById: session.user.id,
          },
        });
        await tx.asset.update({
          where: { id },
          data: { status: "IN_STOCK", currentPositionId: null },
        });
        return mv;
      });
      return created(result);
    }

    if (data.action === "ISSUE") {
      if (asset.status === "ASSIGNED") {
        return badRequest("Devuelva primero el activo al stock antes de darlo de baja.");
      }
      if (asset.status === "RETIRED") {
        return badRequest("El activo ya está dado de baja.");
      }
      const result = await prisma.$transaction(async (tx) => {
        const mv = await tx.assetMovement.create({
          data: {
            assetId: id,
            type: "ISSUE",
            issueReason: data.reason,
            notes: data.notes?.trim() || null,
            createdById: session.user.id,
          },
        });
        await tx.asset.update({
          where: { id },
          data: { status: "RETIRED" },
        });
        return mv;
      });
      return created(result);
    }

    return badRequest("Acción desconocida");
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return serverError(`Error al registrar movimiento: ${detail}`, e);
  }
}

// GET: list movements for an asset
export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { id } = await params;
  try {
    const movements = await prisma.assetMovement.findMany({
      where: { assetId: id },
      orderBy: { createdAt: "desc" },
      include: {
        fromPosition: { include: { location: { include: { contract: { select: { licitacionNo: true } } } } } },
        toPosition: { include: { location: { include: { contract: { select: { licitacionNo: true } } } } } },
        expense: { select: { id: true, description: true, referenceNumber: true } },
      },
    });
    return ok(movements);
  } catch (e) {
    return serverError("Error al obtener movimientos", e);
  }
}
