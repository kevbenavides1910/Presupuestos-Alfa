import type { PrismaClient } from "@prisma/client";

export async function listActiveCompanyRows(prisma: PrismaClient) {
  return prisma.company.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { code: true, name: true, isActive: true },
  });
}

export async function requireCompanyCode(
  prisma: PrismaClient,
  code: string,
  opts?: { mustBeActive?: boolean }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const row = await prisma.company.findUnique({ where: { code } });
  if (!row) return { ok: false, message: "Empresa no registrada" };
  if (opts?.mustBeActive && !row.isActive) return { ok: false, message: "Empresa inactiva" };
  return { ok: true };
}
