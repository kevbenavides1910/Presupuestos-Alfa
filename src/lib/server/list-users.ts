import { Prisma } from "@prisma/client";
import type { CompanyName, PrismaClient, UserRole } from "@prisma/client";
import { COMPANIES } from "@/lib/utils/constants";

const ALLOWED_ROLES: readonly UserRole[] = [
  "ADMIN",
  "SUPERVISOR",
  "COMPRAS",
  "COMMERCIAL",
  "CONSULTA",
];

const COMPANY_SET = new Set<string>(COMPANIES);

/** Base de datos antigua puede tener CONTABILIDAD u otros valores; Prisma falla al leerlos. */
export function normalizeUserRole(raw: string): UserRole {
  if (raw === "CONTABILIDAD") return "COMPRAS";
  if ((ALLOWED_ROLES as readonly string[]).includes(raw)) return raw as UserRole;
  return "CONSULTA";
}

function normalizeCompany(raw: string | null): CompanyName | null {
  if (!raw) return null;
  if (COMPANY_SET.has(raw)) return raw as CompanyName;
  return null;
}

export type ListedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  company: CompanyName | null;
  isActive: boolean;
  createdAt: Date;
};

/**
 * Lista usuarios. Si `findMany` falla (p. ej. enum en PG desincronizado con Prisma),
 * usa SQL leyendo `role`/`company` como texto y normaliza valores legacy.
 */
export async function listUsersForAdmin(prisma: PrismaClient): Promise<ListedUser[]> {
  try {
    return await prisma.user.findMany({
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
