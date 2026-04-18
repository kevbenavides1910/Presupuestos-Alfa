import { NextRequest, NextResponse } from "next/server";
import { Prisma, ExpenseType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden } from "@/lib/api/response";
import { z } from "zod";

const EXPENSE_TYPE_VALUES = [
  "APERTURA",
  "UNIFORMS",
  "AUDIT",
  "ADMIN",
  "TRANSPORT",
  "FUEL",
  "PHONES",
  "PLANILLA",
  "OTHER",
] as const;

const putSchema = z.object({
  expenseType: z.enum(EXPENSE_TYPE_VALUES),
  steps: z.array(z.object({ approverUserId: z.string().min(1) })),
});

function prismaFailureResponse(context: string, e: unknown) {
  if (e instanceof Prisma.PrismaClientInitializationError) {
    console.error(`[${context}]`, e);
    const message =
      process.env.NODE_ENV === "development"
        ? `No se pudo conectar a la base de datos: ${e.message}`
        : "No se pudo conectar a la base de datos. Compruebe DATABASE_URL y que PostgreSQL esté en ejecución.";
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message } }, { status: 503 });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
    return badRequest(
      "Faltan tablas de aprobaciones en la base de datos. En la carpeta del proyecto ejecute: npx prisma migrate deploy"
    );
  }
  console.error(`[${context}]`, e);
  const isDev = process.env.NODE_ENV === "development";
  const detail =
    isDev && e instanceof Prisma.PrismaClientKnownRequestError
      ? `${e.code}: ${e.message}`
      : isDev && e instanceof Error
        ? e.message
        : undefined;
  const message =
    context === "GET expense-type-approval-steps"
      ? "Error al cargar cadenas de aprobación"
      : "Error al guardar cadena de aprobación";
  return NextResponse.json(
    { error: { code: "SERVER_ERROR", message, ...(detail ? { detail } : {}) } },
    { status: 500 }
  );
}

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const rows = await prisma.expenseTypeApprovalStep.findMany({
      orderBy: [{ expenseType: "asc" }, { stepOrder: "asc" }],
    });

    const approverIds = [...new Set(rows.map((r) => r.approverUserId))];
    const approvers =
      approverIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: approverIds } },
            select: { id: true, name: true, email: true, role: true },
          });
    const approverById = new Map(approvers.map((u) => [u.id, u]));

    const byType = new Map<ExpenseType, typeof rows>();
    for (const r of rows) {
      const list = byType.get(r.expenseType) ?? [];
      list.push(r);
      byType.set(r.expenseType, list);
    }

    const data = EXPENSE_TYPE_VALUES.map((type) => ({
      expenseType: type,
      steps: (byType.get(type as ExpenseType) ?? []).map((s) => ({
        id: s.id,
        stepOrder: s.stepOrder,
        approverUserId: s.approverUserId,
        approver: approverById.get(s.approverUserId),
      })),
    }));

    return ok(data);
  } catch (e) {
    return prismaFailureResponse("GET expense-type-approval-steps", e);
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const body = await req.json();
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const { expenseType, steps } = parsed.data;
    const userIds = [...new Set(steps.map((s) => s.approverUserId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true },
    });
    if (users.length !== userIds.length) {
      return badRequest("Uno o más usuarios aprobadores no existen o están inactivos");
    }

    await prisma.$transaction(async (tx) => {
      await tx.expenseTypeApprovalStep.deleteMany({ where: { expenseType } });
      if (steps.length === 0) return;
      await tx.expenseTypeApprovalStep.createMany({
        data: steps.map((s, i) => ({
          expenseType,
          stepOrder: i + 1,
          approverUserId: s.approverUserId,
        })),
      });
    });

    const updatedRows = await prisma.expenseTypeApprovalStep.findMany({
      where: { expenseType },
      orderBy: { stepOrder: "asc" },
    });
    const putApproverIds = [...new Set(updatedRows.map((r) => r.approverUserId))];
    const putApprovers =
      putApproverIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: putApproverIds } },
            select: { id: true, name: true, email: true, role: true },
          });
    const putApproverById = new Map(putApprovers.map((u) => [u.id, u]));
    const updated = updatedRows.map((s) => ({
      ...s,
      approver: putApproverById.get(s.approverUserId),
    }));

    return ok({ expenseType, steps: updated });
  } catch (e) {
    return prismaFailureResponse("PUT expense-type-approval-steps", e);
  }
}
