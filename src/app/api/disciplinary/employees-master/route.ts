import { NextRequest } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { canImportDisciplinary } from "@/lib/permissions";
import { ok, unauthorized, forbidden, badRequest, serverError } from "@/lib/api/response";
import { importDisciplinaryEmployeeMasterCsv } from "@/lib/server/disciplinary-employees-csv";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canImportDisciplinary(session.user.role)) return forbidden();

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) {
      return badRequest("Adjunte un archivo CSV en el campo «file»");
    }

    const text = await file.text();
    const filename = "name" in file && typeof file.name === "string" ? file.name : "empleados.csv";

    const result = await importDisciplinaryEmployeeMasterCsv(text, filename);
    return ok(result);
  } catch (e) {
    return serverError(
      e instanceof Error ? e.message : "Error al importar maestro de empleados",
      e,
    );
  }
}
