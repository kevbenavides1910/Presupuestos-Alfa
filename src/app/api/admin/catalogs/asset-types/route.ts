import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { z } from "zod";

const fieldSchema = z.object({
  key: z.string().min(1).max(60).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Clave inválida (solo letras, números y _)"),
  label: z.string().min(1).max(80),
  type: z.enum(["string", "number", "date", "boolean"]).default("string"),
  required: z.boolean().default(false),
});

const createSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/, "Sólo mayúsculas, números y _"),
  name: z.string().min(2).max(100),
  fields: z.array(fieldSchema).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  try {
    const rows = await prisma.assetType.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return ok(rows);
  } catch (e) {
    return serverError("Error al obtener tipos de activos", e);
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

    const existing = await prisma.assetType.findUnique({ where: { code: parsed.data.code } });
    if (existing) return badRequest("Ya existe un tipo con ese código");

    const row = await prisma.assetType.create({
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        fields: parsed.data.fields,
        isActive: parsed.data.isActive,
        sortOrder: parsed.data.sortOrder,
      },
    });
    return created(row);
  } catch (e) {
    return serverError("Error al crear tipo de activo", e);
  }
}
