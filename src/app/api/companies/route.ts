import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, badRequest, serverError } from "@/lib/api/response";

/** Catálogo de empresas (activas e inactivas). Selectores deben filtrar `isActive` en cliente. */
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const rows = await prisma.company.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { code: true, name: true, isActive: true },
    });
    return ok(rows);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
      return badRequest(
        "La tabla de empresas no existe en la base de datos. Revise que el contenedor aplicó las migraciones al iniciar (prisma migrate deploy) o ejecute la migración en el servidor."
      );
    }
    return serverError("Error al listar empresas", e);
  }
}
