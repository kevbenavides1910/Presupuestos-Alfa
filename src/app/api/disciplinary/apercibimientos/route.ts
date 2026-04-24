import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/api/middleware";
import { canManageDisciplinary } from "@/lib/permissions";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  serverError,
} from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import type { Prisma, DisciplinaryStatus, DisciplinaryVigencia } from "@prisma/client";
import {
  calculateVigencia,
  normalizeEmployeeCode,
  normalizeLicitacion,
} from "@/lib/business/disciplinary";
import { allocateNextApercibimientoNumero } from "@/lib/server/disciplinary-settings";

const VALID_STATUS = new Set<DisciplinaryStatus>(["EMITIDO", "ENTREGADO", "FIRMADO", "ANULADO"]);
const VALID_VIGENCIA = new Set<DisciplinaryVigencia>([
  "VIGENTE",
  "VENCIDO",
  "PRESCRITO",
  "FINALIZADO",
  "ANULADO",
]);

function parseLocalDate(s: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function localMidnightYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const postApercibimientoSchema = z.object({
  codigoEmpleado: z.string().trim().min(1).max(80),
  nombreEmpleado: z.string().trim().min(2).max(240),
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  zona: z.string().trim().max(240).optional().nullable(),
  sucursal: z.string().trim().max(240).optional().nullable(),
  administrador: z.string().trim().max(240).optional().nullable(),
  contrato: z.string().trim().max(240).optional().nullable(),
  estado: z.enum(["EMITIDO", "ENTREGADO", "FIRMADO", "ANULADO"]).optional(),
  motivoAnulacion: z.string().trim().max(2000).optional().nullable(),
  omisiones: z
    .array(
      z.object({
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hora: z.string().trim().max(20).optional().nullable(),
        puntoOmitido: z.string().trim().max(500).optional().nullable(),
      }),
    )
    .min(1)
    .max(80),
});

async function resolveClientByLicitacionNorm(contratoNorm: string): Promise<string | null> {
  const candidates = await prisma.contract.findMany({
    where: { deletedAt: null },
    select: { licitacionNo: true, client: true },
  });
  for (const c of candidates) {
    if (normalizeLicitacion(c.licitacionNo) === contratoNorm) return c.client;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!canManageDisciplinary(session.user.role)) return forbidden();

  try {
    const parsed = postApercibimientoSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const estado = (parsed.data.estado ?? "EMITIDO") as DisciplinaryStatus;
    const motivo = parsed.data.motivoAnulacion?.trim() || null;
    if (estado === "ANULADO" && !motivo) {
      return badRequest("El motivo de anulación es obligatorio si el estado es Anulado");
    }

    const fechaEmision = localMidnightYmd(parsed.data.fechaEmision);
    const codigo = normalizeEmployeeCode(parsed.data.codigoEmpleado);
    if (!codigo) return badRequest("Código de empleado inválido");

    const contratoRaw = parsed.data.contrato?.trim() || null;
    const contratoNorm = normalizeLicitacion(contratoRaw);
    const cliente = contratoNorm ? await resolveClientByLicitacionNorm(contratoNorm) : null;
    const vigencia = calculateVigencia(fechaEmision, estado);
    const numero = await allocateNextApercibimientoNumero(fechaEmision);

    const sortedOm = [...parsed.data.omisiones].sort(
      (a, b) => localMidnightYmd(a.fecha).getTime() - localMidnightYmd(b.fecha).getTime(),
    );

    const created = await prisma.$transaction(async (tx) => {
      const a = await tx.disciplinaryApercibimiento.create({
        data: {
          numero,
          fechaEmision,
          codigoEmpleado: codigo,
          codigoEmpleadoRaw: parsed.data.codigoEmpleado.trim(),
          nombreEmpleado: parsed.data.nombreEmpleado.trim(),
          zona: parsed.data.zona?.trim() || null,
          sucursal: parsed.data.sucursal?.trim() || null,
          administrador: parsed.data.administrador?.trim() || null,
          cantidadOmisiones: sortedOm.length,
          estado,
          vigencia,
          motivoAnulacion: estado === "ANULADO" ? motivo : null,
          contrato: contratoRaw,
          contratoNormalizado: contratoNorm,
          cliente,
          clienteSetManual: false,
          planoOrigen: "manual_web",
        },
        select: { id: true, numero: true },
      });
      await tx.disciplinaryOmission.createMany({
        data: sortedOm.map((o, idx) => ({
          apercibimientoId: a.id,
          fecha: localMidnightYmd(o.fecha),
          hora: o.hora?.trim() || null,
          puntoOmitido: o.puntoOmitido?.trim() || null,
          secuencia: idx,
        })),
      });
      return a;
    });

    return ok(created);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al crear apercibimiento";
    if (msg.includes("Unique constraint") || msg.includes("unique constraint")) {
      return badRequest("Ya existe un apercibimiento con ese número; reintente.");
    }
    return serverError(msg, e);
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const desde = parseLocalDate(sp.get("desde"));
  const hasta = parseLocalDate(sp.get("hasta"));
  const zona = sp.get("zona")?.trim() || undefined;
  const sucursal = sp.get("sucursal")?.trim() || undefined;
  const administrador = sp.get("administrador")?.trim() || undefined;
  const estado = (sp.get("estado") || "").toUpperCase();
  const vigencia = (sp.get("vigencia") || "").toUpperCase();
  const codigoQuery = sp.get("codigo")?.trim();
  const nombreQuery = sp.get("nombre")?.trim();
  const numero = sp.get("numero")?.trim();
  const contratoQuery = sp.get("contrato")?.trim();
  const clienteQuery = sp.get("cliente")?.trim();
  const limit = Math.min(Math.max(parseInt(sp.get("limit") || "100", 10) || 100, 1), 500);
  const page = Math.max(parseInt(sp.get("page") || "1", 10) || 1, 1);
  const skip = (page - 1) * limit;

  const where: Prisma.DisciplinaryApercibimientoWhereInput = {};
  if (desde || hasta) {
    where.fechaEmision = {};
    if (desde) where.fechaEmision.gte = desde;
    if (hasta) {
      const end = new Date(hasta);
      end.setHours(23, 59, 59, 999);
      where.fechaEmision.lte = end;
    }
  }
  if (zona) where.zona = { contains: zona, mode: "insensitive" };
  if (sucursal) where.sucursal = { contains: sucursal, mode: "insensitive" };
  if (administrador) where.administrador = { contains: administrador, mode: "insensitive" };
  if (estado && VALID_STATUS.has(estado as DisciplinaryStatus)) {
    where.estado = estado as DisciplinaryStatus;
  }
  if (vigencia && VALID_VIGENCIA.has(vigencia as DisciplinaryVigencia)) {
    where.vigencia = vigencia as DisciplinaryVigencia;
  }
  if (codigoQuery) {
    where.codigoEmpleado = normalizeEmployeeCode(codigoQuery);
  }
  if (nombreQuery) {
    where.nombreEmpleado = { contains: nombreQuery, mode: "insensitive" };
  }
  if (numero) {
    where.numero = { contains: numero, mode: "insensitive" };
  }
  if (contratoQuery) {
    where.contrato = { contains: contratoQuery, mode: "insensitive" };
  }
  if (clienteQuery) {
    where.cliente = { contains: clienteQuery, mode: "insensitive" };
  }

  const [total, rows] = await Promise.all([
    prisma.disciplinaryApercibimiento.count({ where }),
    prisma.disciplinaryApercibimiento.findMany({
      where,
      orderBy: [{ fechaEmision: "desc" }, { numero: "desc" }],
      skip,
      take: limit,
      // Excluimos campos sensibles: correoEnviadoA, rutaPdf, evidenciaAnulacion.
      select: {
        id: true,
        numero: true,
        fechaEmision: true,
        codigoEmpleado: true,
        nombreEmpleado: true,
        zona: true,
        sucursal: true,
        cantidadOmisiones: true,
        administrador: true,
        estado: true,
        vigencia: true,
        batchExterno: true,
        plantilla: true,
        planoOrigen: true,
        motivoAnulacion: true,
        contrato: true,
        cliente: true,
        clienteSetManual: true,
        // Booleanos para indicar disponibilidad sin exponer la ruta interna
        rutaPdf: true,
        evidenciaAnulacion: true,
        _count: {
          select: { omisiones: true },
        },
        omisiones: {
          orderBy: [{ fecha: "asc" }, { hora: "asc" }, { secuencia: "asc" }],
          select: { id: true, fecha: true, hora: true },
        },
      },
    }),
  ]);

  // Reemplazamos los campos sensibles por flags de disponibilidad.
  const data = rows.map((r) => ({
    ...r,
    rutaPdf: undefined,
    evidenciaAnulacion: undefined,
    pdfDisponible: !!r.rutaPdf,
    evidenciaDisponible: !!r.evidenciaAnulacion,
  }));

  return ok(data, { total, page, limit });
}
