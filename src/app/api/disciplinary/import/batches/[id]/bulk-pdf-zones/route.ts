import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { canImportDisciplinary } from "@/lib/permissions";
import { unauthorized, forbidden, badRequest, serverError } from "@/lib/api/response";
import { buildBulkApercibimientoPdfByBatchZones } from "@/lib/server/disciplinary-bulk-zone-pdf";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canImportDisciplinary(session.user.role)) return forbidden();

  try {
    const { id } = await params;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Cuerpo JSON inválido");
    }
    const zoneKeys = (body as { zoneKeys?: unknown }).zoneKeys;
    if (!Array.isArray(zoneKeys) || zoneKeys.some((z) => typeof z !== "string")) {
      return badRequest("Indique zoneKeys: string[]");
    }

    const { pdf, mergedCount } = await buildBulkApercibimientoPdfByBatchZones(id, zoneKeys as string[]);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `apercibimientos-zonas-${stamp}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Merged-Count": String(mergedCount),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al generar PDF";
    if (
      msg.includes("Seleccione al menos") ||
      msg.includes("No hay apercibimientos") ||
      msg.includes("Lote no encontrado")
    ) {
      return badRequest(msg);
    }
    return serverError(msg, e);
  }
}
