import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canModifyContracts } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string; posId: string }> };

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  shift: z.string().optional(),
  location: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id, posId } = await params;
  try {
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const pos = await prisma.position.findUnique({ where: { id: posId } });
    if (!pos || pos.contractId !== id) return notFound("Puesto no encontrado");

    const updated = await prisma.position.update({
      where: { id: posId },
      data: parsed.data,
    });
    return ok(updated);
  } catch (e) {
    return serverError("Error al actualizar puesto", e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id, posId } = await params;
  try {
    const pos = await prisma.position.findUnique({
      where: { id: posId },
      include: { expenses: { select: { id: true } } },
    });
    if (!pos || pos.contractId !== id) return notFound("Puesto no encontrado");
    if (pos.expenses.length > 0) {
      return badRequest(`No se puede eliminar: tiene ${pos.expenses.length} gasto(s) asignado(s). Elimine primero los gastos.`);
    }

    await prisma.position.delete({ where: { id: posId } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError("Error al eliminar puesto", e);
  }
}
