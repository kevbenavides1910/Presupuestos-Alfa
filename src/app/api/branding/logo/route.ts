import { readFile } from "fs/promises";
import { prisma } from "@/lib/prisma";
import { absoluteBrandingFile, mimeForLogoPath } from "@/lib/server/app-branding";
import { notFound, serverError } from "@/lib/api/response";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const row = await prisma.appBranding.findUnique({ where: { id: "default" } });
    const rel = row?.logoPath?.trim();
    if (!rel) return notFound("Sin logo configurado");

    const abs = absoluteBrandingFile(rel);
    const buf = await readFile(abs);
    const mime = mimeForLogoPath(rel);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return notFound("Logo no encontrado");
    return serverError("Error al servir logo", e);
  }
}
