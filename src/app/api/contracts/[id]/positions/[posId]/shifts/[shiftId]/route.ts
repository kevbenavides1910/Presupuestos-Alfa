import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canModifyContracts } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string; posId: string; shiftId: string }> };

const patchSchema = z.object({
  label: z.string().max(120).nullable().optional(),
  hours: z.coerce.number().positive().max(24).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id: contractId, posId, shiftId } = await params;
  try {
    const shift = await prisma.positionShift.findFirst({
      where: { id: shiftId, positionId: posId, position: { location: { contractId } } },
    });
    if (!shift) return notFound();

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const data: { label?: string | null; hours?: number; sortOrder?: number } = {};
    if (parsed.data.label !== undefined) data.label = parsed.data.label?.trim() || null;
    if (parsed.data.hours !== undefined) data.hours = parsed.data.hours;
    if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;

    const updated = await prisma.positionShift.update({
      where: { id: shiftId },
      data,
    });
    return ok({ ...updated, hours: parseFloat(updated.hours.toString()) });
  } catch (e) {
    return serverError("Error al actualizar turno", e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id: contractId, posId, shiftId } = await params;
  try {
    const shift = await prisma.positionShift.findFirst({
      where: { id: shiftId, positionId: posId, position: { location: { contractId } } },
    });
    if (!shift) return notFound();

    await prisma.positionShift.delete({ where: { id: shiftId } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError("Error al eliminar turno", e);
  }
}
