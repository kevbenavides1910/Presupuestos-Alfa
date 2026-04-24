import { readFile } from "fs/promises";
import type { PDFDocument, PDFImage } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { absoluteBrandingFile } from "@/lib/server/app-branding";

export async function loadBrandingLogoFile(): Promise<{ bytes: Uint8Array; path: string } | null> {
  const row = await prisma.appBranding.findUnique({ where: { id: "default" } });
  const p = row?.logoPath?.trim();
  if (!p) return null;
  try {
    const buf = await readFile(absoluteBrandingFile(p));
    return { bytes: new Uint8Array(buf), path: p };
  } catch {
    return null;
  }
}

/** Firma/sello fijo configurado en Disciplinario → Ajustes → Documento (solo PNG/JPEG en el PDF). */
export async function loadDisciplinarySignatureFile(): Promise<{ bytes: Uint8Array; path: string } | null> {
  const row = await prisma.appDisciplinarySettings.findUnique({ where: { id: "default" } });
  const p = row?.documentSignaturePath?.trim();
  if (!p) return null;
  try {
    const buf = await readFile(absoluteBrandingFile(p));
    return { bytes: new Uint8Array(buf), path: p };
  } catch {
    return null;
  }
}

export async function embedBrandingLogo(pdf: PDFDocument, file: { bytes: Uint8Array; path: string } | null): Promise<PDFImage | null> {
  if (!file) return null;
  const lower = file.path.toLowerCase();
  try {
    if (lower.endsWith(".png")) return await pdf.embedPng(file.bytes);
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return await pdf.embedJpg(file.bytes);
  } catch {
    return null;
  }
  return null;
}

/** Alias para incrustar la firma (mismos formatos que el logo en PDF). */
export const embedDisciplinarySignatureImage = embedBrandingLogo;
