import { NextRequest } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import type { Prisma, DisciplinaryStatus, DisciplinaryVigencia } from "@prisma/client";
import { normalizeEmployeeCode } from "@/lib/business/disciplinary";

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
