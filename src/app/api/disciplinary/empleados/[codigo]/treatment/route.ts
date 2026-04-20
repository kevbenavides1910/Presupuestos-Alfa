import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/api/middleware";
import { canManageDisciplinary } from "@/lib/permissions";
import { ok, unauthorized, forbidden, badRequest, notFound, serverError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { normalizeEmployeeCode } from "@/lib/business/disciplinary";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado YYYY-MM-DD")
  .optional()
  .nullable();

const PutSchema = z.object({
  fechaConvocatoria: isoDate,
  accion: z.string().trim().max(200).optional().nullable(),
  cobradoDate: isoDate,
});

function parseLocalDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageDisciplinary(session.user.role)) return forbidden();

  try {
    const { codigo: codigoRaw } = await params;
    const codigo = normalizeEmployeeCode(decodeURIComponent(codigoRaw));
    if (!codigo) return badRequest("Código de empleado vacío");

    const body = await req.json();
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Datos inválidos", parsed.error.flatten());
    }

    // Verificamos que el código exista en algún apercibimiento o en tratamiento previo,
    // si no, no tiene sentido crear un tratamiento huérfano.
    const hasAny = await prisma.disciplinaryApercibimiento.findFirst({
      where: { codigoEmpleado: codigo },
      select: { id: true, nombreEmpleado: true, zona: true },
    });
    if (!hasAny) {
      const t = await prisma.disciplinaryTreatment.findUnique({
        where: { codigoEmpleado: codigo },
        select: { id: true },
      });
      if (!t) return notFound("No hay apercibimientos para ese código");
    }

    const data = {
      fechaConvocatoria: parseLocalDate(parsed.data.fechaConvocatoria ?? null),
      accion: parsed.data.accion?.trim() || null,
      cobradoDate: parseLocalDate(parsed.data.cobradoDate ?? null),
    };

    const treatment = await prisma.disciplinaryTreatment.upsert({
      where: { codigoEmpleado: codigo },
      create: {
        codigoEmpleado: codigo,
        codigoEmpleadoRaw: codigo,
        nombre: hasAny?.nombreEmpleado ?? null,
        zona: hasAny?.zona ?? null,
        ...data,
      },
      update: data,
    });

    return ok(treatment);
  } catch (e) {
    return serverError(
      e instanceof Error ? e.message : "Error al actualizar tratamiento",
      e,
    );
  }
}
