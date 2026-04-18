import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(255).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const { id } = await params;
    const existing = await prisma.zone.findUnique({ where: { id } });
    if (!existing) return notFound("Zona no encontrada");

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const data: { name?: string; description?: string | null; isActive?: boolean; sortOrder?: number } = {};
    if (parsed.data.name !== undefined) {
      const name = parsed.data.name.trim();
      if (name !== existing.name) {
        const dup = await prisma.zone.findUnique({ where: { name } });
        if (dup) return badRequest("Ya existe una zona con ese nombre");
      }
      data.name = name;
    }
    if (parsed.data.description !== undefined) {
      data.description = parsed.data.description?.trim() || null;
    }
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
    if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;

    const updated = await prisma.zone.update({ where: { id }, data });
    return ok(updated);
  } catch (e) {
    return serverError("Error al actualizar zona", e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const { id } = await params;
    const existing = await prisma.zone.findUnique({
      where: { id },
      include: { _count: { select: { locations: true } } },
    });
    if (!existing) return notFound("Zona no encontrada");

    if (existing._count.locations > 0) {
      const deactivated = await prisma.zone.update({
        where: { id },
        data: { isActive: false },
      });
      return ok({
        ...deactivated,
        warning: `La zona tenía ${existing._count.locations} ubicación(es) asociadas y fue desactivada en lugar de eliminada. Reasigne las ubicaciones para poder eliminarla.`,
      });
    }

    await prisma.zone.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError("Error al eliminar zona", e);
  }
}
