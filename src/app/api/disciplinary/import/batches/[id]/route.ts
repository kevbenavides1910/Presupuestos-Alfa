import { NextRequest } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { canImportDisciplinary } from "@/lib/permissions";
import { ok, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

/**
 * Elimina un lote de importación y todos los apercibimientos vinculados (y sus omisiones).
 * Libera el checksum para poder volver a subir el mismo archivo.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canImportDisciplinary(session.user.role)) return forbidden();

  try {
    const { id } = await params;
    const batch = await prisma.disciplinaryImportBatch.findUnique({
      where: { id },
      select: { id: true, filename: true, checksum: true },
    });
    if (!batch) return notFound("Lote no encontrado");

    const summary = await prisma.$transaction(async (tx) => {
      const aperc = await tx.disciplinaryApercibimiento.deleteMany({ where: { importBatchId: id } });
      await tx.disciplinaryTreatment.updateMany({
        where: { importBatchId: id },
        data: { importBatchId: null },
      });
      await tx.disciplinaryImportBatch.delete({ where: { id } });
      return { apercibimientosDeleted: aperc.count };
    });

    return ok({
      deleted: true,
      filename: batch.filename,
      checksumReleased: Boolean(batch.checksum),
      ...summary,
    });
  } catch (e) {
    return serverError(e instanceof Error ? e.message : "Error al eliminar el lote", e);
  }
}
