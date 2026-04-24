/** Clave para emparejar el texto «zona» de imports con el nombre en catálogo (sin depender de Prisma). */
export function normalizeZoneCatalogKey(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
