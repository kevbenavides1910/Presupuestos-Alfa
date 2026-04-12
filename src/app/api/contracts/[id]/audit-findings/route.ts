import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { auditFindingSchema } from "@/lib/validations/expense.schema";
import { AUDIT_ITEMS } from "@/lib/utils/constants";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const findings = await prisma.auditFinding.findMany({
    where: { contractId: id, ...(status ? { status: status as "PENDING" | "COMPLETED" } : {}) },
    orderBy: { findingDate: "desc" },
  });

  return ok(findings.map((f) => ({
    ...f,
    totalCost: parseFloat(f.totalCost.toString()),
  })));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  const { id } = await params;
  try {
    const body = await req.json();
    const parsed = auditFindingSchema.safeParse({ ...body, contractId: id });
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const data = parsed.data;

    let totalCost = 0;
    for (const item of AUDIT_ITEMS) {
      const qty = data[item.qtyKey as keyof typeof data] as number ?? 0;
      const cost = data[item.costKey as keyof typeof data] as number ?? 0;
      totalCost += qty * cost;
    }

    const finding = await prisma.auditFinding.create({
      data: {
        ...data,
        contractId: id,
        findingDate: new Date(data.findingDate),
        totalCost,
        createdById: session.user.id,
      },
    });

    return created({ ...finding, totalCost: parseFloat(finding.totalCost.toString()) });
  } catch (e) {
    return serverError("Error al registrar hallazgo", e);
  }
}
