import { NextRequest } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, badRequest } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Reporte de omisiones de marca para un rango de fechas (sobre la FECHA DE LA OMISIÓN,
 * no la fecha de emisión del apercibimiento).
 *
 * **Semántica del periodo (cohorte):** `desde`/`hasta` definen QUÉ omisiones entran
 * en el análisis (fecha de cada marca omitida). Las métricas de seguimiento
 * (convocatoria, cobros, bajas, pendientes) se calculan sobre las **personas**
 * que tuvieron al menos una omisión en ese rango, pero **sin** exigir que la
 * fecha de convocatoria o de cierre del ciclo caiga dentro del mismo rango:
 * una omisión de enero puede haberse cobrado en marzo y debe contar para este
 * reporte cuando el filtro es enero.
 *
 * Querystring:
 *  - desde (YYYY-MM-DD) — inclusive  (obligatorio o por defecto 1er día del mes actual)
 *  - hasta (YYYY-MM-DD) — inclusive  (obligatorio o por defecto hoy)
 *  - administrador (string opcional, filtra apercibimientos del rango por admin)
 *  - zona (string opcional)
 *  - sucursal (string opcional)
 *
 * Devuelve:
 *  - periodo: { desde, hasta }
 *  - totales: métricas agregadas
 *  - porEmpleado: filas con detalle por empleado involucrado en el periodo
 */

