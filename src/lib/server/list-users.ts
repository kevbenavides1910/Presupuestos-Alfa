import { Prisma } from "@prisma/client";
import type { PrismaClient, UserRole } from "@prisma/client";

const ALLOWED_ROLES: readonly UserRole[] = [
  "ADMIN",
  "SUPERVISOR",
  "COMPRAS",
  "COMMERCIAL",
  "CONSULTA",
];

/** Base de datos antigua puede tener CONTABILIDAD u otros valores; Prisma falla al leerlos. */
export function normalizeUserRole(raw: string): UserRole {
  if (raw === "CONTABILIDAD") return "COMPRAS";
  if ((ALLOWED_ROLES as readonly string[]).includes(raw)) return raw as UserRole;
  return "CONSULTA";
}

export type ListedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  company: string | null;
  isActive: boolean;
  createdAt: Date;
};

/**
 * Lista usuarios. Si `findMany` falla (p. ej. datos legacy), usa SQL leyendo `role`/`company` como texto.
 */
export async function listUsersForAdmin(prisma: PrismaClient): Promise<ListedUser[]> {
  let validCodes = new Set<string>();
  try {
    const companies = await prisma.company.findMany({ select: { code: true } });
    validCodes = new Set(companies.map((c) => c.code));
  } catch (e) {
    console.warn(
      "[listUsersForAdmin] Catálogo companies no disponible (¿falta migrar la base?). Se omitirá validación de empresa.",
      e
    );
  }
  function normalizeCompany(raw: string | null): string | null {
    if (!raw) return null;
    return validCodes.has(raw) ? raw : null;
  }

  try {
    const rows = await prisma.user.findMany({
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        company: true,
        isActive: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      role: row.role as UserRole,
      company: normalizeCompany(row.company),
    }));
  } catch (e) {
    console.warn("[listUsersForAdmin] findMany falló; usando respaldo SQL:", e);
    const rows = await prisma.$queryRaw<
      {
        id: string;
        name: string;
        email: string;
        role: string;
        company: string | null;
        isActive: boolean;
        createdAt: Date;
      }[]
    >(Prisma.sql`
      SELECT
        id,
        name,
        email,
        role::text AS role,
        company::text AS company,
        "isActive",
        "createdAt"
      FROM users
      ORDER BY role::text ASC, name ASC
    `);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: normalizeUserRole(row.role),
      company: normalizeCompany(row.company),
      isActive: row.isActive,
      createdAt: row.createdAt,
    }));
  }
}
