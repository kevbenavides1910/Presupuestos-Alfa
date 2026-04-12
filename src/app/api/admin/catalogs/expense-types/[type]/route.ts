import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { ExpenseType } from "@prisma/client";

const VALID_TYPES = new Set<string>(Object.values(ExpenseType));

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ type: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  const { type: typeParam } = await ctx.params;
  const raw = decodeURIComponent(typeParam).toUpperCase();
  if (!VALID_TYPES.has(raw)) {
    return badRequest("Tipo de gasto no válido");
  }

  try {
    await prisma.expenseTypeConfig.deleteMany({
      where: { type: raw as ExpenseType },
    });
    return ok({ message: "Restablecido a valores por defecto" });
  } catch (e) {
    return serverError("Error al restablecer tipo", e);
  }
}
