import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import bcrypt from "bcryptjs";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(["ADMIN", "SUPERVISOR", "COMPRAS", "COMMERCIAL", "CONSULTA"]).optional(),
  company: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return notFound();

  try {
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const { password, ...rest } = parsed.data;
    const data: Record<string, unknown> = { ...rest };
    if (password) {
      data.passwordHash = await bcrypt.hash(password, 12);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: data as never,
      select: { id: true, name: true, email: true, role: true, company: true, isActive: true, createdAt: true },
    });

    return ok(updated);
  } catch (e) {
    return serverError("Error al actualizar usuario", e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  const { id } = await params;
  if (id === session.user.id) {
    return badRequest("No podés desactivar tu propio usuario");
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return notFound();

  // Soft-disable instead of hard delete
  await prisma.user.update({
    where: { id },
    data: { isActive: false },
  });

  return ok({ message: "Usuario desactivado" });
}
