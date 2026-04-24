import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { canImportDisciplinary } from "@/lib/permissions";
import { unauthorized, forbidden, badRequest, notFound, serverError } from "@/lib/api/response";
import { buildMarcasPreviewPdfForCodigo } from "@/lib/server/disciplinary-marcas-import";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canImportDisciplinary(session.user.role)) return forbidden();

  try {
    const form = await req.formData();
    const file = form.get("file");
    const codigoRaw = form.get("codigo");
    const codigo = typeof codigoRaw === "string" ? codigoRaw.trim() : "";
    if (!file || !(file instanceof Blob)) {
      return badRequest("Adjunte un archivo Excel (.xlsx) en el campo «file»");
    }
    if (!codigo) {
      return badRequest("Indique el código de empleado (codigo)");
    }
    const buffer = await file.arrayBuffer();
    const zonaRaw = form.get("zona");
    const sucursalRaw = form.get("sucursal");
    const pdfOptions =
      typeof zonaRaw === "string" || typeof sucursalRaw === "string"
        ? {
            zona: typeof zonaRaw === "string" ? zonaRaw : undefined,
            sucursal: typeof sucursalRaw === "string" ? sucursalRaw : undefined,
          }
        : undefined;
    const pdf = await buildMarcasPreviewPdfForCodigo(buffer, codigo, pdfOptions);
    if (!pdf) {
      return notFound("No hay datos de omisión para ese código en el archivo");
    }
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="vista-previa-apercibimiento-${codigo.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf"`,
      },
    });
  } catch (e) {
    return serverError(e instanceof Error ? e.message : "Error al generar PDF", e);
  }
}
