import type { Session } from "next-auth";
import type { ContractStatus, UserRole } from "@prisma/client";
import { isAdmin } from "@/lib/permissions";
import { assignableContractStatusWhereInput } from "@/lib/server/assignable-contract-where";

/** Misma lógica de filtro que GET /api/contracts (búsqueda, empresa, estado, assignable, etc.). */
export function buildContractListWhere(
  session: Session,
  searchParams: URLSearchParams
): Record<string, unknown> {
  const companyValues = searchParams.getAll("company");
  const status = searchParams.get("status") as ContractStatus | null;
  const clientType = searchParams.get("clientType");
  const assignable = searchParams.get("assignable") === "true";
  const searchRaw = searchParams.get("search")?.trim();
  const search = searchRaw && searchRaw.length > 0 ? searchRaw : null;

  const where: Record<string, unknown> = { deletedAt: null };

  const role = session.user?.role as UserRole | undefined;
  const restrictToUserCompany = Boolean(session.user?.company && role && !isAdmin(role));

  if (restrictToUserCompany) {
    where.company = session.user!.company;
  } else if (companyValues.length === 1) {
    where.company = companyValues[0];
  } else if (companyValues.length > 1) {
    where.company = { in: companyValues };
  }

  const assignableClause = assignable ? assignableContractStatusWhereInput() : null;

  /** Coincide con listado y selector de gastos (incl. código de empresa). */
  const searchClause = search
    ? {
        OR: [
          { licitacionNo: { contains: search, mode: "insensitive" } },
          { client: { contains: search, mode: "insensitive" } },
          { company: { contains: search, mode: "insensitive" } },
        ],
      }
    : null;

  if (assignableClause && searchClause) {
    where.AND = [assignableClause, searchClause];
  } else if (assignableClause) {
    Object.assign(where, assignableClause);
  } else if (searchClause) {
    Object.assign(where, searchClause);
  }

  if (status) where.status = status;
  if (clientType) where.clientType = clientType;

  return where;
}
