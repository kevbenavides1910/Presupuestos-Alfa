import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { canImportDisciplinary } from "@/lib/permissions";
import { unauthorized, forbidden, badRequest, created, serverError } from "@/lib/api/response";
import {
  importDisciplinaryWorkbook,
  DuplicateImportError,
} from "@/lib/server/disciplinary-import";

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

    const buffer = await file.arrayBuffer();
    const filename = "name" in file && typeof file.name === "string" ? file.name : "import.xlsx";

    const result = await importDisciplinaryWorkbook(buffer, filename, session.user.id);
    return created(result);
  } catch (e) {
    if (e instanceof DuplicateImportError) {
      // 409: archivo ya procesado. Devolvemos los datos del batch previo para que la
      // UI muestre un mensaje claro al usuario.
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
      e instanceof Error ? e.message : "Error al importar el Excel disciplinario",
      e,
    );
  }
}
