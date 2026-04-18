import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  const { id } = await params;
  try {
    const asset = await prisma.asset.findUnique({
      where: { id },
      include: {
        type: true,
        currentPosition: {
          include: {
            location: { include: { contract: { select: { id: true, licitacionNo: true, client: true } } } },
          },
        },
        acquisitionExpense: { select: { id: true, description: true, referenceNumber: true } },
        movements: {
          orderBy: { createdAt: "desc" },
          include: {
            fromPosition: { include: { location: { include: { contract: { select: { licitacionNo: true } } } } } },
            toPosition: { include: { location: { include: { contract: { select: { licitacionNo: true } } } } } },
            expense: { select: { id: true, description: true, referenceNumber: true } },
          },
        },
      },
    });
    if (!asset) return notFound();
    return ok(asset);
  } catch (e) {
    return serverError("Error al obtener activo", e);
  }
}

const patchSchema = z.object({
  code: z.string().min(1).max(120).optional(),
  name: z.string().max(200).nullable().optional(),
  brand: z.string().max(120).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  attributes: z.record(z.unknown()).optional(),
  acquisitionExpenseId: z.string().nullable().optional(),
  acquisitionDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();
  const { id } = await params;
  try {
    const existing = await prisma.asset.findUnique({ where: { id } });
    if (!existing) return notFound();
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    if (parsed.data.code && parsed.data.code !== existing.code) {
      const dup = await prisma.asset.findFirst({
        where: { typeId: existing.typeId, code: parsed.data.code, id: { not: id } },
      });
      if (dup) return badRequest("Ya existe otro activo con ese código para este tipo");
    }

    if (parsed.data.acquisitionExpenseId) {
      const exp = await prisma.expense.findUnique({ where: { id: parsed.data.acquisitionExpenseId } });
      if (!exp) return badRequest("Gasto / OC referenciado no existe");
    }

    const data: Prisma.AssetUpdateInput = {};
    if (parsed.data.code !== undefined) data.code = parsed.data.code.trim();
    if (parsed.data.name !== undefined) data.name = parsed.data.name?.trim() || null;
    if (parsed.data.brand !== undefined) data.brand = parsed.data.brand?.trim() || null;
    if (parsed.data.model !== undefined) data.model = parsed.data.model?.trim() || null;
    if (parsed.data.attributes !== undefined) data.attributes = parsed.data.attributes as Prisma.InputJsonValue;
    if (parsed.data.acquisitionExpenseId !== undefined) {
      data.acquisitionExpense = parsed.data.acquisitionExpenseId
        ? { connect: { id: parsed.data.acquisitionExpenseId } }
        : { disconnect: true };
    }
    if (parsed.data.acquisitionDate !== undefined) {
      data.acquisitionDate = parsed.data.acquisitionDate ? new Date(parsed.data.acquisitionDate) : null;
    }
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes?.trim() || null;

    const updated = await prisma.asset.update({ where: { id }, data });
    return ok(updated);
  } catch (e) {
    return serverError("Error al actualizar activo", e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();
  const { id } = await params;
  try {
    const existing = await prisma.asset.findUnique({
      where: { id },
      include: { _count: { select: { movements: true } } },
    });
    if (!existing) return notFound();
    if (existing.status !== "IN_STOCK") {
      return badRequest("No se puede eliminar: el activo debe estar en stock (no asignado).");
    }
    // Only allow deletion if no movement history beyond the initial INTAKE
    if (existing._count.movements > 1) {
      return badRequest("No se puede eliminar: el activo tiene historial de movimientos. Dele de baja (Salida) en su lugar.");
    }
    await prisma.$transaction([
      prisma.assetMovement.deleteMany({ where: { assetId: id } }),
      prisma.asset.delete({ where: { id } }),
    ]);
    return ok({ deleted: true });
  } catch (e) {
    return serverError("Error al eliminar activo", e);
  }
}
