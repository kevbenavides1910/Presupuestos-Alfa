import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canModifyContracts } from "@/lib/api/middleware";
import { created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { readFirstSheetAsObjects } from "@/lib/import/xlsx-read";
import { contractRowFromSheet, isEmptyContractRow } from "@/lib/import/contract-rows";
import { recalculateEquivalence } from "@/lib/business/equivalence";
import { contractImportTemplateBuffer } from "@/lib/import/templates";
import type { ContractCreateInput } from "@/lib/validations/contract.schema";

function rowErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    const m = e.message;
    return m.length > 400 ? `${m.slice(0, 400)}…` : m;
  }
  return "Error al guardar en base de datos";
}

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const buf = contractImportTemplateBuffer();
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla_importar_contratos.xlsx"',
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) {
      return badRequest("Adjunte un archivo Excel (.xlsx) en el campo «file»");
    }

    const ab = await file.arrayBuffer();
    const rows = readFirstSheetAsObjects(ab, { preferredName: "Contratos" });
    const companyCatalog = await prisma.company.findMany({
      select: { code: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const parsedRows: { sheetRow: number; data: ContractCreateInput }[] = [];
    const errors: { sheetRow: number; message: string }[] = [];
    const seenLicit = new Set<string>();

    let sheetRow = 2;
    for (const row of rows) {
      if (isEmptyContractRow(row)) {
        sheetRow++;
        continue;
      }
      const result = contractRowFromSheet(row, sheetRow, companyCatalog);
      if (!result.ok) {
        errors.push({ sheetRow: result.sheetRow, message: result.message });
        sheetRow++;
        continue;
      }
      const lic = result.data.licitacionNo.trim();
      if (seenLicit.has(lic)) {
        errors.push({ sheetRow, message: `Licitación duplicada en el archivo: ${lic}` });
        sheetRow++;
        continue;
      }
      seenLicit.add(lic);
      parsedRows.push({ sheetRow, data: result.data });
      sheetRow++;
    }

    if (parsedRows.length === 0 && errors.length === 0) {
      return badRequest("No hay filas de datos (solo encabezados o filas vacías)");
    }

    const existing =
      seenLicit.size === 0
        ? []
        : await prisma.contract.findMany({
            where: { licitacionNo: { in: [...seenLicit] } },
            select: { licitacionNo: true },
          });
    const existingSet = new Set(existing.map((e) => e.licitacionNo));
    const toCreate = parsedRows.filter((p) => !existingSet.has(p.data.licitacionNo));
    const skippedExisting = parsedRows.filter((p) => existingSet.has(p.data.licitacionNo));
    const skippedExistingRows = skippedExisting.map((p) => ({
      sheetRow: p.sheetRow,
      licitacionNo: p.data.licitacionNo,
    }));

    let createdCount = 0;
    for (const { sheetRow, data } of toCreate) {
      try {
        await prisma.$transaction(async (tx) => {
          const contract = await tx.contract.create({
            data: {
              ...data,
              startDate: new Date(data.startDate),
              endDate: new Date(data.endDate),
              monthlyBilling: data.monthlyBilling,
              suppliesBudgetPct: data.suppliesPct,
              createdById: session.user.id,
            },
          });
          await tx.auditLog.create({
            data: {
              userId: session.user.id,
              contractId: contract.id,
              entityType: "Contract",
              entityId: contract.id,
              action: "CREATE",
              newData: JSON.stringify(contract),
            },
          });
        });
        createdCount++;
      } catch (e) {
        errors.push({ sheetRow, message: rowErrorMessage(e) });
      }
    }

    if (createdCount > 0) {
      await recalculateEquivalence();
    }

    const summaryParts: string[] = [];
    if (createdCount > 0) summaryParts.push(`${createdCount} contrato(s) nuevo(s)`);
    if (skippedExisting.length > 0) {
      summaryParts.push(`${skippedExisting.length} fila(s) omitida(s) — esa licitación ya está en el sistema`);
    }
    if (errors.length > 0) summaryParts.push(`${errors.length} fila(s) con error — revise el Excel`);

    const message =
      summaryParts.length > 0
        ? `Importación: ${summaryParts.join(". ")}.`
        : "Nada que importar.";

    return created({
      created: createdCount,
      skipped: skippedExisting.length,
      skippedExistingRows,
      errors,
      message,
    });
  } catch (e) {
    return serverError("Error al importar contratos", e);
  }
}
