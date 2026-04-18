import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";
import { isCurrentApprover } from "@/lib/server/expense-approval";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().max(4000).optional(),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  try {
    const can = await isCurrentApprover(session, id);
    if (!can) return forbidden("Solo el aprobador del paso actual puede decidir");

    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) return notFound();
    if (expense.approvalStatus === "APPROVED" || expense.approvalStatus === "REJECTED") {
      return badRequest("Este gasto ya finalizó el flujo de aprobación");
    }
    const step = expense.currentApprovalStep;
    if (step == null) return badRequest("Estado de aprobación inválido");

    const { decision, comment } = parsed.data;

    await prisma.$transaction(async (tx) => {
      await tx.expenseApproval.create({
        data: {
          expenseId: id,
          stepOrder: step,
          approverUserId: session.user.id,
          decision,
          comment: comment?.trim() || null,
        },
      });

      if (decision === "REJECTED") {
        await tx.expenseDistribution.deleteMany({ where: { expenseId: id } });
        await tx.expense.update({
          where: { id },
          data: { approvalStatus: "REJECTED", currentApprovalStep: null, isDistributed: false },
        });
        return;
      }

      const next = step + 1;
      if (next > expense.requiredApprovalSteps) {
        await tx.expense.update({
          where: { id },
          data: { approvalStatus: "APPROVED", currentApprovalStep: null },
        });
      } else {
        await tx.expense.update({
          where: { id },
          data: { approvalStatus: "PARTIALLY_APPROVED", currentApprovalStep: next },
        });
      }
    });

    const fresh = await prisma.expense.findUnique({
      where: { id },
      include: {
        approvals: {
          orderBy: { decidedAt: "asc" },
          include: { approver: { select: { id: true, name: true } } },
        },
      },
    });

    return ok({
      approvalStatus: fresh?.approvalStatus,
      currentApprovalStep: fresh?.currentApprovalStep,
      requiredApprovalSteps: fresh?.requiredApprovalSteps,
      approvals:
        fresh?.approvals.map((a) => ({
          ...a,
          decidedAt: a.decidedAt.toISOString(),
        })) ?? [],
    });
  } catch (e) {
    return serverError("Error al registrar aprobación", e);
  }
}
