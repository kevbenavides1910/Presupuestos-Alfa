import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canModifyContracts } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string; locationId: string }> };

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id: contractId, locationId } = await params;
  try {
    const loc = await prisma.contractLocation.findFirst({
      where: { id: locationId, contractId },
    });
    if (!loc) return notFound();

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const data: { name?: string; description?: string | null; sortOrder?: number } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
    if (parsed.data.description !== undefined) data.description = parsed.data.description?.trim() || null;
    if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;

    const updated = await prisma.contractLocation.update({
      where: { id: locationId },
      data,
    });
    return ok(updated);
  } catch (e) {
    return serverError("Error al actualizar ubicación", e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id: contractId, locationId } = await params;
  try {
    const loc = await prisma.contractLocation.findFirst({
      where: { id: locationId, contractId },
      include: {
        positions: {
          include: { expenses: { select: { id: true } } },
        },
      },
    });
    if (!loc) return notFound();

    const expenseCount = loc.positions.reduce((n, p) => n + p.expenses.length, 0);
    if (expenseCount > 0) {
      return badRequest(
        `No se puede eliminar la ubicación: hay ${expenseCount} gasto(s) asignados a puestos dentro de ella.`
      );
    }

    await prisma.contractLocation.delete({ where: { id: locationId } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError("Error al eliminar ubicación", e);
  }
}
