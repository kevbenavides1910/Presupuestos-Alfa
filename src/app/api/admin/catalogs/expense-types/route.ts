import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { z } from "zod";
import { ExpenseType } from "@prisma/client";

const EXPENSE_TYPE_VALUES = ["APERTURA","UNIFORMS","AUDIT","ADMIN","TRANSPORT","FUEL","PHONES","PLANILLA","OTHER"] as const;

// Default configs used when no DB rows exist yet
const DEFAULTS: Record<ExpenseType, { label: string; color: string; sortOrder: number }> = {
  APERTURA:  { label: "Apertura",       color: "bg-blue-100 text-blue-800",     sortOrder: 1 },
  UNIFORMS:  { label: "Uniformes",      color: "bg-purple-100 text-purple-800", sortOrder: 2 },
  AUDIT:     { label: "Auditoría",      color: "bg-orange-100 text-orange-800", sortOrder: 3 },
  ADMIN:     { label: "Administrativo", color: "bg-slate-100 text-slate-700",   sortOrder: 4 },
  TRANSPORT: { label: "Transporte",     color: "bg-cyan-100 text-cyan-800",     sortOrder: 5 },
  FUEL:      { label: "Combustible",    color: "bg-yellow-100 text-yellow-800", sortOrder: 6 },
  PHONES:    { label: "Teléfonos",      color: "bg-green-100 text-green-800",   sortOrder: 7 },
  PLANILLA:  { label: "Planilla",       color: "bg-emerald-100 text-emerald-800", sortOrder: 8 },
  OTHER:     { label: "Otros",          color: "bg-gray-100 text-gray-700",     sortOrder: 9 },
};

const itemSchema = z.object({
  type:      z.enum(EXPENSE_TYPE_VALUES),
  label:     z.string().min(1, "Etiqueta requerida"),
  color:     z.string().min(1, "Color requerido"),
  isActive:  z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

function mergeExpenseTypeConfigs(
  dbRows: { id: string; type: ExpenseType; label: string; color: string; isActive: boolean; sortOrder: number; updatedAt: Date }[]
) {
  const byType = new Map(dbRows.map((r) => [r.type, r]));
  const merged = EXPENSE_TYPE_VALUES.map((type) => {
    const r = byType.get(type);
    if (r) return r;
    return {
      id: "",
      type,
      ...DEFAULTS[type],
      isActive: true,
      updatedAt: new Date(),
    };
  });
  merged.sort((a, b) => a.sortOrder - b.sortOrder);
  return merged;
}

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const rows = await prisma.expenseTypeConfig.findMany({
      orderBy: { sortOrder: "asc" },
    });

    return ok(mergeExpenseTypeConfigs(rows));
  } catch (e) {
    return serverError("Error al obtener configuración de tipos", e);
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const body = await req.json();
    const parsed = z.array(itemSchema).safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    await prisma.$transaction(
      parsed.data.map((item) =>
        prisma.expenseTypeConfig.upsert({
          where:  { type: item.type },
          create: { type: item.type, label: item.label, color: item.color, isActive: item.isActive, sortOrder: item.sortOrder },
          update: { label: item.label, color: item.color, isActive: item.isActive, sortOrder: item.sortOrder },
        })
      )
    );

    const updated = await prisma.expenseTypeConfig.findMany({ orderBy: { sortOrder: "asc" } });
    return ok(updated);
  } catch (e) {
    return serverError("Error al guardar configuración", e);
  }
}
