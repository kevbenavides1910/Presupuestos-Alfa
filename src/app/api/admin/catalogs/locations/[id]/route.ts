import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";

const updateSchema = z.object({
  zoneId: z.string().min(1).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const { id } = await params;
    const existing = await prisma.contractLocation.findUnique({ where: { id } });
    if (!existing) return notFound("Ubicación no encontrada");

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const data: { zoneId?: string | null } = {};
    if (parsed.data.zoneId !== undefined) {
      if (parsed.data.zoneId !== null) {
        const zone = await prisma.zone.findUnique({ where: { id: parsed.data.zoneId } });
        if (!zone) return badRequest("La zona indicada no existe");
      }
      data.zoneId = parsed.data.zoneId;
    }

    const updated = await prisma.contractLocation.update({
      where: { id },
      data,
      include: {
        contract: { select: { id: true, licitacionNo: true, client: true, company: true } },
        zone: { select: { id: true, name: true } },
      },
    });
    return ok(updated);
  } catch (e) {
    return serverError("Error al actualizar ubicación", e);
  }
}
