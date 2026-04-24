import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { canViewDisciplinary } from "@/lib/permissions";
import { unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { buildOmisionPdfBytes } from "@/lib/server/disciplinary-omision-pdf";
import { ensureDisciplinarySettingsRow } from "@/lib/server/disciplinary-settings";
import { loadBrandingLogoFile, loadDisciplinarySignatureFile } from "@/lib/server/disciplinary-pdf-logo";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canViewDisciplinary(session.user.role)) return forbidden();

  try {
    const { id } = await params;
    const row = await prisma.disciplinaryApercibimiento.findUnique({
      where: { id },
      include: {
        omisiones: {
          orderBy: [{ fecha: "asc" }, { hora: "asc" }, { secuencia: "asc" }],
        },
      },
    });
    if (!row) return notFound("Apercibimiento no encontrado");

    const settings = await ensureDisciplinarySettingsRow();
    const [brandingLogoFile, signatureImageFile] = await Promise.all([
      loadBrandingLogoFile(),
      loadDisciplinarySignatureFile(),
    ]);
    const master = await prisma.disciplinaryEmployeeMaster.findUnique({
      where: { codigoEmpleado: row.codigoEmpleado },
      select: { cedula: true },
    });

    const pdfBytes = await buildOmisionPdfBytes({
      numero: row.numero,
      codigoEmpleado: row.codigoEmpleado,
      nombreEmpleado: row.nombreEmpleado,
      fechaEmision: row.fechaEmision,
      cedula: master?.cedula?.trim() || null,
      zona: row.zona,
      sucursal: row.sucursal,
      administrador: row.administrador,
      omisiones: row.omisiones.map((o) => ({
        fecha: o.fecha,
        hora: o.hora,
        puntoOmitido: o.puntoOmitido,
      })),
      documentTitle: settings.documentTitle,
      documentLegalText: settings.documentLegalText,
      documentIntroTemplate: settings.documentIntroTemplate,
      documentFooter: settings.documentFooter,
      formCode: settings.documentFormCode,
      formRevision: settings.documentFormRevision,
      formVersion: settings.documentFormVersion,
      formSubtitle: settings.documentFormSubtitle,
      brandingLogoFile,
      signatureImageFile,
    });

    const filename = `Apercibimiento-${row.numero.replace(/[^a-zA-Z0-9-_.]/g, "_")}.pdf`;
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return serverError(e instanceof Error ? e.message : "Error al generar PDF", e);
  }
}
