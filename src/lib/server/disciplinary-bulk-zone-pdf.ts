import { prisma } from "@/lib/prisma";
import { normalizeZoneCatalogKey } from "@/lib/business/disciplinary-zone-key";
import { buildOmisionPdfBytes } from "@/lib/server/disciplinary-omision-pdf";
import { ensureDisciplinarySettingsRow } from "@/lib/server/disciplinary-settings";
import { loadBrandingLogoFile, loadDisciplinarySignatureFile } from "@/lib/server/disciplinary-pdf-logo";
import { mergePdfBuffers } from "@/lib/server/disciplinary-merge-pdfs";

function isMarcasImportBatch(notes: string | null): boolean {
  return Boolean(notes?.startsWith("import_marcas"));
}

export async function listZonesWithEmailSentInBatch(batchId: string): Promise<
  { key: string; label: string; count: number }[]
> {
  const batch = await prisma.disciplinaryImportBatch.findUnique({
    where: { id: batchId },
    select: { notes: true },
  });
  if (!batch || !isMarcasImportBatch(batch.notes)) return [];

  const rows = await prisma.disciplinaryApercibimiento.findMany({
    where: {
      importBatchId: batchId,
      correoEnviadoA: { not: null },
      zona: { not: null },
    },
    select: { zona: true },
  });
  const counts = new Map<string, { label: string; count: number }>();
  for (const r of rows) {
    const raw = r.zona?.trim();
    if (!raw) continue;
    const key = normalizeZoneCatalogKey(raw);
    if (!key) continue;
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { label: raw, count: 1 });
  }
  return [...counts.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export async function buildBulkApercibimientoPdfByBatchZones(
  batchId: string,
  zoneKeys: string[],
): Promise<{ pdf: Uint8Array; mergedCount: number }> {
  const keySet = new Set(
    zoneKeys.map((k) => normalizeZoneCatalogKey(k)).filter((k) => k.length > 0),
  );
  if (keySet.size === 0) {
    throw new Error("Seleccione al menos una zona");
  }

  const batch = await prisma.disciplinaryImportBatch.findUnique({
    where: { id: batchId },
    select: { id: true, notes: true },
  });
  if (!batch || !isMarcasImportBatch(batch.notes)) {
    throw new Error("Lote no encontrado o no corresponde a importación de marcas");
  }

  const rows = await prisma.disciplinaryApercibimiento.findMany({
    where: {
      importBatchId: batchId,
      correoEnviadoA: { not: null },
    },
    include: {
      omisiones: {
        orderBy: [{ fecha: "asc" }, { hora: "asc" }, { secuencia: "asc" }],
      },
    },
    orderBy: { numero: "asc" },
  });

  const filtered = rows.filter(
    (r) => r.zona && keySet.has(normalizeZoneCatalogKey(r.zona)),
  );
  if (filtered.length === 0) {
    throw new Error(
      "No hay apercibimientos con correo enviado en las zonas elegidas. Verifique la selección o que ya se hayan enviado los correos.",
    );
  }

  const settings = await ensureDisciplinarySettingsRow();
  const [brandingLogoFile, signatureImageFile] = await Promise.all([
    loadBrandingLogoFile(),
    loadDisciplinarySignatureFile(),
  ]);

  const codigos = [...new Set(filtered.map((r) => r.codigoEmpleado))];
  const masters = await prisma.disciplinaryEmployeeMaster.findMany({
    where: { codigoEmpleado: { in: codigos } },
    select: { codigoEmpleado: true, cedula: true },
  });
  const masterByCodigo = new Map(masters.map((m) => [m.codigoEmpleado, m]));

  const pdfs: Uint8Array[] = [];
  for (const row of filtered) {
    const master = masterByCodigo.get(row.codigoEmpleado);
    const bytes = await buildOmisionPdfBytes({
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
    pdfs.push(bytes);
  }

  const pdf = await mergePdfBuffers(pdfs);
  return { pdf, mergedCount: filtered.length };
}
