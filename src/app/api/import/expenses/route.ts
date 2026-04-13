import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { readFirstSheetAsObjects } from "@/lib/import/xlsx-read";
import {
  collectLicitacionesFromExpenseRows,
  expenseRowFromSheet,
  isEmptyExpenseRow,
} from "@/lib/import/expense-rows";
import { expenseImportTemplateBuffer } from "@/lib/import/templates";
import type { ExpenseCreateInput } from "@/lib/validations/expense.schema";

function rowErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    const m = e.message;
    return m.length > 400 ? `${m.slice(0, 400)}…` : m;
  }
  return "Error al guardar en base de datos";
}

function splitAmountAcrossMonths(total: number, months: number): number[] {
  if (months <= 1) return [total];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / months);
  const remainder = cents - base * months;
  const out: number[] = [];
  for (let i = 0; i < months; i++) {
    out.push((base + (i < remainder ? 1 : 0)) / 100);
  }
  return out;
}

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  const buf = expenseImportTemplateBuffer();
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla_importar_gastos.xlsx"',
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) {
      return badRequest("Adjunte un archivo Excel (.xlsx) en el campo «file»");
    }

    const ab = await file.arrayBuffer();
    const rows = readFirstSheetAsObjects(ab, { preferredName: "Gastos" });

    const companyCatalog = await prisma.company.findMany({
      select: { code: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    const origins = await prisma.expenseOrigin.findMany({ select: { id: true, name: true } });
    const originIdByName = new Map<string, string>();
    for (const o of origins) {
      const key = o.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      originIdByName.set(key, o.id);
    }

    const licitaciones = collectLicitacionesFromExpenseRows(rows);

    const contracts =
      licitaciones.length > 0
        ? await prisma.contract.findMany({
            where: { licitacionNo: { in: licitaciones }, deletedAt: null },
            select: { id: true, licitacionNo: true, company: true },
          })
        : [];
    const contractIdByLicitacion = new Map<string, { id: string; company: string }>();
    for (const c of contracts) {
      contractIdByLicitacion.set(c.licitacionNo.trim(), { id: c.id, company: c.company });
    }

    const errors: { sheetRow: number; message: string }[] = [];
    const toInsert: { sheetRow: number; data: ExpenseCreateInput }[] = [];

    let sheetRow = 2;
    for (const row of rows) {
      if (isEmptyExpenseRow(row)) {
        sheetRow++;
        continue;
      }
      const result = expenseRowFromSheet(row, sheetRow, contractIdByLicitacion, originIdByName, companyCatalog);
      if (!result.ok) {
        errors.push({ sheetRow: result.sheetRow, message: result.message });
      } else {
        toInsert.push({ sheetRow, data: result.data });
      }
      sheetRow++;
    }

    if (toInsert.length === 0 && errors.length === 0) {
      return badRequest("No hay filas de datos (solo encabezados o filas vacías)");
    }

    const include = {
      contract: { select: { id: true, licitacionNo: true, client: true, company: true } },
      origin: { select: { id: true, name: true } },
    } as const;

    let createdCount = 0;

    for (const { sheetRow, data } of toInsert) {
      const {
        periodMonth,
        amount,
        spreadMonths: rawSpread,
        description,
        type,
        budgetLine,
        contractId,
        positionId,
        originId,
        referenceNumber,
        company,
        isDeferred,
        notes,
      } = data;

      const spreadMonths = isDeferred ? 1 : rawSpread;
      const [year, month] = periodMonth.split("-").map(Number);
      const start = new Date(year, month - 1, 1);

      const common = {
        type,
        budgetLine,
        contractId,
        positionId: positionId || null,
        originId: originId || null,
        referenceNumber: referenceNumber || null,
        company,
        isDeferred,
        notes: notes || null,
        createdById: session.user.id,
      };

      try {
        if (spreadMonths <= 1) {
          await prisma.expense.create({
            data: {
              ...common,
              description: description.trim(),
              amount,
              periodMonth: start,
            },
            include,
          });
          createdCount++;
          continue;
        }

        const amounts = splitAmountAcrossMonths(amount, spreadMonths);
        const desc = description.trim();
        await prisma.$transaction(
          amounts.map((amt, i) =>
            prisma.expense.create({
              data: {
                ...common,
                description: `${desc} (mes ${i + 1}/${spreadMonths})`,
                amount: amt,
                periodMonth: new Date(year, month - 1 + i, 1),
              },
              include,
            })
          )
        );
        createdCount += amounts.length;
      } catch (e) {
        errors.push({ sheetRow, message: rowErrorMessage(e) });
      }
    }

    const partialMsg =
      createdCount > 0 && errors.length > 0
        ? `Importación parcial: ${createdCount} movimiento(s) guardados; ${errors.length} fila(s) con error.`
        : null;

    return created({
      created: createdCount,
      errors,
      message:
        partialMsg ??
        (createdCount > 0
          ? `Se registraron ${createdCount} movimiento(s) de gasto.`
          : errors.length > 0
            ? "No se importaron filas válidas; revise los errores."
            : "Nada que importar."),
    });
  } catch (e) {
    return serverError("Error al importar gastos", e);
  }
}
