"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileSpreadsheet,
  AlertTriangle,
  DollarSign,
  UserMinus,
  Users,
  ClipboardList,
  CalendarDays,
  UserCheck,
  ShieldCheck,
  Ban,
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { exportRowsToExcel } from "@/lib/utils/excel-export";
import { formatCurrency, formatDate } from "@/lib/utils/format";

interface OmisionesResponse {
  data: {
    periodo: { desde: string; hasta: string };
    filtros: {
      administrador: string | null;
      zona: string | null;
      sucursal: string | null;
      cliente: string | null;
      contrato: string | null;
    };
    totales: {
      totalOmisiones: number;
      diasConOmisionTotales: number;
      omisionesJustificadas: number;
      omisionesEfectivas: number;
      personasInvolucradas: number;
      apercibimientosTotal: number;
      apercibimientosAnulados: number;
      apercibimientosNoAnulados: number;
      personasCon3Plus: number;
      convocados: number;
      cobradosCount: number;
      bajasCount: number;
      montoCobrado: number;
      /** Personas del cohorte sin ciclo cerrado COBRADO ni DADO_DE_BAJA */
      pendientes: number;
    };
    porDia: { fecha: string; count: number }[];
    porEmpleado: EmpleadoRow[];
    apercibimientos: ApercibimientoRow[];
    anulados: AnuladoRow[];
  };
}

interface EmpleadoRow {
  codigoEmpleado: string;
  nombreEmpleado: string;
  zona: string | null;
  omisionesPeriodo: number;
  diasConOmisionPeriodo: number;
  omisionesJustificadas: number;
  apercibimientosPeriodo: number;
  apercibimientosPeriodoNoAnulados: number;
  apercibimientosAnulados: number;
  apercibimientosHistoricosNoAnulados: number;
  primeraOmision: string;
  ultimaOmision: string;
  tieneCon3Plus: boolean;
  convocadoEnPeriodo: boolean;
  cobradosEnPeriodo: number;
  montoCobradoEnPeriodo: number;
  bajasEnPeriodo: number;
  tienePendiente: boolean;
  treatment: {
    fechaConvocatoria: string | null;
    accion: string | null;
    cobradoDate: string | null;
  } | null;
}

interface ApercibimientoRow {
  id: string;
  numero: string;
  estado: string;
  codigoEmpleado: string;
  nombreEmpleado: string;
  administrador: string | null;
  zona: string | null;
  sucursal: string | null;
  fechaEmision: string;
  motivoAnulacion: string | null;
  contrato: string | null;
  cliente: string | null;
  omisionesEnPeriodo: number;
  diasConOmisionEnPeriodo: number;
  omisionesDetalle: { fecha: string; hora: string | null }[];
}

interface AnuladoRow {
  id: string;
  numero: string;
  fechaEmision: string;
  codigoEmpleado: string;
  nombreEmpleado: string;
  administrador: string | null;
  zona: string | null;
  contrato: string | null;
  cliente: string | null;
  motivoAnulacion: string | null;
  omisionesEnPeriodo: number;
  diasConOmisionEnPeriodo: number;
  omisionesDetalle: { fecha: string; hora: string | null }[];
}

type DrillKey =
  | "omisiones"
  | "justificadas"
  | "personas"
  | "vigentes"
  | "anulados"
  | "tresplus"
  | "convocados"
  | "cobrados"
  | "bajas"
  | "pendientes";

const ACCION_LABEL: Record<string, string> = {
  Cobrado: "Cobrado",
  cobrado: "Cobrado",
  "Dado de baja": "Dado de baja",
  "dado de baja": "Dado de baja",
};

/** Formatea una omisión como "dd/mm/yyyy HH:mm" (o solo fecha si no hay hora). */
function formatOmision(o: { fecha: string; hora: string | null }): string {
  return o.hora ? `${formatDate(o.fecha)} ${o.hora}` : formatDate(o.fecha);
}

