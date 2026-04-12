import { prisma } from "@/lib/prisma";
import { recalculateEquivalence } from "./equivalence";
import { nowServer } from "@/lib/utils/time";

/**
 * Finds all contracts whose endDate has passed and status is still
 * ACTIVE, PROLONGATION or SUSPENDED, and marks them as FINISHED.
 * Uses server-side time (respects TZ env var) so it works correctly
 * whether the app runs locally or on a UTC VPS.
 * Returns the number of contracts updated.
 */
export async function autoExpireContracts(): Promise<number> {
  const now = nowServer();

  const expired = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      status: { in: ["ACTIVE", "PROLONGATION", "SUSPENDED"] },
      endDate: { lt: now },
    },
    select: { id: true },
  });

  if (expired.length === 0) return 0;

  await prisma.contract.updateMany({
    where: { id: { in: expired.map((c) => c.id) } },
    data: { status: "FINISHED" },
  });

  // Recalculate equivalence since active contract pool changed
  await recalculateEquivalence();

  return expired.length;
}
