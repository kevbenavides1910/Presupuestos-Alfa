import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, serverError } from "@/lib/api/response";

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
    return serverError("Error al listar empresas", e);
  }
}
