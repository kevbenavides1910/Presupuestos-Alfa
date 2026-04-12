import type { Session } from "next-auth";
import type { CompanyName, ContractStatus } from "@prisma/client";
import { monthsAgoServer } from "@/lib/utils/time";

/** Misma lógica de filtro que GET /api/contracts (búsqueda, empresa, estado, assignable, etc.). */
export function buildContractListWhere(
  session: Session,
  searchParams: URLSearchParams
): Record<string, unknown> {
  const companyValues = searchParams.getAll("company") as CompanyName[];
  const status = searchParams.get("status") as ContractStatus | null;
  const clientType = searchParams.get("clientType");
  const search = searchParams.get("search");
  const assignable = searchParams.get("assignable") === "true";

  const where: Record<string, unknown> = { deletedAt: null };

  if (session.user?.company) {
    where.company = session.user.company;
  } else if (companyValues.length === 1) {
    where.company = companyValues[0];
  } else if (companyValues.length > 1) {
    where.company = { in: companyValues };
  }

  if (assignable) {
    const cutoff = monthsAgoServer(6);
    where.OR = [
      { status: { in: ["ACTIVE", "PROLONGATION", "SUSPENDED"] } },
      { status: "FINISHED", endDate: { gte: cutoff } },
    ];
  }

  if (status) where.status = status;
  if (clientType) where.clientType = clientType;
  if (search) {
    where.OR = [
      { licitacionNo: { contains: search, mode: "insensitive" } },
      { client: { contains: search, mode: "insensitive" } },
    ];
  }

  return where;
}
