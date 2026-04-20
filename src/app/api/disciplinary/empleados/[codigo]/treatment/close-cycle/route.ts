import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/api/middleware";
import { canManageDisciplinary } from "@/lib/permissions";
import { ok, unauthorized, forbidden, badRequest, notFound, serverError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { normalizeEmployeeCode, parseCycleAccion } from "@/lib/business/disciplinary";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado YYYY-MM-DD")
  .optional()
  .nullable();

/**
 * Cerrar un ciclo: toma el tratamiento vigente del empleado, lo archiva como
 * `DisciplinaryClosedCycle` y limpia los campos de tratamiento vigentes.
 *
 * Body:
 *   - accion (requerido): "Cobrado" | "Dado de baja" | otro texto.
 *   - monto (opcional, número): para acción Cobrado.
 *   - cerradoEl (opcional, YYYY-MM-DD): por defecto hoy.
 *   - count, omissions (opcional): cuántos apercibimientos / omisiones consolidaron este ciclo.
 *   - notas (opcional): texto libre.
 *   - resetTreatment (opcional, default true): si true, limpia tratamiento vigente.
 */
const Schema = z.object({
  accion: z.string().trim().min(1, "Indique la acción del cierre"),
  monto: z.number().nonnegative().optional().nullable(),
  cerradoEl: isoDate,
  count: z.number().int().nonnegative().optional().nullable(),
  omissions: z.number().int().nonnegative().optional().nullable(),
  notas: z.string().trim().max(2000).optional().nullable(),
  resetTreatment: z.boolean().optional(),
});

function parseLocalDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export async function POST(
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
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Datos inválidos", parsed.error.flatten());
    }

    const treatment = await prisma.disciplinaryTreatment.findUnique({
      where: { codigoEmpleado: codigo },
      select: {
        id: true,
        nombre: true,
        zona: true,
        fechaConvocatoria: true,
      },
    });

    // Si no hay tratamiento vigente, lo creamos ad-hoc tomando datos del primer
    // apercibimiento que encontremos para ese código.
    let treatmentId: string;
    if (treatment) {
      treatmentId = treatment.id;
    } else {
      const sample = await prisma.disciplinaryApercibimiento.findFirst({
        where: { codigoEmpleado: codigo },
        orderBy: { fechaEmision: "desc" },
        select: { nombreEmpleado: true, zona: true },
      });
      if (!sample) return notFound("No hay apercibimientos ni tratamiento para ese código");

      const created = await prisma.disciplinaryTreatment.create({
        data: {
          codigoEmpleado: codigo,
          codigoEmpleadoRaw: codigo,
          nombre: sample.nombreEmpleado,
          zona: sample.zona,
        },
        select: { id: true, nombre: true, zona: true, fechaConvocatoria: true },
      });
      treatmentId = created.id;
    }

    const accionParsed = parseCycleAccion(parsed.data.accion);
    const cerradoEl = parseLocalDate(parsed.data.cerradoEl ?? null) ?? new Date();
    const fechaConvocatoriaActual = treatment?.fechaConvocatoria ?? null;

    // Conteo de apercibimientos no anulados del empleado (default si no envían count).
    const countDefault =
      parsed.data.count ??
      (await prisma.disciplinaryApercibimiento.count({
        where: { codigoEmpleado: codigo, estado: { not: "ANULADO" } },
      }));

    // Suma de omisiones de los apercibimientos no anulados (default si no envían).
    const omissionsDefault =
      parsed.data.omissions ??
      (
        await prisma.disciplinaryApercibimiento.aggregate({
          where: { codigoEmpleado: codigo, estado: { not: "ANULADO" } },
          _sum: { cantidadOmisiones: true },
        })
      )._sum.cantidadOmisiones ??
      0;

    // Última fecha de apercibimiento del empleado (para `last_date`).
    const lastApercibimiento = await prisma.disciplinaryApercibimiento.findFirst({
      where: { codigoEmpleado: codigo, estado: { not: "ANULADO" } },
      orderBy: { fechaEmision: "desc" },
      select: { fechaEmision: true },
    });

    const rawJson: Record<string, unknown> = {
      cerrado_el: cerradoEl.toISOString(),
      accion: accionParsed.raw ?? parsed.data.accion,
      monto: parsed.data.monto ?? null,
      count: countDefault,
      omissions: omissionsDefault,
      last_date: lastApercibimiento?.fechaEmision?.toISOString() ?? null,
      fecha_convocatoria: fechaConvocatoriaActual?.toISOString() ?? null,
      nombre: treatment?.nombre ?? null,
      zona: treatment?.zona ?? null,
      notas: parsed.data.notas ?? null,
      cerrado_por_user_id: session.user.id,
    };

    const reset = parsed.data.resetTreatment !== false;

    const result = await prisma.$transaction(async (tx) => {
      const cycle = await tx.disciplinaryClosedCycle.create({
        data: {
          treatmentId,
          cerradoEl,
          accion: accionParsed.accion,
          accionRaw: accionParsed.raw,
          monto:
            parsed.data.monto !== null && parsed.data.monto !== undefined
              ? new Prisma.Decimal(parsed.data.monto)
              : null,
          count: countDefault,
          omissions: omissionsDefault,
          lastDate: lastApercibimiento?.fechaEmision ?? null,
          fechaConvocatoria: fechaConvocatoriaActual,
          nombre: treatment?.nombre ?? null,
          zona: treatment?.zona ?? null,
          raw: rawJson as Prisma.InputJsonValue,
        },
      });

      if (reset) {
        await tx.disciplinaryTreatment.update({
          where: { id: treatmentId },
          data: {
            fechaConvocatoria: null,
            accion: null,
            cobradoDate: null,
          },
        });
      }

      return cycle;
    });

    return ok(result);
  } catch (e) {
    return serverError(
      e instanceof Error ? e.message : "Error al cerrar ciclo",
      e,
    );
  }
}
