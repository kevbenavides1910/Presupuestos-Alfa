import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

const fieldSchema = z.object({
  key: z.string().min(1).max(60).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Clave inválida"),
  label: z.string().min(1).max(80),
  type: z.enum(["string", "number", "date", "boolean"]).default("string"),
  required: z.boolean().default(false),
});

const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  fields: z.array(fieldSchema).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();
  const { id } = await params;
  try {
    const existing = await prisma.assetType.findUnique({ where: { id } });
    if (!existing) return notFound();
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const row = await prisma.assetType.update({
      where: { id },
      data: parsed.data,
    });
    return ok(row);
  } catch (e) {
    return serverError("Error al actualizar tipo", e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();
  const { id } = await params;
  try {
    const existing = await prisma.assetType.findUnique({
      where: { id },
      include: { _count: { select: { assets: true } } },
    });
    if (!existing) return notFound();
    if (existing._count.assets > 0) {
      return badRequest(`No se puede eliminar: tiene ${existing._count.assets} activo(s) asociados.`);
    }
    await prisma.assetType.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError("Error al eliminar tipo", e);
  }
}
