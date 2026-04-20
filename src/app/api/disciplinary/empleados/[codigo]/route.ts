import { NextRequest } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, notFound } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { normalizeEmployeeCode } from "@/lib/business/disciplinary";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { codigo: codigoRaw } = await params;
  const codigo = normalizeEmployeeCode(decodeURIComponent(codigoRaw));
  if (!codigo) return notFound("Código de empleado vacío");

  const [apercibimientos, treatment] = await Promise.all([
    prisma.disciplinaryApercibimiento.findMany({
      where: { codigoEmpleado: codigo },
      orderBy: [{ fechaEmision: "desc" }, { numero: "desc" }],
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
        plantilla: true,
        planoOrigen: true,
        motivoAnulacion: true,
        contrato: true,
        cliente: true,
        clienteSetManual: true,
        rutaPdf: true,
        evidenciaAnulacion: true,
        omisiones: {
          orderBy: [{ fecha: "asc" }, { hora: "asc" }, { secuencia: "asc" }],
          select: { id: true, fecha: true, hora: true },
        },
      },
    }),
    prisma.disciplinaryTreatment.findUnique({
      where: { codigoEmpleado: codigo },
      include: {
        closedCycles: {
          orderBy: [{ cerradoEl: "desc" }],
        },
      },
    }),
  ]);

  if (apercibimientos.length === 0 && !treatment) {
    return notFound("No se encontró información para ese código");
  }

  // Estado actual: cuántos apercibimientos no anulados acumulados, fechas extremas, etc.
  const noAnulados = apercibimientos.filter((a) => a.estado !== "ANULADO");
  const totalNoAnulados = noAnulados.length;

  // El "umbral" del 3er apercibimiento: la primera vez (cronológica) que llegó a 3.
  let fechaTercer: Date | null = null;
  let admTercer: string | null = null;
  if (totalNoAnulados >= 3) {
    const ascending = [...noAnulados].sort(
      (a, b) => a.fechaEmision.getTime() - b.fechaEmision.getTime(),
    );
    fechaTercer = ascending[2].fechaEmision;
    admTercer = ascending[2].administrador ?? null;
  }

  const data = {
    codigoEmpleado: codigo,
    nombreEmpleado:
      treatment?.nombre ?? apercibimientos[0]?.nombreEmpleado ?? null,
    zona: treatment?.zona ?? apercibimientos[0]?.zona ?? null,
    apercibimientos: apercibimientos.map((a) => ({
      ...a,
      rutaPdf: undefined,
      evidenciaAnulacion: undefined,
      pdfDisponible: !!a.rutaPdf,
      evidenciaDisponible: !!a.evidenciaAnulacion,
    })),
    treatment: treatment
      ? {
          fechaConvocatoria: treatment.fechaConvocatoria,
          accion: treatment.accion,
          cobradoDate: treatment.cobradoDate,
          updatedAt: treatment.updatedAt,
        }
      : null,
    closedCycles: treatment?.closedCycles ?? [],
    resumen: {
      totalApercibimientos: apercibimientos.length,
      totalNoAnulados,
      fechaTercerApercibimiento: fechaTercer,
      administradorTercerApercibimiento: admTercer,
    },
  };

  return ok(data);
}
