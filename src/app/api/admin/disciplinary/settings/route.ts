import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { badRequest, forbidden, ok, serverError, unauthorized } from "@/lib/api/response";
import { unlink } from "fs/promises";
import {
  DISCIPLINARY_MAIL_PROVIDERS,
  ensureDisciplinarySettingsRow,
  normalizeMailProvider,
} from "@/lib/server/disciplinary-settings";
import { absoluteBrandingFile } from "@/lib/server/app-branding";

const patchSchema = z.object({
  documentTitle: z.string().trim().min(3).max(180).optional(),
  documentLegalText: z.string().trim().min(3).max(5000).optional(),
  documentFooter: z.string().trim().min(3).max(1000).optional(),
  documentFormCode: z.string().trim().min(2).max(40).optional(),
  documentFormRevision: z.string().trim().min(2).max(40).optional(),
  documentFormVersion: z.string().trim().min(1).max(20).optional(),
  documentFormSubtitle: z.string().trim().min(3).max(180).optional(),
  documentIntroTemplate: z.string().trim().min(20).max(8000).optional(),
  emailFixedCc: z.string().trim().max(4000).optional().nullable(),
  emailSubjectTemplate: z.string().trim().min(3).max(300).optional(),
  emailBodyTemplate: z.string().trim().min(3).max(8000).optional(),
  mailProvider: z.enum(DISCIPLINARY_MAIL_PROVIDERS).optional(),
  smtpHost: z.string().trim().max(200).optional().nullable(),
  smtpPort: z.number().int().min(1).max(65535).optional().nullable(),
  smtpSecure: z.boolean().optional().nullable(),
  smtpUser: z.string().trim().max(240).optional().nullable(),
  smtpPass: z.string().max(500).optional().nullable(),
  smtpFrom: z.string().trim().max(240).optional().nullable(),
  clearDocumentSignature: z.boolean().optional(),
});

function cleanNullable(v: string | null | undefined): string | null {
  if (v === undefined) return null;
  if (v === null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();
  try {
    const row = await ensureDisciplinarySettingsRow();
    return ok({
      ...row,
      smtpPass: row.smtpPass ? "********" : "",
    });
  } catch (e) {
    return serverError("Error al cargar configuración disciplinaria", e);
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();
  try {
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());
    const body = parsed.data;

    const updates: Record<string, unknown> = {};
    if (body.documentTitle !== undefined) updates.documentTitle = body.documentTitle;
    if (body.documentLegalText !== undefined) updates.documentLegalText = body.documentLegalText;
    if (body.documentFooter !== undefined) updates.documentFooter = body.documentFooter;
    if (body.documentFormCode !== undefined) updates.documentFormCode = body.documentFormCode;
    if (body.documentFormRevision !== undefined) updates.documentFormRevision = body.documentFormRevision;
    if (body.documentFormVersion !== undefined) updates.documentFormVersion = body.documentFormVersion;
    if (body.documentFormSubtitle !== undefined) updates.documentFormSubtitle = body.documentFormSubtitle;
    if (body.documentIntroTemplate !== undefined) updates.documentIntroTemplate = body.documentIntroTemplate;
    if (body.emailFixedCc !== undefined) updates.emailFixedCc = cleanNullable(body.emailFixedCc);
    if (body.emailSubjectTemplate !== undefined) updates.emailSubjectTemplate = body.emailSubjectTemplate;
    if (body.emailBodyTemplate !== undefined) updates.emailBodyTemplate = body.emailBodyTemplate;
    if (body.mailProvider !== undefined) updates.mailProvider = normalizeMailProvider(body.mailProvider);
    if (body.smtpHost !== undefined) updates.smtpHost = cleanNullable(body.smtpHost);
    if (body.smtpPort !== undefined) updates.smtpPort = body.smtpPort ?? null;
    if (body.smtpSecure !== undefined) updates.smtpSecure = body.smtpSecure ?? null;
    if (body.smtpUser !== undefined) updates.smtpUser = cleanNullable(body.smtpUser);
    if (body.smtpFrom !== undefined) updates.smtpFrom = cleanNullable(body.smtpFrom);
    if (body.smtpPass !== undefined) {
      const pass = body.smtpPass?.trim() ?? "";
      updates.smtpPass = pass.length > 0 ? pass : null;
    }
    if (body.clearDocumentSignature === true) {
      updates.documentSignaturePath = null;
    }
    if (Object.keys(updates).length === 0) return badRequest("No hay cambios para guardar");

    await ensureDisciplinarySettingsRow();
    const existing = await prisma.appDisciplinarySettings.findUnique({ where: { id: "default" } });
    if (body.clearDocumentSignature === true && existing?.documentSignaturePath) {
      try {
        await unlink(absoluteBrandingFile(existing.documentSignaturePath));
      } catch {
        /* ignore missing file */
      }
    }
    const row = await prisma.appDisciplinarySettings.update({
      where: { id: "default" },
      data: updates,
    });
    return ok({
      ...row,
      smtpPass: row.smtpPass ? "********" : "",
    });
  } catch (e) {
    return serverError("Error al guardar configuración disciplinaria", e);
  }
}
