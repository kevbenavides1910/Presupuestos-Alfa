import { NextRequest } from "next/server";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { created, badRequest, unauthorized, forbidden, serverError } from "@/lib/api/response";
import {
  absoluteBrandingFile,
  ALLOWED_LOGO_MIMES,
  MAX_LOGO_BYTES,
  relativeLogoPath,
  ensureBrandingRow,
} from "@/lib/server/app-branding";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const row = await ensureBrandingRow();
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return badRequest("Archivo requerido");

    const blob = file as File;
    if (blob.size > MAX_LOGO_BYTES) return badRequest("Logo demasiado grande (máximo 2 MB)");
    const mime = blob.type || "application/octet-stream";
    if (!ALLOWED_LOGO_MIMES.has(mime)) {
      return badRequest("Solo se permiten imágenes PNG, JPEG o WebP");
    }

    const rel = relativeLogoPath(mime);
    const abs = absoluteBrandingFile(rel);
    await mkdir(path.dirname(abs), { recursive: true });

    if (row.logoPath && row.logoPath !== rel) {
      try {
        await unlink(absoluteBrandingFile(row.logoPath));
      } catch {
        /* ignore */
      }
    }

    const buf = Buffer.from(await blob.arrayBuffer());
    await writeFile(abs, buf);

    const updated = await prisma.appBranding.update({
      where: { id: "default" },
      data: { logoPath: rel },
    });

    return created({
      logoPath: updated.logoPath,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (e) {
    return serverError("Error al subir logo", e);
  }
}