export default function DisciplinarioReportOmisionesPage() {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const todayIso = today.toISOString().slice(0, 10);

  const [filters, setFilters] = useState({
    desde: firstOfMonth,
    hasta: todayIso,
    administrador: "",
    zona: "",
    sucursal: "",
    cliente: "",
    contrato: "",
  });

  const [drill, setDrill] = useState<DrillKey | null>(null);

  const queryParams = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("desde", filters.desde);
    sp.set("hasta", filters.hasta);
    if (filters.administrador.trim()) sp.set("administrador", filters.administrador.trim());
    if (filters.zona.trim()) sp.set("zona", filters.zona.trim());
    if (filters.sucursal.trim()) sp.set("sucursal", filters.sucursal.trim());
    if (filters.cliente.trim()) sp.set("cliente", filters.cliente.trim());
    if (filters.contrato.trim()) sp.set("contrato", filters.contrato.trim());
    return sp.toString();
  }, [filters]);

  const { data, isLoading, error } = useQuery<OmisionesResponse>({
    queryKey: ["disciplinary-omisiones-report", queryParams],
    queryFn: () =>
      fetch(`/api/disciplinary/reports/omisiones?${queryParams}`).then((r) => r.json()),
  });

  const totals = data?.data.totales;
  const porEmpleado = data?.data.porEmpleado ?? [];

  function exportarEmpleados() {
    if (porEmpleado.length === 0) return;
    const rows = porEmpleado.map((e) => ({
      Código: e.codigoEmpleado,
      Nombre: e.nombreEmpleado,
      Zona: e.zona ?? "",
      "Omisiones (ítems)": e.omisionesPeriodo,
      "Días con omisión": e.diasConOmisionPeriodo,
      "Omisiones justificadas": e.omisionesJustificadas,
      "Apercibimientos vigentes": e.apercibimientosPeriodoNoAnulados,
      "Apercibimientos anulados": e.apercibimientosAnulados,
      "Apercibimientos vigentes (hist.)": e.apercibimientosHistoricosNoAnulados,
      "Primera omisión": formatDate(e.primeraOmision),
      "Última omisión": formatDate(e.ultimaOmision),
      "Fecha convocatoria": e.treatment?.fechaConvocatoria ? formatDate(e.treatment.fechaConvocatoria) : "",
      Acción: e.treatment?.accion ?? "",
      "Fecha cobrado": e.treatment?.cobradoDate ? formatDate(e.treatment.cobradoDate) : "",
    }));
    exportRowsToExcel({
      filename: `omisiones_${filters.desde}_a_${filters.hasta}`,
      sheetName: "Omisiones",
      rows,
      columnWidths: [14, 28, 16, 12, 12, 14, 14, 14, 16, 14, 14, 16, 18, 14],
    });
  }

  function exportarAnulados() {
    const anulados = data?.data.anulados ?? [];
    if (anulados.length === 0) return;
    exportRowsToExcel({
      filename: `anulados_${filters.desde}_a_${filters.hasta}`,
      sheetName: "Anulados",
      rows: anulados.map((a) => ({
        "N° Apercibimiento": a.numero,
        "Fecha Emisión": formatDate(a.fechaEmision),
        Código: a.codigoEmpleado,
        Empleado: a.nombreEmpleado,
        Zona: a.zona ?? "",
        Administrador: a.administrador ?? "",
        "Omisiones (ítems)": a.omisionesEnPeriodo,
        "Días con omisión": a.diasConOmisionEnPeriodo,
        "Fechas de omisión": (a.omisionesDetalle ?? []).map(formatOmision).join(", "),
        "Motivo anulación / justificación": a.motivoAnulacion ?? "",
      })),
      columnWidths: [22, 14, 14, 28, 16, 22, 14, 12, 40, 40],
    });
  }

  function exportarPorDia() {
    const porDia = data?.data.porDia ?? [];
    if (porDia.length === 0) return;
    exportRowsToExcel({
      filename: `omisiones_por_dia_${filters.desde}_a_${filters.hasta}`,
      sheetName: "Por día",
      rows: porDia.map((d) => ({ Fecha: formatDate(d.fecha), Omisiones: d.count })),
      columnWidths: [14, 12],
    });
  }

  return (
    <>
      <Topbar title="Disciplinario" />
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href="/disciplinario"
              className="inline-flex items-center text-sm text-slate-600 hover:text-blue-600 gap-1 mb-1"
            >
              <ArrowLeft className="h-4 w-4" /> Volver al listado
            </Link>
            <h1 className="text-2xl font-semibold text-slate-800 flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-amber-500" />
              Reporte de omisiones
            </h1>
            <p className="text-sm text-slate-500">
              Parte de las fechas de omisión de marca (no de la fecha de emisión del apercibimiento).
              Los filtros de fecha definen la cohorte por día de omisión; convocatorias, cobros y bajas se
              muestran respecto de esas personas aunque el cierre haya sido en otra fecha.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/disciplinario/empleados">
              <Button variant="outline" size="sm" className="gap-2">
                <Users className="h-4 w-4" /> Resumen por empleado
              </Button>
            </Link>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={porEmpleado.length === 0}
              onClick={exportarEmpleados}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Exportar empleados
            </Button>
          </div>
        </div>

        {/* Filtros */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-slate-600 block mb-1">Desde (fecha omisión)</label>
                <Input
                  type="date"
                  value={filters.desde}
                  onChange={(e) => setFilters({ ...filters, desde: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Hasta (fecha omisión)</label>
                <Input
                  type="date"
                  value={filters.hasta}
                  onChange={(e) => setFilters({ ...filters, hasta: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Cliente</label>
                <Input
                  placeholder="Contiene…"
                  value={filters.cliente}
                  onChange={(e) => setFilters({ ...filters, cliente: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Contrato (licitación)</label>
                <Input
                  placeholder="Contiene…"
                  value={filters.contrato}
                  onChange={(e) => setFilters({ ...filters, contrato: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Administrador</label>
                <Input
                  placeholder="Contiene…"
                  value={filters.administrador}
                  onChange={(e) => setFilters({ ...filters, administrador: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Zona</label>
                <Input
                  placeholder="Contiene…"
                  value={filters.zona}
                  onChange={(e) => setFilters({ ...filters, zona: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Sucursal</label>
                <Input
                  placeholder="Contiene…"
                  value={filters.sucursal}
                  onChange={(e) => setFilters({ ...filters, sucursal: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading && <div className="text-slate-400">Cargando…</div>}
        {error && <div className="text-rose-600">No se pudo cargar el reporte.</div>}

        {totals && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <KpiCard
                icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
                label="Omisiones totales"
                value={totals.totalOmisiones.toLocaleString()}
                hint={`Cuenta cada omisión individual (varias el mismo día cuentan por separado) · Días distintos con omisión: ${totals.diasConOmisionTotales.toLocaleString()} · Efectivas: ${totals.omisionesEfectivas.toLocaleString()} · Justificadas: ${totals.omisionesJustificadas.toLocaleString()}`}
                onClick={() => setDrill("omisiones")}
              />
              <KpiCard
                icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />}
                label="Omisiones justificadas"
                value={totals.omisionesJustificadas.toLocaleString()}
                hint="Fechas de omisión cuyo apercibimiento quedó anulado (justificación aprobada)"
                onClick={() => setDrill("justificadas")}
              />
              <KpiCard
                icon={<Users className="h-5 w-5 text-blue-500" />}
                label="Personas involucradas"
                value={totals.personasInvolucradas.toLocaleString()}
                hint="Empleados únicos con al menos una omisión en el periodo"
                onClick={() => setDrill("personas")}
              />
              <KpiCard
                icon={<ClipboardList className="h-5 w-5 text-indigo-500" />}
                label="Apercibimientos vigentes"
                value={totals.apercibimientosNoAnulados.toLocaleString()}
                hint={`${totals.apercibimientosTotal} en total en el periodo`}
                onClick={() => setDrill("vigentes")}
              />
              <KpiCard
                icon={<Ban className="h-5 w-5 text-rose-500" />}
                label="Anulados / Justificados"
                value={totals.apercibimientosAnulados.toLocaleString()}
                hint="Apercibimientos anulados en el periodo (por justificación u otro motivo)"
                onClick={() => setDrill("anulados")}
              />
              <KpiCard
                icon={<AlertTriangle className="h-5 w-5 text-rose-500" />}
                label="3+ apercibimientos"
                value={totals.personasCon3Plus.toLocaleString()}
                hint="Personas del periodo con 3 o más apercibimientos vigentes (histórico)"
                onClick={() => setDrill("tresplus")}
              />
              <KpiCard
                icon={<CalendarDays className="h-5 w-5 text-fuchsia-500" />}
                label="Convocados"
                value={totals.convocados.toLocaleString()}
                hint="Personas del cohorte con fecha de convocatoria registrada (cualquier fecha)"
                onClick={() => setDrill("convocados")}
              />
              <KpiCard
                icon={<DollarSign className="h-5 w-5 text-emerald-600" />}
                label="Cobrados"
                value={totals.cobradosCount.toLocaleString()}
                hint={`Personas con al menos un cobro cerrado (cualquier fecha) · ${formatCurrency(totals.montoCobrado)} total en esos ciclos`}
                valueRight={formatCurrency(totals.montoCobrado)}
                onClick={() => setDrill("cobrados")}
              />
              <KpiCard
                icon={<UserMinus className="h-5 w-5 text-rose-600" />}
                label="Bajas"
                value={totals.bajasCount.toLocaleString()}
                hint="Personas del cohorte con al menos una baja cerrada (cualquier fecha)"
                onClick={() => setDrill("bajas")}
              />
              <KpiCard
                icon={<UserCheck className="h-5 w-5 text-slate-500" />}
                label="Pendientes"
                value={totals.pendientes.toLocaleString()}
                hint="Personas del cohorte sin cobro ni baja cerrados en el historial"
                onClick={() => setDrill("pendientes")}
              />
            </div>

            {/* Por día */}
            {data?.data.porDia && data.data.porDia.length > 0 && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Omisiones por día</CardTitle>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Cantidad de omisiones individuales registradas cada día
                      (puede haber más de una por persona).
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={exportarPorDia}>
                    <FileSpreadsheet className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent>
                  <PorDiaBars rows={data.data.porDia} />
                </CardContent>
              </Card>
            )}

            {/* Anulados / Justificados */}
            {data?.data.anulados && data.data.anulados.length > 0 && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Ban className="h-4 w-4 text-rose-500" />
                    Apercibimientos anulados / justificados
                    <span className="text-xs font-normal text-slate-500">
                      ({data.data.anulados.length})
                    </span>
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={exportarAnulados}>
                    <FileSpreadsheet className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left">N°</th>
                          <th className="px-3 py-2 text-left">Fecha emisión</th>
                          <th className="px-3 py-2 text-left">Empleado</th>
                          <th className="px-3 py-2 text-left">Zona</th>
                          <th className="px-3 py-2 text-left">Administrador</th>
                          <th className="px-3 py-2 text-center">Omisiones en periodo</th>
                          <th className="px-3 py-2 text-left">Fechas de omisión</th>
                          <th className="px-3 py-2 text-left">Motivo</th>
                          <th className="px-3 py-2 text-right" />
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {data.data.anulados.map((a) => (
                          <tr key={a.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono text-xs">{a.numero}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">
                              {formatDate(a.fechaEmision)}
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{a.nombreEmpleado}</div>
                              <div className="text-xs text-slate-500 font-mono">
                                {a.codigoEmpleado}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-600">{a.zona ?? "—"}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">
                              {a.administrador ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-center">{a.omisionesEnPeriodo}</td>
                            <td className="px-3 py-2 text-xs text-slate-600 max-w-xs">
                              {a.omisionesDetalle && a.omisionesDetalle.length > 0 ? (
                                <span className="inline-flex flex-wrap gap-1">
                                  {a.omisionesDetalle.map((o, i) => (
                                    <span
                                      key={i}
                                      className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700"
                                      title={o.hora ? `${formatDate(o.fecha)} a las ${o.hora}` : formatDate(o.fecha)}
                                    >
                                      {formatDate(o.fecha)}
                                      {o.hora && (
                                        <span className="ml-1 font-medium">{o.hora}</span>
                                      )}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-rose-700 max-w-md">
                              {a.motivoAnulacion || (
                                <span className="text-slate-400 italic">sin motivo registrado</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Link
                                href={`/disciplinario/empleados/${encodeURIComponent(a.codigoEmpleado)}`}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Ver
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Detalle por empleado */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Detalle por empleado</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {porEmpleado.length === 0 ? (
                  <div className="p-10 text-center text-slate-400">
                    No hay omisiones en el periodo con esos filtros.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Código</th>
                          <th className="px-3 py-2 text-left">Empleado</th>
                          <th className="px-3 py-2 text-left">Zona</th>
                          <th className="px-3 py-2 text-center">
                            <span title="Cantidad de omisiones individuales (puede haber varias el mismo día)">
                              Omisiones
                            </span>
                          </th>
                          <th className="px-3 py-2 text-center">
                            <span title="Cantidad de días distintos con al menos una omisión">
                              Días
                            </span>
                          </th>
                          <th className="px-3 py-2 text-center">
                            <span title="Omisiones cuyo apercibimiento quedó anulado/justificado">
                              Justif.
                            </span>
                          </th>
                          <th className="px-3 py-2 text-center">Apercibimientos</th>
                          <th className="px-3 py-2 text-center">
                            <span title="Apercibimientos anulados en el periodo">
                              Anulados
                            </span>
                          </th>
                          <th className="px-3 py-2 text-center">
                            <span title="Apercibimientos vigentes históricos no anulados">
                              Vigentes (hist.)
                            </span>
                          </th>
                          <th className="px-3 py-2 text-left">Primera / última omisión</th>
                          <th className="px-3 py-2 text-left">Convocatoria</th>
                          <th className="px-3 py-2 text-left">Acción</th>
                          <th className="px-3 py-2 text-right" />
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {porEmpleado.map((e) => (
                          <tr key={e.codigoEmpleado} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono text-xs">{e.codigoEmpleado}</td>
                            <td className="px-3 py-2">{e.nombreEmpleado}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">{e.zona ?? "—"}</td>
                            <td className="px-3 py-2 text-center font-medium">{e.omisionesPeriodo}</td>
                            <td className="px-3 py-2 text-center text-slate-600">
                              {e.diasConOmisionPeriodo}
                            </td>
                            <td className="px-3 py-2 text-center text-emerald-700">
                              {e.omisionesJustificadas > 0 ? e.omisionesJustificadas : "—"}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {e.apercibimientosPeriodoNoAnulados}
                              {e.apercibimientosPeriodo !== e.apercibimientosPeriodoNoAnulados && (
                                <span className="text-xs text-slate-400">
                                  {" "}
                                  / {e.apercibimientosPeriodo}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center text-rose-600">
                              {e.apercibimientosAnulados > 0 ? e.apercibimientosAnulados : "—"}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span
                                className={
                                  e.apercibimientosHistoricosNoAnulados >= 3
                                    ? "font-semibold text-rose-600"
                                    : ""
                                }
                              >
                                {e.apercibimientosHistoricosNoAnulados}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-600">
                              {formatDate(e.primeraOmision)}
                              {e.primeraOmision !== e.ultimaOmision && <> → {formatDate(e.ultimaOmision)}</>}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {e.treatment?.fechaConvocatoria
                                ? formatDate(e.treatment.fechaConvocatoria)
                                : "—"}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {e.treatment?.accion ? ACCION_LABEL[e.treatment.accion] ?? e.treatment.accion : "—"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Link
                                href={`/disciplinario/empleados/${encodeURIComponent(e.codigoEmpleado)}`}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Ver detalle
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
      {drill && data && (
        <DrillModal
          drillKey={drill}
          data={data.data}
          periodo={`${formatDate(filters.desde)} – ${formatDate(filters.hasta)}`}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  valueRight,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  valueRight?: string;
  onClick?: () => void;
}) {
  const clickable = typeof onClick === "function";
  return (
    <Card
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={
        clickable
          ? "cursor-pointer transition hover:border-indigo-400 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          : undefined
      }
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-slate-500">{label}</div>
            <div className="text-2xl font-semibold text-slate-800 mt-0.5">{value}</div>
          </div>
          <div className="mt-0.5">{icon}</div>
        </div>
        {valueRight && (
          <div className="mt-1 text-xs font-medium text-emerald-700">{valueRight}</div>
        )}
        {hint && <div className="mt-2 text-[11px] text-slate-500">{hint}</div>}
        {clickable && (
          <div className="mt-2 text-[10px] uppercase tracking-wide text-indigo-500 font-medium">
            Click para ver detalle
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PorDiaBars({ rows }: { rows: { fecha: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.fecha} className="flex items-center gap-2 text-xs">
          <div className="w-24 text-slate-600">{formatDate(r.fecha)}</div>
          <div className="flex-1 bg-slate-100 rounded-sm h-4 relative overflow-hidden">
            <div
              className="h-full bg-amber-500"
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </div>
          <div className="w-10 text-right font-medium tabular-nums">{r.count}</div>
        </div>
      ))}
    </div>
  );
}

interface DrillConfig {
  title: string;
  description?: string;
  kind: "apercibimientos" | "empleados";
  apercibimientos?: ApercibimientoRow[];
  empleados?: EmpleadoRow[];
}

function buildDrillConfig(
  key: DrillKey,
  payload: OmisionesResponse["data"],
): DrillConfig {
  const { porEmpleado, apercibimientos, anulados } = payload;
  switch (key) {
    case "omisiones":
      return {
        title: "Omisiones totales",
        description:
          "Apercibimientos con fechas de omisión dentro del periodo (vigentes + anulados).",
        kind: "apercibimientos",
        apercibimientos,
      };
    case "justificadas":
      return {
        title: "Omisiones justificadas",
        description: "Apercibimientos anulados cuyas omisiones cayeron en el periodo.",
        kind: "apercibimientos",
        apercibimientos: apercibimientos.filter((a) => a.estado === "ANULADO"),
      };
    case "personas":
      return {
        title: "Personas involucradas",
        description: "Empleados con al menos una omisión en el periodo.",
        kind: "empleados",
        empleados: porEmpleado,
      };
    case "vigentes":
      return {
        title: "Apercibimientos vigentes",
        description: "Apercibimientos del periodo que NO están anulados.",
        kind: "apercibimientos",
        apercibimientos: apercibimientos.filter((a) => a.estado !== "ANULADO"),
      };
    case "anulados":
      return {
        title: "Anulados / Justificados",
        description: "Apercibimientos anulados en el periodo (listado completo).",
        kind: "apercibimientos",
        apercibimientos: anulados.map((a) => ({
          id: a.id,
          numero: a.numero,
          estado: "ANULADO",
          codigoEmpleado: a.codigoEmpleado,
          nombreEmpleado: a.nombreEmpleado,
          administrador: a.administrador,
          zona: a.zona,
          sucursal: null,
          fechaEmision: a.fechaEmision,
          motivoAnulacion: a.motivoAnulacion,
          contrato: a.contrato,
          cliente: a.cliente,
          omisionesEnPeriodo: a.omisionesEnPeriodo,
          diasConOmisionEnPeriodo: a.diasConOmisionEnPeriodo,
          omisionesDetalle: a.omisionesDetalle ?? [],
        })),
      };
    case "tresplus":
      return {
        title: "3+ apercibimientos",
        description: "Empleados con 3 o más apercibimientos vigentes (histórico).",
        kind: "empleados",
        empleados: porEmpleado.filter((e) => e.tieneCon3Plus),
      };
    case "convocados":
      return {
        title: "Convocados",
        description:
          "Empleados con omisión en el rango filtrado y fecha de convocatoria registrada (sin filtrar esa fecha por el rango).",
        kind: "empleados",
        empleados: porEmpleado.filter((e) => e.convocadoEnPeriodo),
      };
    case "cobrados":
      return {
        title: "Cobrados",
        description:
          "Empleados del cohorte con al menos un ciclo cerrado como Cobrado (fecha de cierre puede ser fuera del rango de omisiones).",
        kind: "empleados",
        empleados: porEmpleado.filter((e) => e.cobradosEnPeriodo > 0),
      };
    case "bajas":
      return {
        title: "Bajas",
        description:
          "Empleados del cohorte con al menos un ciclo cerrado como Dado de baja (cualquier fecha de cierre).",
        kind: "empleados",
        empleados: porEmpleado.filter((e) => e.bajasEnPeriodo > 0),
      };
    case "pendientes":
      return {
        title: "Pendientes",
        description:
          "Empleados del cohorte sin ningún ciclo cerrado como Cobrado ni como Dado de baja.",
        kind: "empleados",
        empleados: porEmpleado.filter((e) => e.tienePendiente),
      };
  }
}

function DrillModal({
  drillKey,
  data,
  periodo,
  onClose,
}: {
  drillKey: DrillKey;
  data: OmisionesResponse["data"];
  periodo: string;
  onClose: () => void;
}) {
  const config = buildDrillConfig(drillKey, data);

  const exportar = () => {
    if (config.kind === "apercibimientos" && config.apercibimientos) {
      const rows = config.apercibimientos.map((a) => ({
        "N°": a.numero,
        "Fecha emisión": formatDate(a.fechaEmision),
        Código: a.codigoEmpleado,
        Empleado: a.nombreEmpleado,
        Zona: a.zona ?? "",
        Administrador: a.administrador ?? "",
        Estado: a.estado,
        Contrato: a.contrato ?? "",
        Cliente: a.cliente ?? "",
        "Omisiones (ítems)": a.omisionesEnPeriodo,
        "Días con omisión": a.diasConOmisionEnPeriodo,
        "Fechas de omisión": (a.omisionesDetalle ?? [])
          .map(formatOmision)
          .join(", "),
        "Motivo anulación": a.motivoAnulacion ?? "",
      }));
      exportRowsToExcel({
        filename: `disciplinario_drill_${drillKey}`,
        sheetName: config.title.slice(0, 28),
        rows,
        columnWidths: [14, 14, 14, 28, 16, 18, 14, 14, 22, 14, 12, 40, 28],
      });
    } else if (config.kind === "empleados" && config.empleados) {
      const rows = config.empleados.map((e) => ({
        Código: e.codigoEmpleado,
        Empleado: e.nombreEmpleado,
        Zona: e.zona ?? "",
        "Omisiones (ítems)": e.omisionesPeriodo,
        "Días con omisión": e.diasConOmisionPeriodo,
        "Apercibimientos (periodo)": e.apercibimientosPeriodo,
        "Histórico no-anulados": e.apercibimientosHistoricosNoAnulados,
        "Convocatoria registrada": e.convocadoEnPeriodo ? "Sí" : "No",
        "Fecha convocatoria": e.treatment?.fechaConvocatoria
          ? formatDate(e.treatment.fechaConvocatoria)
          : "",
        "Ciclos cobrados (hist.)": e.cobradosEnPeriodo,
        "Monto cobrado (esos ciclos)": e.montoCobradoEnPeriodo,
        "Ciclos baja (hist.)": e.bajasEnPeriodo,
      }));
      exportRowsToExcel({
        filename: `disciplinario_drill_${drillKey}`,
        sheetName: config.title.slice(0, 28),
        rows,
        columnWidths: [14, 28, 16, 14, 12, 14, 14, 14, 14, 14, 16, 14],
      });
    }
  };

  const count =
    config.kind === "apercibimientos"
      ? config.apercibimientos?.length ?? 0
      : config.empleados?.length ?? 0;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-slate-500 -mt-2">
          {config.description}
          <div className="mt-1">
            Periodo: <span className="font-medium text-slate-700">{periodo}</span> ·{" "}
            <span className="font-medium text-slate-700">{count}</span> registros
          </div>
        </div>
        <div className="mt-2 flex justify-end">
          <Button variant="outline" size="sm" onClick={exportar} disabled={count === 0}>
            <FileSpreadsheet className="h-4 w-4" /> Exportar
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          {count === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              No hay registros que coincidan con este KPI.
            </div>
          ) : config.kind === "apercibimientos" ? (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600 sticky top-0">
                <tr>
                  <th className="px-3 py-2">N°</th>
                  <th className="px-3 py-2">Fecha emisión</th>
                  <th className="px-3 py-2">Empleado</th>
                  <th className="px-3 py-2">Zona</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Contrato / Cliente</th>
                  <th className="px-3 py-2 text-right" title="Cantidad de omisiones individuales">
                    Omisiones
                  </th>
                  <th className="px-3 py-2 text-right" title="Cantidad de días distintos con omisión">
                    Días
                  </th>
                  <th className="px-3 py-2">Fechas de omisión</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {config.apercibimientos!.map((a) => (
                  <tr key={a.id} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{a.numero}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(a.fechaEmision)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{a.nombreEmpleado}</div>
                      <div className="text-xs text-slate-500">{a.codigoEmpleado}</div>
                    </td>
                    <td className="px-3 py-2">{a.zona ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          a.estado === "ANULADO"
                            ? "text-rose-600"
                            : "text-slate-700"
                        }
                      >
                        {a.estado}
                      </span>
                      {a.motivoAnulacion && (
                        <div className="text-[11px] text-slate-500 italic">
                          {a.motivoAnulacion}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs">{a.contrato ?? "—"}</div>
                      <div className="text-xs text-slate-500">{a.cliente ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {a.omisionesEnPeriodo}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {a.diasConOmisionEnPeriodo}
                    </td>
                    <td className="px-3 py-2 max-w-xs">
                      {a.omisionesDetalle && a.omisionesDetalle.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {a.omisionesDetalle.map((o, i) => (
                            <span
                              key={i}
                              className="inline-block rounded bg-amber-50 text-amber-800 px-1.5 py-0.5 text-[11px]"
                              title={o.hora ? `${formatDate(o.fecha)} a las ${o.hora}` : formatDate(o.fecha)}
                            >
                              {formatDate(o.fecha)}
                              {o.hora && (
                                <span className="ml-1 font-medium text-amber-900">
                                  {o.hora}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/disciplinario/empleados/${encodeURIComponent(a.codigoEmpleado)}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Ver empleado
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600 sticky top-0">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Empleado</th>
                  <th className="px-3 py-2">Zona</th>
                  <th className="px-3 py-2 text-right" title="Cantidad de omisiones individuales">
                    Omisiones
                  </th>
                  <th className="px-3 py-2 text-right" title="Cantidad de días distintos con omisión">
                    Días
                  </th>
                  <th className="px-3 py-2 text-right">Apercib.</th>
                  <th className="px-3 py-2 text-right">Hist. no-anul.</th>
                  <th className="px-3 py-2">Convocatoria</th>
                  <th className="px-3 py-2">Cobros / bajas (hist.)</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {config.empleados!.map((e) => (
                  <tr key={e.codigoEmpleado} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{e.codigoEmpleado}</td>
                    <td className="px-3 py-2 font-medium">{e.nombreEmpleado}</td>
                    <td className="px-3 py-2">{e.zona ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {e.omisionesPeriodo}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {e.diasConOmisionPeriodo}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {e.apercibimientosPeriodo}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {e.apercibimientosHistoricosNoAnulados}
                      {e.tieneCon3Plus && (
                        <span
                          className="ml-1 text-rose-500"
                          title="3 o más apercibimientos"
                        >
                          ●
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {e.treatment?.fechaConvocatoria
                        ? formatDate(e.treatment.fechaConvocatoria)
                        : e.convocadoEnPeriodo
                          ? "Sí"
                          : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {e.cobradosEnPeriodo > 0 && (
                        <div className="text-emerald-700">
                          Cobrado × {e.cobradosEnPeriodo}
                          {e.montoCobradoEnPeriodo > 0 && (
                            <span className="ml-1">
                              ({formatCurrency(e.montoCobradoEnPeriodo)})
                            </span>
                          )}
                        </div>
                      )}
                      {e.bajasEnPeriodo > 0 && (
                        <div className="text-rose-700">Baja × {e.bajasEnPeriodo}</div>
                      )}
                      {e.cobradosEnPeriodo === 0 && e.bajasEnPeriodo === 0 && (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/disciplinario/empleados/${encodeURIComponent(e.codigoEmpleado)}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
