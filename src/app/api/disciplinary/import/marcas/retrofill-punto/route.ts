import { NextRequest } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { canImportDisciplinary } from "@/lib/permissions";
import { unauthorized, forbidden, badRequest, created, serverError } from "@/lib/api/response";
import { retrofillPuntoOmitidoFromMarcasWorkbook } from "@/lib/server/disciplinary-marcas-import";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canImportDisciplinary(session.user.role)) return forbidden();

  try {
    const form = await req.formData();
    const file = form.get("file");
    const batchIdRaw = form.get("batchId");
    const batchId = typeof batchIdRaw === "string" ? batchIdRaw.trim() : "";
    if (!batchId) {
      return badRequest("Indique batchId del lote de marcas a actualizar");
    }
    if (!file || !(file instanceof Blob)) {
      return badRequest("Adjunte el mismo Excel de marcas (.xlsx) en el campo «file»");
    }

    const buffer = await file.arrayBuffer();
    const data = await retrofillPuntoOmitidoFromMarcasWorkbook(buffer, batchId);
    return created(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al retroactualizar puntos";
    if (
      msg.includes("Lote no encontrado") ||
      msg.includes("Solo aplica") ||
      msg.includes("import_marcas")
    ) {
      return badRequest(msg);
    }
    return serverError(msg, e);
  }
}
