import { NextRequest } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { canImportDisciplinary } from "@/lib/permissions";
import { ok, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { listZonesWithEmailSentInBatch } from "@/lib/server/disciplinary-bulk-zone-pdf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canImportDisciplinary(session.user.role)) return forbidden();

  try {
    const { id } = await params;
    const zones = await listZonesWithEmailSentInBatch(id);
    return ok({ zones });
  } catch (e) {
    return serverError(e instanceof Error ? e.message : "Error al listar zonas", e);
  }
}
