import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canModifyContracts } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string; posId: string }> };

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  phoneLine: z.string().max(60).nullable().optional(),
});

async function positionInContract(contractId: string, posId: string) {
  return prisma.position.findFirst({
    where: { id: posId, location: { contractId } },
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id: contractId, posId } = await params;
  try {
    const pos = await positionInContract(contractId, posId);
    if (!pos) return notFound("Puesto no encontrado");

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const data: { name?: string; description?: string | null; phoneLine?: string | null } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
    if (parsed.data.description !== undefined) data.description = parsed.data.description?.trim() || null;
    if (parsed.data.phoneLine !== undefined) data.phoneLine = parsed.data.phoneLine?.trim() || null;

    const updated = await prisma.position.update({
      where: { id: posId },
      data,
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

  const { id: contractId, posId } = await params;
  try {
    const pos = await prisma.position.findFirst({
      where: { id: posId, location: { contractId } },
      include: { expenses: { select: { id: true } } },
    });
    if (!pos) return notFound("Puesto no encontrado");
    if (pos.expenses.length > 0) {
      return badRequest(`No se puede eliminar: tiene ${pos.expenses.length} gasto(s) asignado(s).`);
    }

    await prisma.position.delete({ where: { id: posId } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError("Error al eliminar puesto", e);
  }
}
