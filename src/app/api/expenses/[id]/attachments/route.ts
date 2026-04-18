import { NextRequest } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getSession, canManageExpenses, isAdmin } from "@/lib/api/middleware";
import {
  ok,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  serverError,
  created,
} from "@/lib/api/response";
import { canViewExpenseDetail, isCurrentApprover } from "@/lib/server/expense-approval";
import {
  ALLOWED_EXPENSE_ATTACHMENT_MIMES,
  MAX_EXPENSE_ATTACHMENT_BYTES,
  expenseAttachmentDir,
  storagePathForFile,
} from "@/lib/server/expense-uploads";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  try {
    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) return notFound();

    const canView = await canViewExpenseDetail(session, id);
    if (!canView) return forbidden();

    const allowedUpload =
      expense.createdById === session.user.id ||
      (await isCurrentApprover(session, id)) ||
      canManageExpenses(session.user.role) ||
      isAdmin(session.user.role);
    if (!allowedUpload) return forbidden("No puede adjuntar archivos a este gasto");

    const form = await req.formData();
    const file = form.get("file");
    const noteRaw = form.get("note");
    const note =
      typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim().slice(0, 2000) : null;

    if (!file || typeof file === "string") return badRequest("Archivo requerido");

    const blob = file as File;
    if (blob.size > MAX_EXPENSE_ATTACHMENT_BYTES) {
      return badRequest("Archivo demasiado grande (máximo 15 MB)");
    }

    const mime = blob.type || "application/octet-stream";
    if (!ALLOWED_EXPENSE_ATTACHMENT_MIMES.has(mime)) {
      return badRequest("Tipo de archivo no permitido (PDF, imágenes, Excel o CSV)");
    }

    const originalName = blob.name || "adjunto";
    const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    const storedName = `${Date.now()}_${safe}`;

    const dir = expenseAttachmentDir(id);
    await mkdir(dir, { recursive: true });
    const absPath = path.join(dir, storedName);
    const buf = Buffer.from(await blob.arrayBuffer());
    await writeFile(absPath, buf);

    const rel = storagePathForFile(id, storedName);
    const row = await prisma.expenseAttachment.create({
      data: {
        expenseId: id,
        uploadedById: session.user.id,
        fileName: originalName.slice(0, 255),
        mimeType: mime,
        storagePath: rel,
        note,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });

    return created({
      ...row,
      createdAt: row.createdAt.toISOString(),
      downloadUrl: `/api/expenses/${id}/attachments/${row.id}`,
    });
  } catch (e) {
    return serverError("Error al subir adjunto", e);
  }
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  try {
    const can = await canViewExpenseDetail(session, id);
    if (!can) return forbidden();

    const rows = await prisma.expenseAttachment.findMany({
      where: { expenseId: id },
      orderBy: { createdAt: "asc" },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });

    return ok(
      rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        downloadUrl: `/api/expenses/${id}/attachments/${r.id}`,
      }))
    );
  } catch (e) {
    return serverError("Error al listar adjuntos", e);
  }
}
