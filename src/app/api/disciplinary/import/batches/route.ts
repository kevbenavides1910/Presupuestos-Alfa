import { getSession } from "@/lib/api/middleware";
import { canImportDisciplinary } from "@/lib/permissions";
import { ok, unauthorized, forbidden } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canImportDisciplinary(session.user.role)) return forbidden();

  const batches = await prisma.disciplinaryImportBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      uploadedBy: { select: { name: true, email: true } },
      _count: { select: { apercibimientos: true } },
    },
  });
  return ok(batches);
}
