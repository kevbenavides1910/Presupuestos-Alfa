import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses } from "@/lib/api/middleware";
import { ok, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";

type Ctx = { params: Promise<{ id: string; findingId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  const { id, findingId } = await params;
  const finding = await prisma.auditFinding.findFirst({
    where: { id: findingId, contractId: id },
  });
  if (!finding) return notFound();

  try {
    const body = await req.json();
    const updated = await prisma.auditFinding.update({
      where: { id: findingId },
      data: {
        ...body,
        ...(body.status === "COMPLETED" && finding.status !== "COMPLETED"
          ? { resolvedAt: new Date() }
          : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        contractId: id,
        entityType: "AuditFinding",
        entityId: findingId,
        action: body.status ? "STATUS_CHANGE" : "UPDATE",
        previousData: JSON.stringify(finding),
        newData: JSON.stringify(updated),
      },
    });

    return ok({ ...updated, totalCost: parseFloat(updated.totalCost.toString()) });
  } catch (e) {
    return serverError("Error al actualizar hallazgo", e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageExpenses(session.user.role)) return forbidden();

  const { id, findingId } = await params;
  const finding = await prisma.auditFinding.findFirst({
    where: { id: findingId, contractId: id },
  });
  if (!finding) return notFound();

  await prisma.auditFinding.delete({ where: { id: findingId } });
  return ok({ message: "Hallazgo eliminado" });
}
