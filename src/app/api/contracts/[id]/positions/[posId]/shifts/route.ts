import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canModifyContracts } from "@/lib/api/middleware";
import { created, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string; posId: string }> };

const createSchema = z.object({
  label: z.string().max(120).optional(),
  hours: z.coerce.number().positive().max(24),
  sortOrder: z.coerce.number().int().optional(),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id: contractId, posId } = await params;
  try {
    const pos = await prisma.position.findFirst({
      where: { id: posId, location: { contractId } },
      select: { id: true },
    });
    if (!pos) return notFound();

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const maxSort = await prisma.positionShift.aggregate({
      where: { positionId: posId },
      _max: { sortOrder: true },
    });
    const sortOrder = parsed.data.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1;

    const shift = await prisma.positionShift.create({
      data: {
        positionId: posId,
        label: parsed.data.label?.trim() || null,
        hours: parsed.data.hours,
        sortOrder,
      },
    });

    return created({ ...shift, hours: parseFloat(shift.hours.toString()) });
  } catch (e) {
    return serverError("Error al crear turno", e);
  }
}
