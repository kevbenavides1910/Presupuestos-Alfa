import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, canModifyContracts } from "@/lib/api/middleware";
import { created, badRequest, unauthorized, forbidden, notFound, serverError } from "@/lib/api/response";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string; locationId: string }> };

const shiftInput = z.object({
  label: z.string().max(120).optional(),
  hours: z.coerce.number().positive("Las horas deben ser mayores a 0").max(24),
  sortOrder: z.coerce.number().int().optional(),
});

const createPositionSchema = z.object({
  name: z.string().min(2, "Nombre del puesto requerido"),
  description: z.string().optional(),
  shifts: z.array(shiftInput).optional(),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canModifyContracts(session.user.role)) return forbidden();

  const { id: contractId, locationId } = await params;
  try {
    const loc = await prisma.contractLocation.findFirst({
      where: { id: locationId, contractId },
      select: { id: true },
    });
    if (!loc) return notFound();

    const body = await req.json();
    const parsed = createPositionSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const shifts = parsed.data.shifts ?? [];
    const position = await prisma.$transaction(async (tx) => {
      const pos = await tx.position.create({
        data: {
          locationId,
          name: parsed.data.name.trim(),
          description: parsed.data.description?.trim() || null,
        },
      });
      if (shifts.length > 0) {
        await tx.positionShift.createMany({
          data: shifts.map((s, i) => ({
            positionId: pos.id,
            label: s.label?.trim() || null,
            hours: s.hours,
            sortOrder: s.sortOrder ?? i,
          })),
        });
      }
      return tx.position.findUnique({
        where: { id: pos.id },
        include: { shifts: { orderBy: { sortOrder: "asc" } } },
      });
    });

    return created(position);
  } catch (e) {
    return serverError("Error al crear puesto", e);
  }
}
