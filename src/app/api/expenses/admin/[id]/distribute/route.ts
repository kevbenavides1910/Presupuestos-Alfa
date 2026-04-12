import { NextRequest } from "next/server";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { ok, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { distributeAdminExpense } from "@/lib/business/distribution";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  const { id } = await params;
  const expense = await prisma.adminExpense.findUnique({ where: { id } });
  if (!expense) return notFound();

  try {
    const result = await distributeAdminExpense(id);
    return ok({ message: "Distribución completada", distributions: result });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("ya fue distribuido")) {
      return forbidden(e.message);
    }
    return serverError("Error al distribuir gastos administrativos", e);
  }
}
