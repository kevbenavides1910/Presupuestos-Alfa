import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canModifyContracts } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

const positionSchema = z.object({
  name: z.string().min(2, "Nombre del puesto requerido"),
  description: z.string().optional(),
  shift: z.string().optional(),
  location: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  try {
    const positions = await prisma.position.findMany({
      where: { contractId: id },
      include: {
        expenses: {
          select: { id: true, amount: true, type: true, description: true, periodMonth: true },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { name: "asc" },
    });

    const serialized = positions.map(p => ({
      ...p,
      totalExpenses: p.expenses.reduce((s, e) => s + parseFloat(e.amount.toString()), 0),
      expenses: p.expenses.map(e => ({ ...e, amount: parseFloat(e.amount.toString()) })),
    }));

    return ok(serialized);
  } catch (e) {
    return serverError("Error al obtener puestos", e);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id } = await params;
  try {
    const body = await req.json();
    const parsed = positionSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const position = await prisma.position.create({
      data: { ...parsed.data, contractId: id },
    });

    return created(position);
  } catch (e) {
    return serverError("Error al crear puesto", e);
  }
}
