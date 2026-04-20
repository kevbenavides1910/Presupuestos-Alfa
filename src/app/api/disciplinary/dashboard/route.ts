import { NextRequest } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import type { Prisma, DisciplinaryStatus } from "@prisma/client";

function parseLocalDate(s: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

interface ThirdApercibimientoRow {
  codigoEmpleado: string;
  nombreEmpleado: string;
  fechaTercero: Date;
  administrador: string | null;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const desde = parseLocalDate(sp.get("desde"));
  const hasta = parseLocalDate(sp.get("hasta"));
  const administrador = sp.get("administrador")?.trim() || undefined;

  const endHasta = hasta
    ? new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate(), 23, 59, 59, 999)
    : undefined;

  // ── 1) Apercibimientos del rango (con filtro opcional de admin)
  const whereAp: Prisma.DisciplinaryApercibimientoWhereInput = {};
  if (desde || endHasta) {
    whereAp.fechaEmision = {};
    if (desde) whereAp.fechaEmision.gte = desde;
    if (endHasta) whereAp.fechaEmision.lte = endHasta;
  }
  if (administrador) {
    whereAp.administrador = { contains: administrador, mode: "insensitive" };
  }

  const totalRango = await prisma.disciplinaryApercibimiento.count({ where: whereAp });

  const porEstadoAgg = await prisma.disciplinaryApercibimiento.groupBy({
    where: whereAp,
    by: ["estado"],
    _count: { _all: true },
  });
  const porEstado = porEstadoAgg.reduce<Record<DisciplinaryStatus, number>>(
    (acc, r) => {
      acc[r.estado] = r._count._all;
      return acc;
    },
    { EMITIDO: 0, ENTREGADO: 0, FIRMADO: 0, ANULADO: 0 },
  );

  const porAdministradorAgg = await prisma.disciplinaryApercibimiento.groupBy({
    where: whereAp,
    by: ["administrador"],
    _count: { _all: true },
    orderBy: { _count: { administrador: "desc" } },
  });
  const porAdministrador = porAdministradorAgg.map((r) => ({
    administrador: r.administrador ?? "(Sin administrador)",
    total: r._count._all,
  }));

  // ── 2) Cobrado y bajas: closed_cycles cuyo cerrado_el cae en el rango.
  const whereCycle: Prisma.DisciplinaryClosedCycleWhereInput = {};
  if (desde || endHasta) {
    whereCycle.cerradoEl = {};
    if (desde) (whereCycle.cerradoEl as Prisma.DateTimeFilter).gte = desde;
    if (endHasta) (whereCycle.cerradoEl as Prisma.DateTimeFilter).lte = endHasta;
  }

  const [cobradosAgg, bajasCount] = await Promise.all([
    prisma.disciplinaryClosedCycle.aggregate({
      where: { ...whereCycle, accion: "COBRADO" },
      _sum: { monto: true },
      _count: { _all: true },
    }),
    prisma.disciplinaryClosedCycle.count({
      where: { ...whereCycle, accion: "DADO_DE_BAJA" },
    }),
  ]);
  const totalCobrado = Number(cobradosAgg._sum.monto ?? 0);
  const totalCobradosCount = cobradosAgg._count._all;

  // ── 3) Oficiales que llegan al 3.er apercibimiento dentro del rango.
  // Ordenamos todo el historial no anulado por empleado y fecha; la primera fecha en
  // que el acumulado llega a 3 debe caer en [desde, endHasta]; aplicamos filtro admin.
  const allNotAnulado = await prisma.disciplinaryApercibimiento.findMany({
    where: { estado: { not: "ANULADO" } },
    orderBy: [{ codigoEmpleado: "asc" }, { fechaEmision: "asc" }],
    select: {
      codigoEmpleado: true,
      nombreEmpleado: true,
      fechaEmision: true,
      administrador: true,
    },
  });

  const terceros: ThirdApercibimientoRow[] = [];
  let currentCode: string | null = null;
  let countSoFar = 0;
  for (const row of allNotAnulado) {
    if (row.codigoEmpleado !== currentCode) {
      currentCode = row.codigoEmpleado;
      countSoFar = 0;
    }
    countSoFar++;
    if (countSoFar === 3) {
      const inRange =
        (!desde || row.fechaEmision >= desde) &&
        (!endHasta || row.fechaEmision <= endHasta);
      const matchesAdmin =
        !administrador ||
        (row.administrador?.toLowerCase().includes(administrador.toLowerCase()) ?? false);
      if (inRange && matchesAdmin) {
        terceros.push({
          codigoEmpleado: row.codigoEmpleado,
          nombreEmpleado: row.nombreEmpleado,
          fechaTercero: row.fechaEmision,
          administrador: row.administrador,
        });
      }
    }
  }

  return ok({
    rango: {
      desde: desde?.toISOString() ?? null,
      hasta: endHasta?.toISOString() ?? null,
      administrador: administrador ?? null,
    },
    totales: {
      apercibimientos: totalRango,
      cobradosCount: totalCobradosCount,
      cobradosMonto: totalCobrado,
      bajas: bajasCount,
      tercerosUmbral: terceros.length,
    },
    porEstado,
    porAdministrador,
    terceros,
  });
}