function parseLocalDate(s: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function defaultDesde(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const desde = parseLocalDate(sp.get("desde")) ?? defaultDesde();
  const hastaRaw = parseLocalDate(sp.get("hasta")) ?? new Date();
  const hasta = endOfDay(hastaRaw);
  if (desde.getTime() > hasta.getTime()) {
    return badRequest("El rango de fechas es inválido");
  }
  const administrador = sp.get("administrador")?.trim() || undefined;
  const zona = sp.get("zona")?.trim() || undefined;
  const sucursal = sp.get("sucursal")?.trim() || undefined;
  const cliente = sp.get("cliente")?.trim() || undefined;
  const contrato = sp.get("contrato")?.trim() || undefined;

  // Filtro de apercibimiento para las omisiones que consumimos.
  const apWhere: Prisma.DisciplinaryApercibimientoWhereInput = {};
  if (administrador) apWhere.administrador = { contains: administrador, mode: "insensitive" };
  if (zona) apWhere.zona = { contains: zona, mode: "insensitive" };
  if (sucursal) apWhere.sucursal = { contains: sucursal, mode: "insensitive" };
  if (cliente) apWhere.cliente = { contains: cliente, mode: "insensitive" };
  if (contrato) apWhere.contrato = { contains: contrato, mode: "insensitive" };

  // ── 1) Omisiones del rango (con filtro por propiedades del apercibimiento padre).
  const omisiones = await prisma.disciplinaryOmission.findMany({
    where: {
      fecha: { gte: desde, lte: hasta },
      apercibimiento: Object.keys(apWhere).length > 0 ? apWhere : undefined,
    },
    select: {
      id: true,
      fecha: true,
      hora: true,
      apercibimiento: {
        select: {
          id: true,
          numero: true,
          estado: true,
          codigoEmpleado: true,
          nombreEmpleado: true,
          administrador: true,
          zona: true,
          sucursal: true,
          fechaEmision: true,
          motivoAnulacion: true,
          contrato: true,
          cliente: true,
        },
      },
    },
  });

  // Total de omisiones = items individuales (puede haber varias el mismo día por persona).
  const totalOmisiones = omisiones.length;
  // Días con omisión = fechas únicas globales del periodo (para el panel "por día").
  const diasUnicosGlobalSet = new Set<string>();
  for (const o of omisiones) {
    const ymd = `${o.fecha.getFullYear()}-${String(o.fecha.getMonth() + 1).padStart(2, "0")}-${String(o.fecha.getDate()).padStart(2, "0")}`;
    diasUnicosGlobalSet.add(ymd);
  }
  const diasConOmisionTotales = diasUnicosGlobalSet.size;

  // Apercibimientos únicos derivados (con conteo de omisiones del periodo por cada uno).
  /** Cada omisión del periodo expuesta al frontend, conservando hora si existe. */
  interface OmisionDetalle {
    fecha: Date;
    hora: string | null;
  }
  interface ApAgg {
    id: string;
    numero: string;
    estado: string;
    codigoEmpleado: string;
    nombreEmpleado: string;
    administrador: string | null;
    zona: string | null;
    sucursal: string | null;
    fechaEmision: Date;
    motivoAnulacion: string | null;
    contrato: string | null;
    cliente: string | null;
    omisionesEnPeriodo: number;
    /** Lista de omisiones del periodo con hora opcional. */
    omisionesDetalle: OmisionDetalle[];
  }
  const apercibimientosMap = new Map<string, ApAgg>();
  for (const o of omisiones) {
    const existing = apercibimientosMap.get(o.apercibimiento.id);
    const detalle: OmisionDetalle = { fecha: o.fecha, hora: o.hora };
    if (existing) {
      existing.omisionesEnPeriodo++;
      existing.omisionesDetalle.push(detalle);
    } else {
      apercibimientosMap.set(o.apercibimiento.id, {
        ...o.apercibimiento,
        omisionesEnPeriodo: 1,
        omisionesDetalle: [detalle],
      });
    }
  }
  // Ordenar por (fecha, hora) para una lectura estable.
  for (const ap of apercibimientosMap.values()) {
    ap.omisionesDetalle.sort((a, b) => {
      const dt = a.fecha.getTime() - b.fecha.getTime();
      if (dt !== 0) return dt;
      if (!a.hora && !b.hora) return 0;
      if (!a.hora) return -1;
      if (!b.hora) return 1;
      return a.hora.localeCompare(b.hora);
    });
  }
  const apercibimientos = Array.from(apercibimientosMap.values());

  const apercibimientosTotal = apercibimientos.length;
  const anuladosList = apercibimientos.filter((a) => a.estado === "ANULADO");
  const apercibimientosNoAnulados = apercibimientos.filter((a) => a.estado !== "ANULADO");
  const apercibimientosAnulados = anuladosList.length;

  // "Omisiones justificadas": las fechas de omisión del periodo cuyo apercibimiento
  // quedó ANULADO (p.ej. por justificación aprobada). Se restan del total efectivo.
  const omisionesJustificadas = omisiones.filter(
    (o) => o.apercibimiento.estado === "ANULADO",
  ).length;
  const omisionesEfectivas = totalOmisiones - omisionesJustificadas;

  // Empleados únicos involucrados en el periodo.
  const codigoSet = new Set<string>();
  for (const a of apercibimientos) codigoSet.add(a.codigoEmpleado);
  const codigos = Array.from(codigoSet);
  const personasInvolucradas = codigos.length;

  // ── 2) Por empleado: contar omisiones, apercibimientos, fecha primera/última omisión.
  interface EmpleadoAgg {
    codigoEmpleado: string;
    nombreEmpleado: string;
    zona: string | null;
    omisionesPeriodo: number;
    diasConOmisionPeriodo: number;
    omisionesJustificadas: number;
    apercibimientosPeriodo: number;
    apercibimientosPeriodoNoAnulados: number;
    apercibimientosAnulados: number;
    primeraOmision: Date;
    ultimaOmision: Date;
    /** set interno de días únicos para calcular `diasConOmisionPeriodo` al cierre. */
    _diasSet: Set<string>;
  }
  const porEmpleado = new Map<string, EmpleadoAgg>();
  for (const o of omisiones) {
    const codigo = o.apercibimiento.codigoEmpleado;
    const esJustif = o.apercibimiento.estado === "ANULADO";
    const ymd = `${o.fecha.getFullYear()}-${String(o.fecha.getMonth() + 1).padStart(2, "0")}-${String(o.fecha.getDate()).padStart(2, "0")}`;
    const acc = porEmpleado.get(codigo);
    if (acc) {
      acc.omisionesPeriodo++;
      acc._diasSet.add(ymd);
      if (esJustif) acc.omisionesJustificadas++;
      if (o.fecha.getTime() < acc.primeraOmision.getTime()) acc.primeraOmision = o.fecha;
      if (o.fecha.getTime() > acc.ultimaOmision.getTime()) acc.ultimaOmision = o.fecha;
    } else {
      porEmpleado.set(codigo, {
        codigoEmpleado: codigo,
        nombreEmpleado: o.apercibimiento.nombreEmpleado,
        zona: o.apercibimiento.zona,
        omisionesPeriodo: 1,
        diasConOmisionPeriodo: 0, // se calcula abajo
        omisionesJustificadas: esJustif ? 1 : 0,
        apercibimientosPeriodo: 0,
        apercibimientosPeriodoNoAnulados: 0,
        apercibimientosAnulados: 0,
        primeraOmision: o.fecha,
        ultimaOmision: o.fecha,
        _diasSet: new Set([ymd]),
      });
    }
  }
  for (const e of porEmpleado.values()) {
    e.diasConOmisionPeriodo = e._diasSet.size;
  }
  for (const a of apercibimientos) {
    const e = porEmpleado.get(a.codigoEmpleado);
    if (!e) continue;
    e.apercibimientosPeriodo++;
    if (a.estado === "ANULADO") {
      e.apercibimientosAnulados++;
    } else {
      e.apercibimientosPeriodoNoAnulados++;
    }
  }

  // ── 3) Datos globales por empleado del set (treatment + ciclos cerrados + conteo histórico)
  let treatments: Array<{
    codigoEmpleado: string;
    fechaConvocatoria: Date | null;
    accion: string | null;
    cobradoDate: Date | null;
    closedCycles: Array<{
      cerradoEl: Date | null;
      accion: string;
      monto: Prisma.Decimal | null;
      count: number | null;
    }>;
  }> = [];
  let historicoCounts = new Map<string, number>();

  if (codigos.length > 0) {
    const [treatmentsRes, historicoRaw] = await Promise.all([
      prisma.disciplinaryTreatment.findMany({
        where: { codigoEmpleado: { in: codigos } },
        select: {
          codigoEmpleado: true,
          fechaConvocatoria: true,
          accion: true,
          cobradoDate: true,
          closedCycles: {
            select: {
              cerradoEl: true,
              accion: true,
              monto: true,
              count: true,
            },
          },
        },
      }),
      prisma.disciplinaryApercibimiento.groupBy({
        by: ["codigoEmpleado"],
        where: {
          codigoEmpleado: { in: codigos },
          estado: { not: "ANULADO" },
        },
        _count: { _all: true },
      }),
    ]);
    treatments = treatmentsRes;
    historicoCounts = new Map(historicoRaw.map((r) => [r.codigoEmpleado, r._count._all]));
  }

  const treatmentByCodigo = new Map(treatments.map((t) => [t.codigoEmpleado, t]));

  // Personas con 3+ apercibimientos (histórico). Mostramos este KPI filtrado a los
  // empleados involucrados en el periodo.
  let personasCon3Plus = 0;
  for (const codigo of codigos) {
    if ((historicoCounts.get(codigo) ?? 0) >= 3) personasCon3Plus++;
  }

  // ── Seguimiento (cohorte): personas con omisión en [desde,hasta], evaluadas
  //    sin filtrar convocatoria/cierre por ese mismo rango de fechas.
  //
  // Convocados: empleados del cohorte con fecha de convocatoria registrada (cualquier fecha).
  // Cobrados / Bajas: conteo de **personas** con al menos un ciclo cerrado de ese tipo
  //    (cualquier `cerradoEl`). `montoCobrado` suma todos los montos de ciclos COBRADO
  //    del cohorte (histórico).
  // Pendientes: personas del cohorte sin ningún ciclo cerrado COBRADO ni DADO_DE_BAJA.
  let convocados = 0;
  let cobradosPersonas = 0;
  let bajasPersonas = 0;
  let montoCobrado = 0;

  // Por empleado: flags y métricas para drill-down (los nombres `*EnPeriodo` se
  // mantienen por compatibilidad con el frontend; la semántica es "respecto al cohorte").
  const flagsByCodigo = new Map<string, {
    convocadoEnPeriodo: boolean;
    cobradosEnPeriodo: number;
    montoCobradoEnPeriodo: number;
    bajasEnPeriodo: number;
    tieneCicloCobrado: boolean;
    tieneCicloBaja: boolean;
  }>();

  for (const codigo of codigos) {
    const flags = {
      convocadoEnPeriodo: false,
      cobradosEnPeriodo: 0,
      montoCobradoEnPeriodo: 0,
      bajasEnPeriodo: 0,
      tieneCicloCobrado: false,
      tieneCicloBaja: false,
    };
    const t = treatmentByCodigo.get(codigo);
    if (t) {
      if (t.fechaConvocatoria) {
        convocados++;
        flags.convocadoEnPeriodo = true;
      }
      for (const c of t.closedCycles) {
        if (!c.cerradoEl) continue;
        if (c.accion === "COBRADO") {
          flags.tieneCicloCobrado = true;
          flags.cobradosEnPeriodo++;
          if (c.monto) {
            montoCobrado += Number(c.monto);
            flags.montoCobradoEnPeriodo += Number(c.monto);
          }
        } else if (c.accion === "DADO_DE_BAJA") {
          flags.tieneCicloBaja = true;
          flags.bajasEnPeriodo++;
        }
      }
      if (flags.tieneCicloCobrado) cobradosPersonas++;
      if (flags.tieneCicloBaja) bajasPersonas++;
    }
    flagsByCodigo.set(codigo, flags);
  }

  let pendientes = 0;
  for (const codigo of codigos) {
    const f = flagsByCodigo.get(codigo);
    if (!f) continue;
    if (!f.tieneCicloCobrado && !f.tieneCicloBaja) pendientes++;
  }

  // ── 4) Estadísticas por día (para posibles gráficas).
  const porDiaMap = new Map<string, number>();
  for (const o of omisiones) {
    const ymd = `${o.fecha.getFullYear()}-${String(o.fecha.getMonth() + 1).padStart(2, "0")}-${String(o.fecha.getDate()).padStart(2, "0")}`;
    porDiaMap.set(ymd, (porDiaMap.get(ymd) ?? 0) + 1);
  }
  const porDia = Array.from(porDiaMap.entries())
    .map(([fecha, count]) => ({ fecha, count }))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));

  const porEmpleadoArr = Array.from(porEmpleado.values())
    .map((e) => {
      const historicoNoAnulados = historicoCounts.get(e.codigoEmpleado) ?? 0;
      const flags = flagsByCodigo.get(e.codigoEmpleado) ?? {
        convocadoEnPeriodo: false,
        cobradosEnPeriodo: 0,
        montoCobradoEnPeriodo: 0,
        bajasEnPeriodo: 0,
        tieneCicloCobrado: false,
        tieneCicloBaja: false,
      };
      const tieneResolucionCierre =
        flags.tieneCicloCobrado || flags.tieneCicloBaja;
      // Excluimos `_diasSet` del payload público (es solo de uso interno).
      const { _diasSet: _omit, ...publicE } = e;
      void _omit;
      return {
        ...publicE,
        apercibimientosHistoricosNoAnulados: historicoNoAnulados,
        tieneCon3Plus: historicoNoAnulados >= 3,
        convocadoEnPeriodo: flags.convocadoEnPeriodo,
        cobradosEnPeriodo: flags.cobradosEnPeriodo,
        montoCobradoEnPeriodo: flags.montoCobradoEnPeriodo,
        bajasEnPeriodo: flags.bajasEnPeriodo,
        tienePendiente: !tieneResolucionCierre,
        treatment: treatmentByCodigo.get(e.codigoEmpleado)
          ? {
              fechaConvocatoria: treatmentByCodigo.get(e.codigoEmpleado)!.fechaConvocatoria,
              accion: treatmentByCodigo.get(e.codigoEmpleado)!.accion,
              cobradoDate: treatmentByCodigo.get(e.codigoEmpleado)!.cobradoDate,
            }
          : null,
      };
    })
    .sort((a, b) => b.omisionesPeriodo - a.omisionesPeriodo);

  // Helper: cuenta días únicos a partir de una lista de Date.
  function uniqueDaysCount(fechas: Date[]): number {
    const s = new Set<string>();
    for (const f of fechas) {
      s.add(`${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`);
    }
    return s.size;
  }

  // Lista completa de apercibimientos del periodo (ordenados por fecha desc), para
  // drill-down desde los KPIs del frontend.
  const apercibimientosArr = apercibimientos
    .map((a) => ({
      id: a.id,
      numero: a.numero,
      estado: a.estado,
      codigoEmpleado: a.codigoEmpleado,
      nombreEmpleado: a.nombreEmpleado,
      administrador: a.administrador,
      zona: a.zona,
      sucursal: a.sucursal,
      fechaEmision: a.fechaEmision,
      motivoAnulacion: a.motivoAnulacion,
      contrato: a.contrato,
      cliente: a.cliente,
      omisionesEnPeriodo: a.omisionesEnPeriodo,
      diasConOmisionEnPeriodo: uniqueDaysCount(a.omisionesDetalle.map((d) => d.fecha)),
      omisionesDetalle: a.omisionesDetalle.map((d) => ({
        fecha: d.fecha.toISOString(),
        hora: d.hora,
      })),
    }))
    .sort((a, b) => b.fechaEmision.getTime() - a.fechaEmision.getTime());

  return ok({
    periodo: {
      desde: desde.toISOString(),
      hasta: hasta.toISOString(),
    },
    filtros: {
      administrador: administrador ?? null,
      zona: zona ?? null,
      sucursal: sucursal ?? null,
      cliente: cliente ?? null,
      contrato: contrato ?? null,
    },
    totales: {
      totalOmisiones,
      diasConOmisionTotales,
      omisionesJustificadas,
      omisionesEfectivas,
      personasInvolucradas,
      apercibimientosTotal,
      apercibimientosAnulados,
      apercibimientosNoAnulados: apercibimientosNoAnulados.length,
      personasCon3Plus,
      convocados,
      cobradosCount: cobradosPersonas,
      bajasCount: bajasPersonas,
      montoCobrado,
      pendientes,
    },
    porDia,
    porEmpleado: porEmpleadoArr,
    apercibimientos: apercibimientosArr,
    anulados: anuladosList
      .map((a) => ({
        id: a.id,
        numero: a.numero,
        fechaEmision: a.fechaEmision,
        codigoEmpleado: a.codigoEmpleado,
        nombreEmpleado: a.nombreEmpleado,
        administrador: a.administrador,
        zona: a.zona,
        contrato: a.contrato,
        cliente: a.cliente,
        motivoAnulacion: a.motivoAnulacion,
        omisionesEnPeriodo: a.omisionesEnPeriodo,
        diasConOmisionEnPeriodo: uniqueDaysCount(a.omisionesDetalle.map((d) => d.fecha)),
        omisionesDetalle: a.omisionesDetalle.map((d) => ({
          fecha: d.fecha.toISOString(),
          hora: d.hora,
        })),
      }))
      .sort((a, b) => b.fechaEmision.getTime() - a.fechaEmision.getTime()),
  });
}
