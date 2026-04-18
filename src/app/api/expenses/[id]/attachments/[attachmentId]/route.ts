import { readFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/api/middleware";
import { unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { canViewExpenseDetail } from "@/lib/server/expense-approval";
import { EXPENSE_UPLOAD_ROOT } from "@/lib/server/expense-uploads";

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id: expenseId, attachmentId } = await params;
  try {
    const att = await prisma.expenseAttachment.findFirst({
      where: { id: attachmentId, expenseId },
    });
    if (!att) return notFound();

    const can = await canViewExpenseDetail(session, expenseId);
    if (!can) return forbidden();

    const abs = path.join(EXPENSE_UPLOAD_ROOT, att.storagePath);
    const buf = await readFile(abs).catch(() => null);
    if (!buf) return notFound();

    const inline = req.nextUrl.searchParams.get("inline") === "1";
    const disposition = inline ? "inline" : "attachment";

    return new Response(buf, {
      headers: {
        "Content-Type": att.mimeType,
        "Content-Disposition": `${disposition}; filename="${encodeURIComponent(att.fileName)}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e) {
    return serverError("Error al descargar adjunto", e);
  }
}
