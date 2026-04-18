import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, serverError } from "@/lib/api/response";

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const uid = session.user.id;

    const expenses = await prisma.expense.findMany({
      where: {
        approvalStatus: { in: ["PENDING_APPROVAL", "PARTIALLY_APPROVED"] },
        currentApprovalStep: { not: null },
      },
      include: {
        contract: { select: { id: true, licitacionNo: true, client: true, company: true } },
        origin: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        approvals: {
          orderBy: { decidedAt: "asc" },
          include: { approver: { select: { id: true, name: true } } },
        },
        attachments: {
          orderBy: { createdAt: "asc" },
          include: { uploadedBy: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const resolved = await Promise.all(
      expenses.map(async (e) => {
        if (!e.currentApprovalStep) return { expense: e, isMine: false };
        const step = await prisma.expenseTypeApprovalStep.findUnique({
          where: {
            expenseType_stepOrder: {
              expenseType: e.type,
              stepOrder: e.currentApprovalStep,
            },
          },
        });
        return { expense: e, isMine: step?.approverUserId === uid };
      })
    );

    const mine = resolved.filter((r) => r.isMine).map((r) => r.expense);

    const data = mine.map((e) => ({
      ...e,
      amount: parseFloat(e.amount.toString()),
      periodMonth: e.periodMonth.toISOString(),
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      approvals: e.approvals.map((a) => ({
        ...a,
        decidedAt: a.decidedAt.toISOString(),
      })),
      attachments: e.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        note: a.note,
        createdAt: a.createdAt.toISOString(),
        uploadedBy: a.uploadedBy,
        downloadUrl: `/api/expenses/${e.id}/attachments/${a.id}`,
      })),
    }));

    return ok(data);
  } catch (e) {
    return serverError("Error al listar aprobaciones pendientes", e);
  }
}
