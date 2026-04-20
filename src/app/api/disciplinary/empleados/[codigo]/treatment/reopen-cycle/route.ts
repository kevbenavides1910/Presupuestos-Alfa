import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/api/middleware";
import { canManageDisciplinary } from "@/lib/permissions";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  notFound,
  serverError,
} from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { normalizeEmployeeCode } from "@/lib/business/disciplinary";

/**
 * Reabre un ciclo cerrado:
 *  - Por defecto reabre el último ciclo cerrado (mayor `cerradoEl`, fallback `createdAt`).
 *  - Si se pasa `cycleId`, reabre ese ciclo específico.
 *
 * Efectos:
 *  - Restaura los campos del tratamiento vigente con los valores archivados:
 *      fechaConvocatoria, accion (texto), cobradoDate (si la acción era Cobrado).
 *  - Elimina el `DisciplinaryClosedCycle` reabierto, para que el contador del
 *    ciclo vigente vuelva a incluir los apercibimientos posteriores al cierre
 *    anterior (que ahora ya no existe).
 *
 * Requiere permiso `canManageDisciplinary`.
 */
const Schema = z
  .object({
    cycleId: z.string().min(1).optional(),
  })
  .optional();

interface RawCycleJson {
  cobrado_date?: string | null;
  cerrado_el?: string | null;
  fecha_convocatoria?: string | null;
  accion?: string | null;
}

function parseDateMaybe(s: unknown): Date | null {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
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

    let body: { cycleId?: string } | undefined;
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());
    const cycleIdParam = parsed.data?.cycleId;

    const treatment = await prisma.disciplinaryTreatment.findUnique({
      where: { codigoEmpleado: codigo },
      select: { id: true },
    });
    if (!treatment) return notFound("El empleado no tiene tratamiento");

    // Buscamos el ciclo objetivo.
    const cycle = cycleIdParam
      ? await prisma.disciplinaryClosedCycle.findFirst({
          where: { id: cycleIdParam, treatmentId: treatment.id },
        })
      : await prisma.disciplinaryClosedCycle.findFirst({
          where: { treatmentId: treatment.id },
          orderBy: [{ cerradoEl: "desc" }, { id: "desc" }],
        });

    if (!cycle) return notFound("No hay ciclos cerrados para reabrir");

    // Datos a restaurar en el tratamiento vigente.
    const raw = (cycle.raw as RawCycleJson | null) ?? null;
    const fechaConvocatoria = cycle.fechaConvocatoria ?? parseDateMaybe(raw?.fecha_convocatoria);
    const accionTexto = cycle.accionRaw ?? raw?.accion ?? cycle.accion ?? null;

    // cobradoDate: solo si el ciclo era Cobrado (heurística por accion).
    const accionLower = (cycle.accionRaw ?? cycle.accion ?? "").toString().toLowerCase();
    const wasCobrado = accionLower.includes("cobr");
    const cobradoDate = wasCobrado
      ? parseDateMaybe(raw?.cobrado_date) ?? cycle.cerradoEl ?? null
      : null;

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.disciplinaryTreatment.update({
        where: { id: treatment.id },
        data: {
          fechaConvocatoria,
          accion: accionTexto,
          cobradoDate,
        },
        select: {
          id: true,
          codigoEmpleado: true,
          fechaConvocatoria: true,
          accion: true,
          cobradoDate: true,
        },
      });

      await tx.disciplinaryClosedCycle.delete({ where: { id: cycle.id } });

      return updated;
    });

    return ok({
      treatment: result,
      reopenedCycleId: cycle.id,
    });
  } catch (e) {
    return serverError(e instanceof Error ? e.message : "Error al reabrir ciclo", e);
  }
}
