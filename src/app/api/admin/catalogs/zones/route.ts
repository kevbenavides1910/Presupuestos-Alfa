import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1, "Nombre requerido").max(100),
  description: z.string().max(255).nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  disciplinaryAdministrator: z.string().max(200).nullable().optional(),
  disciplinaryAdministratorEmail: z.string().max(255).nullable().optional(),
});

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const zones = await prisma.zone.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { locations: true } } },
    });
    const data = zones.map((z) => ({
      id: z.id,
      name: z.name,
      description: z.description,
      isActive: z.isActive,
      sortOrder: z.sortOrder,
      disciplinaryAdministrator: z.disciplinaryAdministrator,
      disciplinaryAdministratorEmail: z.disciplinaryAdministratorEmail,
      locationsCount: z._count.locations,
    }));
    return ok(data);
  } catch (e) {
    return serverError("Error al obtener zonas", e);
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

    const name = parsed.data.name.trim();
    const existing = await prisma.zone.findUnique({ where: { name } });
    if (existing) return badRequest("Ya existe una zona con ese nombre");

    const adm = parsed.data.disciplinaryAdministrator?.trim() || null;
    const admEmail = parsed.data.disciplinaryAdministratorEmail?.trim() || null;
    if (admEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admEmail)) {
      return badRequest("Correo del administrador disciplinario no válido");
    }

    const zone = await prisma.zone.create({
      data: {
        name,
        description: parsed.data.description?.trim() || null,
        isActive: parsed.data.isActive,
        sortOrder: parsed.data.sortOrder,
        disciplinaryAdministrator: adm,
        disciplinaryAdministratorEmail: admEmail,
      },
    });
    return created(zone);
  } catch (e) {
    return serverError("Error al crear zona", e);
  }
}
