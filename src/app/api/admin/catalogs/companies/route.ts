import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, conflict, serverError } from "@/lib/api/response";
import { z } from "zod";
import { companyCodeCreateSchema } from "@/lib/validations/company-code";

const createSchema = z.object({
  code: companyCodeCreateSchema,
  name: z.string().min(1, "Nombre requerido").max(120),
  isActive: z.coerce.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const rows = await prisma.company.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return ok(rows);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
      return badRequest(
        "La tabla de empresas no existe. Aplique migraciones en el servidor (al iniciar el contenedor Docker se ejecuta prisma migrate deploy; revise logs si falla)."
      );
    }
    return serverError("Error al listar empresas", e);
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

    const code = parsed.data.code.toUpperCase();
    const existing = await prisma.company.findUnique({ where: { code } });
    if (existing) return badRequest("Ya existe una empresa con ese código");

    const row = await prisma.company.create({
      data: {
        code,
        name: parsed.data.name.trim(),
        isActive: parsed.data.isActive,
        sortOrder: parsed.data.sortOrder,
      },
    });
    return created(row);
  } catch (e) {
    console.error("[POST /api/admin/catalogs/companies]", e);

    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        return conflict("Ya existe una empresa con ese código");
      }
      if (e.code === "P2021") {
        return badRequest(
          "La tabla de empresas no existe en la base de datos. Ejecute: npx prisma migrate deploy (o npx prisma db push) y reinicie el servidor."
        );
      }
      return badRequest(`Base de datos (${e.code}): ${e.message}`);
    }

    if (e instanceof Prisma.PrismaClientInitializationError) {
      return badRequest(
        "No se pudo conectar a PostgreSQL. Revise DATABASE_URL en .env y que el contenedor Docker de la base esté en marcha (docker compose up -d postgres)."
      );
    }

    const errMsg = e instanceof Error ? e.message : String(e);
    if (/findUnique|findMany|create/i.test(errMsg) && /undefined|not a function/i.test(errMsg)) {
      return badRequest(
        "El cliente Prisma está desactualizado o bloqueado (común en Windows). Detenga Next.js (Ctrl+C), ejecute: npx prisma generate, y reinicie npm run dev. Si generate falla con EPERM, cierre Cursor/terminales que usen el proyecto y vuelva a intentar."
      );
    }

    return serverError(`Error al crear empresa: ${errMsg}`, e);
  }
}
