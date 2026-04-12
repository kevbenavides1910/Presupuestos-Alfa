import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { z } from "zod";

const createSchema = z.object({
  name:      z.string().min(1, "Nombre requerido").max(100),
  isActive:  z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

// Default origins seeded on first access
const DEFAULT_ORIGINS = [
  { name: "Orden de compra",          sortOrder: 1 },
  { name: "Solicitud de transferencia", sortOrder: 2 },
  { name: "Reclamo",                  sortOrder: 3 },
  { name: "Gasto fijo",               sortOrder: 4 },
];

async function seedDefaultsIfEmpty() {
  const count = await prisma.expenseOrigin.count();
  if (count > 0) return;
  await prisma.expenseOrigin.createMany({
    data: DEFAULT_ORIGINS.map(o => ({ ...o, isActive: true })),
    skipDuplicates: true,
  });
}

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    await seedDefaultsIfEmpty();
    const origins = await prisma.expenseOrigin.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return ok(origins);
  } catch (e) {
    return serverError("Error al obtener orígenes", e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    // Check duplicate name
    const existing = await prisma.expenseOrigin.findUnique({ where: { name: parsed.data.name } });
    if (existing) return badRequest("Ya existe un origen con ese nombre");

    const origin = await prisma.expenseOrigin.create({ data: parsed.data });
    return created(origin);
  } catch (e) {
    return serverError("Error al crear origen", e);
  }
}
