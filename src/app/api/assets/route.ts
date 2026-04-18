import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { z } from "zod";
import type { AssetStatus, Prisma } from "@prisma/client";

// GET: list assets with filters
// Filters: status, typeId, contractId (assigned positions under contract), q (code/brand/model search)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as AssetStatus | null;
    const typeId = searchParams.get("typeId");
    const contractId = searchParams.get("contractId");
    const positionId = searchParams.get("positionId");
    const q = searchParams.get("q")?.trim();

    const where: Prisma.AssetWhereInput = {};
    if (status) where.status = status;
    if (typeId) where.typeId = typeId;
    if (positionId) where.currentPositionId = positionId;
    if (contractId) where.currentPosition = { location: { contractId } };
    if (q) {
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
        { model: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.asset.findMany({
      where,
      include: {
        type: true,
        currentPosition: {
          include: {
            location: {
              include: {
                contract: { select: { id: true, licitacionNo: true, client: true } },
                zone: { select: { id: true, name: true } },
              },
            },
          },
        },
        acquisitionExpense: { select: { id: true, description: true, referenceNumber: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    return ok(rows);
  } catch (e) {
    return serverError("Error al obtener activos", e);
  }
}

// POST: create one or more assets as an "intake" batch
const itemSchema = z.object({
  code: z.string().min(1).max(120),
  name: z.string().max(200).optional().nullable(),
  brand: z.string().max(120).optional().nullable(),
  model: z.string().max(120).optional().nullable(),
  attributes: z.record(z.unknown()).default({}),
});

const createSchema = z.object({
  typeId: z.string().min(1),
  intakeReason: z.enum(["PURCHASE", "RETURN", "INITIAL", "OTHER"]).default("PURCHASE"),
  expenseId: z.string().optional().nullable(),
  acquisitionDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1, "Al menos un activo"),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const data = parsed.data;
    const type = await prisma.assetType.findUnique({ where: { id: data.typeId } });
    if (!type) return badRequest("Tipo de activo no encontrado");
    if (!type.isActive) return badRequest("Tipo de activo inactivo");

    if (data.expenseId) {
      const expense = await prisma.expense.findUnique({ where: { id: data.expenseId } });
      if (!expense) return badRequest("Gasto / OC referenciado no existe");
    }

    // Validate required fields per type
    const typeFields = Array.isArray(type.fields) ? (type.fields as Array<{ key: string; required?: boolean; label?: string }>) : [];
    for (const item of data.items) {
      for (const f of typeFields) {
        if (f.required) {
          const v = item.attributes[f.key];
          if (v === undefined || v === null || v === "") {
            return badRequest(`Falta el campo "${f.label ?? f.key}" en el activo ${item.code}`);
          }
        }
      }
    }

    // Check duplicate codes within type
    const codes = data.items.map((i) => i.code);
    const dupInBatch = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dupInBatch) return badRequest(`Código duplicado en el lote: ${dupInBatch}`);
    const existing = await prisma.asset.findMany({
      where: { typeId: data.typeId, code: { in: codes } },
      select: { code: true },
    });
    if (existing.length > 0) {
      return badRequest(`Código(s) ya registrados para este tipo: ${existing.map((e) => e.code).join(", ")}`);
    }

    const acquisitionDate = data.acquisitionDate ? new Date(data.acquisitionDate) : new Date();

    const result = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const item of data.items) {
        const asset = await tx.asset.create({
          data: {
            typeId: data.typeId,
            code: item.code.trim(),
            name: item.name?.trim() || null,
            brand: item.brand?.trim() || null,
            model: item.model?.trim() || null,
            attributes: item.attributes as Prisma.InputJsonValue,
            status: "IN_STOCK",
            acquisitionExpenseId: data.expenseId || null,
            acquisitionDate,
            notes: data.notes?.trim() || null,
          },
        });
        await tx.assetMovement.create({
          data: {
            assetId: asset.id,
            type: "INTAKE",
            intakeReason: data.intakeReason,
            expenseId: data.expenseId || null,
            notes: data.notes?.trim() || null,
            createdById: session.user.id,
          },
        });
        created.push(asset);
      }
      return created;
    });

    return created({ count: result.length, assets: result });
  } catch (e) {
    return serverError("Error al crear activos", e);
  }
}
