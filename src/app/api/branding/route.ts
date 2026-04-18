import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api/response";
import { DEFAULT_PRIMARY_HEX, DEFAULT_SIDEBAR_HEX } from "@/lib/branding-constants";

export async function GET() {
  try {
    const row = await prisma.appBranding.findUnique({ where: { id: "default" } });
    const primaryHex = row?.primaryHex?.trim() || DEFAULT_PRIMARY_HEX;
    const sidebarHex = row?.sidebarHex?.trim() || DEFAULT_SIDEBAR_HEX;
    const hasLogo = Boolean(row?.logoPath?.trim());
    return ok({
      primaryHex,
      sidebarHex,
      hasLogo,
      updatedAt: row?.updatedAt?.toISOString() ?? new Date().toISOString(),
    });
  } catch (e) {
    return serverError("Error al leer apariencia", e);
  }
}
