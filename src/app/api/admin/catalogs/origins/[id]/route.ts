import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";

const updateSchema = z.object({
  name:      z.string().min(1).max(100).optional(),
  isActive:  z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const { id } = await params;
    const existing = await prisma.expenseOrigin.findUnique({ where: { id } });
    if (!existing) return notFound("Origen no encontrado");

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    // Check duplicate name if renaming
    if (parsed.data.name && parsed.data.name !== existing.name) {
      const dup = await prisma.expenseOrigin.findUnique({ where: { name: parsed.data.name } });
      if (dup) return badRequest("Ya existe un origen con ese nombre");
    }

    const updated = await prisma.expenseOrigin.update({
      where: { id },
      data: parsed.data,
    });
    return ok(updated);
  } catch (e) {
    return serverError("Error al actualizar origen", e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const { id } = await params;
    const existing = await prisma.expenseOrigin.findUnique({
      where: { id },
      include: { _count: { select: { expenses: true } } },
    });
    if (!existing) return notFound("Origen no encontrado");

    // If it has associated expenses, deactivate instead of delete
    if (existing._count.expenses > 0) {
      const deactivated = await prisma.expenseOrigin.update({
        where: { id },
        data: { isActive: false },
      });
      return ok({ ...deactivated, warning: "El origen tenía gastos asociados y fue desactivado en lugar de eliminado." });
    }

    await prisma.expenseOrigin.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError("Error al eliminar origen", e);
  }
}
