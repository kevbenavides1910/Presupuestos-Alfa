import path from "path";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PRIMARY_HEX, DEFAULT_SIDEBAR_HEX } from "@/lib/branding-constants";

export const BRANDING_UPLOAD_ROOT =
  process.env.BRANDING_UPLOAD_DIR?.trim()
    ? path.resolve(process.env.BRANDING_UPLOAD_DIR)
    : path.join(process.cwd(), "uploads", "branding");

export const ALLOWED_LOGO_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function mimeForLogoPath(logoPath: string): string {
  const lower = logoPath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

export function extensionForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "png";
}

/** Ruta absoluta segura bajo BRANDING_UPLOAD_ROOT */
export function absoluteBrandingFile(storedRelative: string): string {
  const normalized = storedRelative.replace(/\\/g, "/");
  if (normalized.includes("..") || !normalized.startsWith("branding/")) {
    throw new Error("Ruta de logo inválida");
  }
  const segments = normalized.split("/").filter(Boolean);
  return path.join(BRANDING_UPLOAD_ROOT, ...segments);
}

export function relativeLogoPath(mime: string): string {
  const ext = extensionForMime(mime);
  return `branding/logo.${ext}`;
}

export async function ensureBrandingRow() {
  return prisma.appBranding.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      primaryHex: DEFAULT_PRIMARY_HEX,
      sidebarHex: DEFAULT_SIDEBAR_HEX,
    },
    update: {},
  });
}
