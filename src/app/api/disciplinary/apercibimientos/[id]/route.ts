import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/api/middleware";
import { canManageDisciplinary } from "@/lib/permissions";
import { ok, unauthorized, forbidden, badRequest, notFound, serverError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { calculateVigencia, normalizeLicitacion } from "@/lib/business/disciplinary";
import type { DisciplinaryStatus, Prisma } from "@prisma/client";

const STATUS_VALUES = ["EMITIDO", "ENTREGADO", "FIRMADO", "ANULADO"] as const;

/**
 * PATCH para apercibimientos. Acepta cualquier subconjunto de:
 * - estado + motivoAnulacion (recalcula vigencia).
 * - contrato (texto libre): se normaliza y se intenta resolver el cliente automáticamente.
 *     - Si no se envía cliente explícito, el cliente se reasigna al del contrato (o null).
 *     - clienteSetManual queda en false.
 * - cliente (texto libre, override manual): marca clienteSetManual=true.
 *     - Si se envía null/"", se limpia y se vuelve a calcular desde el contrato actual.
 *
 * Notas:
 * - Pasar cliente=null + autoResolveCliente=true (default cuando no se manda cliente)
 *   re-aplica el matching contra Contract.licitacionNo.
 */
const PatchSchema = z
  .object({
    estado: z.enum(STATUS_VALUES).optional(),
    motivoAnulacion: z.string().trim().max(2000).optional().nullable(),
    contrato: z.string().trim().max(200).optional().nullable(),
    cliente: z.string().trim().max(300).optional().nullable(),
  })
  .refine(
    (v) =>
      v.estado !== undefined ||
      v.motivoAnulacion !== undefined ||
      v.contrato !== undefined ||
      v.cliente !== undefined,
    { message: "Debe enviar al menos un campo a actualizar" },
  );

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageDisciplinary(session.user.role)) return forbidden();

  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Datos inválidos", parsed.error.flatten());
    }

    const existing = await prisma.disciplinaryApercibimiento.findUnique({
      where: { id },
      select: {
        id: true,
        fechaEmision: true,
        estado: true,
        contrato: true,
        contratoNormalizado: true,
        cliente: true,
        clienteSetManual: true,
      },
    });
    if (!existing) return notFound("Apercibimiento no encontrado");

    const data: Prisma.DisciplinaryApercibimientoUpdateInput = {};

    // ── Estado / vigencia ──────────────────────────────────────────────
    if (parsed.data.estado !== undefined) {
      const newEstado = parsed.data.estado as DisciplinaryStatus;
      const motivo = parsed.data.motivoAnulacion?.trim() || null;
      if (newEstado === "ANULADO" && !motivo) {
        return badRequest("El motivo de anulación es obligatorio para anular un apercibimiento");
      }
      data.estado = newEstado;
      data.vigencia = calculateVigencia(existing.fechaEmision, newEstado);
      data.motivoAnulacion = newEstado === "ANULADO" ? motivo : null;
    }

    // ── Contrato (texto). Si cambia, intenta resolver cliente desde Contracts.
    let contratoCambiado = false;
    let nuevoContratoNorm: string | null = existing.contratoNormalizado;
    if (parsed.data.contrato !== undefined) {
      const contratoTexto = parsed.data.contrato?.trim() || null;
      const contratoNorm = normalizeLicitacion(contratoTexto);
      data.contrato = contratoTexto;
      data.contratoNormalizado = contratoNorm;
      nuevoContratoNorm = contratoNorm;
      contratoCambiado = contratoNorm !== existing.contratoNormalizado;
    }

    // ── Cliente
    if (parsed.data.cliente !== undefined) {
      const clienteTexto = parsed.data.cliente?.trim() || null;
      if (clienteTexto) {
        // Override manual.
        data.cliente = clienteTexto;
        data.clienteSetManual = true;
      } else {
        // Limpieza: vuelve a auto-resolver desde el contrato.
        const auto = nuevoContratoNorm ? await resolveClientByLicitacion(nuevoContratoNorm) : null;
        data.cliente = auto;
        data.clienteSetManual = false;
      }
    } else if (contratoCambiado && !existing.clienteSetManual) {
      // Cambió el contrato y el cliente no está bloqueado por edición manual:
      // re-resolver automáticamente.
      const auto = nuevoContratoNorm ? await resolveClientByLicitacion(nuevoContratoNorm) : null;
      data.cliente = auto;
    }

    const updated = await prisma.disciplinaryApercibimiento.update({
      where: { id },
      data,
      select: {
        id: true,
        numero: true,
        estado: true,
        vigencia: true,
        motivoAnulacion: true,
        contrato: true,
        contratoNormalizado: true,
        cliente: true,
        clienteSetManual: true,
        updatedAt: true,
      },
    });

    return ok(updated);
  } catch (e) {
    return serverError(
      e instanceof Error ? e.message : "Error al actualizar apercibimiento",
      e,
    );
  }
}

async function resolveClientByLicitacion(contratoNorm: string): Promise<string | null> {
  // Las licitaciones se guardan tal cual; comparamos normalizadas en memoria sobre un set acotado.
  const candidates = await prisma.contract.findMany({
    where: { deletedAt: null },
    select: { licitacionNo: true, client: true },
  });
  for (const c of candidates) {
    if (normalizeLicitacion(c.licitacionNo) === contratoNorm) return c.client;
  }
  return null;
}
