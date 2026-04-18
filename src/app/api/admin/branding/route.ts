import { NextRequest } from "next/server";
import { unlink } from "fs/promises";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import { DEFAULT_PRIMARY_HEX, DEFAULT_SIDEBAR_HEX } from "@/lib/branding-constants";
import { absoluteBrandingFile, ensureBrandingRow } from "@/lib/server/app-branding";

const hexSchema = z
  .string()
  .regex(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, "Color debe ser hexadecimal (#RGB o #RRGGBB)");

const patchSchema = z.object({
  primaryHex: hexSchema.optional(),
  sidebarHex: hexSchema.optional(),
  clearLogo: z.boolean().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const row = await ensureBrandingRow();
    return ok({
      primaryHex: row.primaryHex || DEFAULT_PRIMARY_HEX,
      sidebarHex: row.sidebarHex || DEFAULT_SIDEBAR_HEX,
      hasLogo: Boolean(row.logoPath?.trim()),
      logoPath: row.logoPath,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (e) {
    return serverError("Error al leer apariencia", e);
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const hasPatch =
      parsed.data.primaryHex !== undefined ||
      parsed.data.sidebarHex !== undefined ||
      parsed.data.clearLogo === true;
    if (!hasPatch) return badRequest("Indique al menos un color a guardar o marque quitar logo");

    const row = await ensureBrandingRow();

    if (parsed.data.clearLogo && row.logoPath) {
      try {
        await unlink(absoluteBrandingFile(row.logoPath));
      } catch {
        /* ignore missing file */
      }
    }

    const updated = await prisma.appBranding.update({
      where: { id: "default" },
      data: {
        ...(parsed.data.primaryHex !== undefined ? { primaryHex: parsed.data.primaryHex } : {}),
        ...(parsed.data.sidebarHex !== undefined ? { sidebarHex: parsed.data.sidebarHex } : {}),
        ...(parsed.data.clearLogo ? { logoPath: null } : {}),
      },
    });

    return ok({
      primaryHex: updated.primaryHex,
      sidebarHex: updated.sidebarHex,
      hasLogo: Boolean(updated.logoPath?.trim()),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (e) {
    return serverError("Error al guardar apariencia", e);
  }
}
