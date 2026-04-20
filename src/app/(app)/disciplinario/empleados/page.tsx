"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  RotateCcw,
  Search,
  Users,
  XCircle,
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "next-auth/react";
import { exportRowsToExcel } from "@/lib/utils/excel-export";
import { formatDate } from "@/lib/utils/format";
import { TreatmentDialog } from "@/components/disciplinary/TreatmentDialog";
import { CloseCycleDialog } from "@/components/disciplinary/CloseCycleDialog";
import { toast } from "@/components/ui/toaster";

interface ResumenRow {
  codigoEmpleado: string;
  nombreEmpleado: string;
  zona: string | null;
  administrador: string | null;
  totalApercibimientos: number;
  totalNoAnulados: number;
  vigentesEnCicloActual: number;
  ultimoCerradoEl: string | null;
  ultimaFechaEmision: string | null;
  tieneObligacion: boolean;
  treatment: {
    fechaConvocatoria: string | null;
    accion: string | null;
    cobradoDate: string | null;
  } | null;
}

function describeTreatmentState(t: ResumenRow["treatment"]): {
  label: string;
  color: string;
} {
  if (!t) return { label: "Sin definir", color: "bg-slate-100 text-slate-600" };
  if (t.cobradoDate) return { label: "Cobrado", color: "bg-emerald-100 text-emerald-800" };
  if ((t.accion ?? "").toLowerCase().includes("baja"))
    return { label: "Dado de baja", color: "bg-rose-100 text-rose-700" };
  if (t.fechaConvocatoria || t.accion)
    return { label: "Pendiente", color: "bg-amber-100 text-amber-800" };
  return { label: "Sin definir", color: "bg-slate-100 text-slate-600" };
}

