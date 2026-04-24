import type { Prisma } from "@prisma/client";
import { monthsAgoServer } from "@/lib/utils/time";

/**
 * Misma regla que `assignable=true` en GET /api/contratos (listado y buscador de gastos):
 * activos, prórroga, suspendidos, o finalizados con cierre en los últimos 6 meses.
 * Debe alinearse con `buildContractListWhere` cuando `assignable` es true.
 */
export function assignableContractStatusWhereInput(): Prisma.ContractWhereInput {
  const cutoff = monthsAgoServer(6);
  return {
    OR: [
      { status: { in: ["ACTIVE", "PROLONGATION", "SUSPENDED"] } },
      { status: "FINISHED", endDate: { gte: cutoff } },
    ],
  };
}
