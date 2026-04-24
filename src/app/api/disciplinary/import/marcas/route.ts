import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { canImportDisciplinary } from "@/lib/permissions";
import { unauthorized, forbidden, badRequest, created, serverError } from "@/lib/api/response";
import { DuplicateImportError } from "@/lib/server/disciplinary-import";
import { importDisciplinaryMarcasWorkbook } from "@/lib/server/disciplinary-marcas-import";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canImportDisciplinary(session.user.role)) return forbidden();

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) {
      return badRequest("Adjunte un archivo Excel (.xlsx) en el campo «file»");
    }

    const sendRaw = form.get("sendEmail");
    const sendEmail =
      sendRaw === "true" ||
      sendRaw === "1" ||
      sendRaw === "on" ||
      (typeof sendRaw === "string" && sendRaw.toLowerCase() === "yes");

    const buffer = await file.arrayBuffer();
    const filename = "name" in file && typeof file.name === "string" ? file.name : "marcas.xlsx";

    let zoneOverrides: Record<string, { zona?: string; sucursal?: string }> | undefined;
    const zoRaw = form.get("zoneOverrides");
    if (typeof zoRaw === "string" && zoRaw.trim()) {
      try {
        const parsed = JSON.parse(zoRaw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          zoneOverrides = parsed as Record<string, { zona?: string; sucursal?: string }>;
        }
      } catch {
        return badRequest("zoneOverrides no es un JSON válido");
      }
    }

    const result = await importDisciplinaryMarcasWorkbook(buffer, filename, session.user.id, {
      sendEmail,
      zoneOverrides,
    });
    return created(result);
  } catch (e) {
    if (e instanceof DuplicateImportError) {
      return NextResponse.json(
        {
          error: {
            code: "DUPLICATE_IMPORT",
            message:
              "Este archivo ya fue importado anteriormente. No se procesó de nuevo para evitar duplicados.",
            previousBatch: {
              id: e.previousBatch.id,
              filename: e.previousBatch.filename,
              createdAt: e.previousBatch.createdAt.toISOString(),
              uploadedByName: e.previousBatch.uploadedByName,
            },
          },
        },
        { status: 409 },
      );
    }
    return serverError(
      e instanceof Error ? e.message : "Error al importar marcas",
      e,
    );
  }
}