export default function ResumenEmpleadosPage() {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canManage = role === "ADMIN" || role === "SUPERVISOR";
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState({
    q: "",
    zona: "",
    administrador: "",
    soloObligacion: false,
    convocatoriaDesde: "",
    convocatoriaHasta: "",
    sinConvocatoria: false,
  });

  const queryParams = useMemo(() => {
    const sp = new URLSearchParams();
    if (filters.q.trim()) sp.set("q", filters.q.trim());
    if (filters.zona.trim()) sp.set("zona", filters.zona.trim());
    if (filters.administrador.trim()) sp.set("administrador", filters.administrador.trim());
    if (filters.soloObligacion) sp.set("soloObligacion", "1");
    if (filters.convocatoriaDesde) sp.set("convocatoriaDesde", filters.convocatoriaDesde);
    if (filters.convocatoriaHasta) sp.set("convocatoriaHasta", filters.convocatoriaHasta);
    if (filters.sinConvocatoria) sp.set("sinConvocatoria", "1");
    return sp.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<{
    data: ResumenRow[];
    meta: { total: number };
  }>({
    queryKey: ["disciplinary-resumen", queryParams],
    queryFn: () =>
      fetch(`/api/disciplinary/empleados-resumen?${queryParams}`).then((r) => r.json()),
  });

  const rows = data?.data ?? [];
  const obligaciones = rows.filter((r) => r.tieneObligacion).length;

  // Diálogos
  const [treatmentRow, setTreatmentRow] = useState<ResumenRow | null>(null);
  const [closeRow, setCloseRow] = useState<ResumenRow | null>(null);

  function clearFilters() {
    setFilters({
      q: "",
      zona: "",
      administrador: "",
      soloObligacion: false,
      convocatoriaDesde: "",
      convocatoriaHasta: "",
      sinConvocatoria: false,
    });
  }

  const reopenMutation = useMutation({
    mutationFn: async (codigo: string) => {
      const res = await fetch(
        `/api/disciplinary/empleados/${encodeURIComponent(codigo)}/treatment/reopen-cycle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Error al reabrir el ciclo");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Ciclo reabierto");
      queryClient.invalidateQueries({ queryKey: ["disciplinary-resumen"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-detail"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleReopen(row: ResumenRow) {
    if (!row.ultimoCerradoEl) return;
    const tieneTratamiento =
      !!row.treatment &&
      (!!row.treatment.fechaConvocatoria ||
        !!row.treatment.accion ||
        !!row.treatment.cobradoDate);
    const advertencia = tieneTratamiento
      ? "\n\nATENCIÓN: el tratamiento vigente actual se sobrescribirá con los datos del ciclo cerrado."
      : "";
    const ok = window.confirm(
      `¿Reabrir el último ciclo cerrado de ${row.nombreEmpleado || row.codigoEmpleado}?\n\n` +
        "Se restaurará el tratamiento con la convocatoria/acción del cierre y se eliminará " +
        "ese registro del historial de ciclos cerrados." +
        advertencia,
    );
    if (!ok) return;
    reopenMutation.mutate(row.codigoEmpleado);
  }

  function handleExport() {
    if (rows.length === 0) return;
    const exportRows = rows.map((r) => {
      const t = describeTreatmentState(r.treatment);
      return {
        Código: r.codigoEmpleado,
        Empleado: r.nombreEmpleado,
        Zona: r.zona ?? "",
        Administrador: r.administrador ?? "",
        "Apercibimientos vigentes (ciclo actual)": r.vigentesEnCicloActual,
        "Total no anulados (histórico)": r.totalNoAnulados,
        "Total apercibimientos": r.totalApercibimientos,
        "Obligación pendiente": r.tieneObligacion ? "Sí" : "No",
        "Último cierre de ciclo": r.ultimoCerradoEl ? formatDate(r.ultimoCerradoEl) : "",
        "Último apercibimiento": r.ultimaFechaEmision ? formatDate(r.ultimaFechaEmision) : "",
        "Estado tratamiento": t.label,
        "Fecha convocatoria": r.treatment?.fechaConvocatoria
          ? formatDate(r.treatment.fechaConvocatoria)
          : "",
        "Acción tratamiento": r.treatment?.accion ?? "",
        "Fecha cobrado": r.treatment?.cobradoDate ? formatDate(r.treatment.cobradoDate) : "",
      };
    });
    exportRowsToExcel({
      filename: "disciplinario_resumen_empleados",
      sheetName: "Resumen",
      rows: exportRows,
      columnWidths: [12, 28, 18, 22, 14, 16, 14, 16, 18, 18, 16, 16, 22, 14],
    });
  }

  return (
    <>
      <Topbar title="Disciplinario · Resumen por empleado" />
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800 flex items-center gap-2">
              <Users className="h-6 w-6 text-blue-500" />
              Resumen por empleado
            </h1>
            <p className="text-sm text-slate-500">
              Conteo de apercibimientos del ciclo vigente. Al llegar a 3 se genera una obligación
              de definir convocatoria y cierre.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/disciplinario">
              <Button variant="outline" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Volver al listado
              </Button>
            </Link>
          </div>
        </div>

        {/* KPIs rápidos */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-slate-500">Empleados</div>
              <div className="text-2xl font-semibold text-slate-800">{rows.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-slate-500 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-500" /> Con obligación pendiente
              </div>
              <div className="text-2xl font-semibold text-rose-600">{obligaciones}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-slate-500">Apercibimientos vigentes (suma)</div>
              <div className="text-2xl font-semibold text-slate-800">
                {rows.reduce((s, r) => s + r.vigentesEnCicloActual, 0)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <div>
                <label className="text-xs text-slate-600 block mb-1">Buscar</label>
                <Input
                  value={filters.q}
                  onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                  placeholder="Código exacto o nombre…"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Zona</label>
                <Input
                  value={filters.zona}
                  onChange={(e) => setFilters({ ...filters, zona: e.target.value })}
                  placeholder="Contiene…"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Administrador</label>
                <Input
                  value={filters.administrador}
                  onChange={(e) => setFilters({ ...filters, administrador: e.target.value })}
                  placeholder="Contiene…"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Convocatoria desde</label>
                <Input
                  type="date"
                  value={filters.convocatoriaDesde}
                  disabled={filters.sinConvocatoria}
                  onChange={(e) =>
                    setFilters({ ...filters, convocatoriaDesde: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Convocatoria hasta</label>
                <Input
                  type="date"
                  value={filters.convocatoriaHasta}
                  disabled={filters.sinConvocatoria}
                  onChange={(e) =>
                    setFilters({ ...filters, convocatoriaHasta: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.soloObligacion}
                  onChange={(e) =>
                    setFilters({ ...filters, soloObligacion: e.target.checked })
                  }
                />
                Solo con obligación pendiente (≥3)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.sinConvocatoria}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      sinConvocatoria: e.target.checked,
                      convocatoriaDesde: e.target.checked ? "" : filters.convocatoriaDesde,
                      convocatoriaHasta: e.target.checked ? "" : filters.convocatoriaHasta,
                    })
                  }
                />
                Sin fecha de convocatoria
              </label>
            </div>
            <div className="flex items-center justify-between pt-1">
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Limpiar filtros
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={rows.length === 0}
                onClick={handleExport}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Exportar a Excel ({rows.length})
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tabla */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-10 text-center text-slate-400">Cargando…</div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center text-slate-400">
                <Search className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                No hay empleados con esos filtros.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr className="text-left text-xs uppercase text-slate-500">
                    <th className="px-3 py-3">Código</th>
                    <th className="px-3 py-3">Empleado</th>
                    <th className="px-3 py-3">Zona</th>
                    <th className="px-3 py-3">Administrador</th>
                    <th className="px-3 py-3 text-center">Ciclo actual</th>
                    <th className="px-3 py-3 text-center">No anulados (hist.)</th>
                    <th className="px-3 py-3">Último cierre</th>
                    <th className="px-3 py-3">Tratamiento</th>
                    <th className="px-3 py-3 text-right" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => {
                    const t = describeTreatmentState(r.treatment);
                    const cicloColor = r.tieneObligacion
                      ? "bg-rose-100 text-rose-700"
                      : r.vigentesEnCicloActual === 2
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-700";
                    const canReopen = canManage && !!r.ultimoCerradoEl;
                    return (
                      <tr
                        key={r.codigoEmpleado}
                        className={r.tieneObligacion ? "bg-rose-50/40" : "hover:bg-slate-50"}
                      >
                        <td className="px-3 py-2 font-mono">{r.codigoEmpleado}</td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/disciplinario/empleados/${encodeURIComponent(r.codigoEmpleado)}`}
                            className="font-medium text-slate-800 hover:text-blue-600 hover:underline"
                          >
                            {r.nombreEmpleado || "—"}
                          </Link>
                          {r.tieneObligacion && (
                            <div className="flex items-center gap-1 text-[11px] text-rose-600 mt-0.5">
                              <AlertTriangle className="h-3 w-3" />
                              Obligación: definir convocatoria y cierre.
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">{r.zona ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {r.administrador ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Badge className={`${cicloColor} text-xs`}>
                            {r.vigentesEnCicloActual}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-center text-slate-600">
                          {r.totalNoAnulados}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {r.ultimoCerradoEl ? formatDate(r.ultimoCerradoEl) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Badge className={`${t.color} text-xs`}>{t.label}</Badge>
                          {r.treatment?.fechaConvocatoria && (
                            <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                              <CalendarClock className="h-3 w-3" />
                              Conv: {formatDate(r.treatment.fechaConvocatoria)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              href={`/disciplinario/empleados/${encodeURIComponent(r.codigoEmpleado)}`}
                              className="inline-flex items-center text-blue-600 hover:underline text-xs gap-1 px-2"
                              title="Ver detalle"
                            >
                              <Eye className="h-3.5 w-3.5" /> Ver
                            </Link>
                            {canManage && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs gap-1"
                                  onClick={() => setTreatmentRow(r)}
                                  title="Tratamiento / convocatoria"
                                >
                                  <CalendarClock className="h-3.5 w-3.5" /> Tratar
                                </Button>
                                {r.vigentesEnCicloActual > 0 && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className={`h-7 px-2 text-xs gap-1 ${
                                      r.tieneObligacion ? "text-rose-700" : "text-emerald-700"
                                    }`}
                                    onClick={() => setCloseRow(r)}
                                    title="Cerrar ciclo (cobro / baja)"
                                  >
                                    {r.tieneObligacion ? (
                                      <XCircle className="h-3.5 w-3.5" />
                                    ) : (
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                    )}
                                    Cerrar
                                  </Button>
                                )}
                                {canReopen && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs gap-1 text-amber-700"
                                    disabled={reopenMutation.isPending}
                                    onClick={() => handleReopen(r)}
                                    title="Reabrir el último ciclo cerrado"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <div className="text-xs text-slate-500">
          El contador del <strong>ciclo actual</strong> reinicia a cero cuando se cierra un ciclo
          (cobro o baja). Solo se cuentan apercibimientos no anulados emitidos después del último
          cierre.
        </div>
      </div>

      {/* Diálogos */}
      <TreatmentDialog
        open={!!treatmentRow}
        onOpenChange={(o) => !o && setTreatmentRow(null)}
        codigo={treatmentRow?.codigoEmpleado ?? ""}
        initial={treatmentRow?.treatment ?? null}
      />
      <CloseCycleDialog
        open={!!closeRow}
        onOpenChange={(o) => {
          if (!o) {
            setCloseRow(null);
            queryClient.invalidateQueries({ queryKey: ["disciplinary-resumen"] });
          }
        }}
        codigo={closeRow?.codigoEmpleado ?? ""}
      />
    </>
  );
}
