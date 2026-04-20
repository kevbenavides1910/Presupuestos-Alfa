"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileSpreadsheet, AlertTriangle, DollarSign, UserMinus, BarChart3, Users } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exportRowsToExcel } from "@/lib/utils/excel-export";
import { formatCurrency, formatDate } from "@/lib/utils/format";

const ESTADO_LABEL: Record<string, string> = {
  EMITIDO: "Emitido",
  ENTREGADO: "Entregado",
  FIRMADO: "Firmado",
  ANULADO: "Anulado",
};

interface DashboardResponse {
  data: {
    rango: { desde: string | null; hasta: string | null; administrador: string | null };
    totales: {
      apercibimientos: number;
      cobradosCount: number;
      cobradosMonto: number;
      bajas: number;
      tercerosUmbral: number;
    };
    porEstado: Record<string, number>;
    porAdministrador: { administrador: string; total: number }[];
    terceros: {
      codigoEmpleado: string;
      nombreEmpleado: string;
      fechaTercero: string;
      administrador: string | null;
    }[];
  };
}

export default function DisciplinarioDashboardPage() {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const todayIso = today.toISOString().slice(0, 10);

  const [filters, setFilters] = useState({
    desde: firstOfMonth,
    hasta: todayIso,
    administrador: "",
  });

  const queryParams = useMemo(() => {
    const sp = new URLSearchParams();
    if (filters.desde) sp.set("desde", filters.desde);
    if (filters.hasta) sp.set("hasta", filters.hasta);
    if (filters.administrador.trim()) sp.set("administrador", filters.administrador.trim());
    return sp.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey: ["disciplinary-dashboard", queryParams],
    queryFn: () => fetch(`/api/disciplinary/dashboard?${queryParams}`).then((r) => r.json()),
  });

  function exportTerceros() {
    if (!data?.data.terceros.length) return;
    const rows = data.data.terceros.map((t) => ({
      Código: t.codigoEmpleado,
      Nombre: t.nombreEmpleado,
      "Fecha 3er apercibimiento": formatDate(t.fechaTercero),
      Administrador: t.administrador ?? "",
    }));
    exportRowsToExcel({
      filename: "terceros_umbral",
      sheetName: "Terceros",
      rows,
      columnWidths: [14, 28, 22, 22],
    });
  }

  function exportPorAdmin() {
    if (!data?.data.porAdministrador.length) return;
    const rows = data.data.porAdministrador.map((r) => ({
      Administrador: r.administrador,
      Total: r.total,
    }));
    exportRowsToExcel({
      filename: "apercibimientos_por_admin",
      sheetName: "PorAdmin",
      rows,
      columnWidths: [28, 12],
    });
  }

  return (
    <>
      <Topbar title="Disciplinario" />
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4">
          <Link href="/disciplinario" className="inline-flex items-center text-sm text-slate-600 hover:text-blue-600 gap-1">
            <ArrowLeft className="h-4 w-4" /> Volver al listado
          </Link>
          <Link href="/disciplinario/empleados" className="inline-flex items-center text-sm text-slate-600 hover:text-blue-600 gap-1">
            <Users className="h-4 w-4" /> Resumen por empleado
          </Link>
          <Link href="/disciplinario/reportes/omisiones" className="inline-flex items-center text-sm text-slate-600 hover:text-blue-600 gap-1">
            <AlertTriangle className="h-4 w-4" /> Reporte de omisiones
          </Link>
        </div>

        <div>
          <h1 className="text-2xl font-semibold text-slate-800 flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-blue-600" />
            Dashboard disciplinario
          </h1>
          <p className="text-sm text-slate-500">
            Cifras alineadas con la app de escritorio (cierres, bajas y umbral del 3.er apercibimiento).
          </p>
        </div>

        {/* Filtros */}
        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-slate-600 block mb-1">Desde</label>
              <Input
                type="date"
                value={filters.desde}
                onChange={(e) => setFilters({ ...filters, desde: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">Hasta</label>
              <Input
                type="date"
                value={filters.hasta}
                onChange={(e) => setFilters({ ...filters, hasta: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-600 block mb-1">Administrador (contiene)</label>
              <Input
                value={filters.administrador}
                onChange={(e) => setFilters({ ...filters, administrador: e.target.value })}
                placeholder="Ej. Juan"
              />
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="text-slate-400">Cargando…</div>
        ) : data?.data ? (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-500">Apercibimientos</div>
                      <div className="text-2xl font-semibold">{data.data.totales.apercibimientos}</div>
                    </div>
                    <AlertTriangle className="h-8 w-8 text-amber-500" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-500">Cobrado</div>
                      <div className="text-2xl font-semibold">
                        {formatCurrency(data.data.totales.cobradosMonto)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {data.data.totales.cobradosCount} ciclo(s)
                      </div>
                    </div>
                    <DollarSign className="h-8 w-8 text-emerald-500" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-500">Dados de baja</div>
                      <div className="text-2xl font-semibold">{data.data.totales.bajas}</div>
                    </div>
                    <UserMinus className="h-8 w-8 text-rose-500" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-500">3.er apercibimiento</div>
                      <div className="text-2xl font-semibold">{data.data.totales.tercerosUmbral}</div>
                      <div className="text-xs text-slate-500">en el rango</div>
                    </div>
                    <AlertTriangle className="h-8 w-8 text-orange-500" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Por estado */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Por estado</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Estado</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {Object.entries(data.data.porEstado).map(([k, v]) => (
                      <tr key={k}>
                        <td className="px-3 py-2">{ESTADO_LABEL[k] ?? k}</td>
                        <td className="px-3 py-2 text-right font-medium">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Por administrador */}
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">Por administrador</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  disabled={data.data.porAdministrador.length === 0}
                  onClick={exportPorAdmin}
                >
                  <FileSpreadsheet className="h-4 w-4" /> Excel
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {data.data.porAdministrador.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-sm">Sin datos en el rango.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Administrador</th>
                        <th className="px-3 py-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.data.porAdministrador.map((r, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2">{r.administrador}</td>
                          <td className="px-3 py-2 text-right font-medium">{r.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {/* Oficiales que llegan al 3.er apercibimiento en el rango */}
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">Oficiales en el umbral del 3.er apercibimiento</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  disabled={data.data.terceros.length === 0}
                  onClick={exportTerceros}
                >
                  <FileSpreadsheet className="h-4 w-4" /> Excel
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {data.data.terceros.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-sm">Sin oficiales en el umbral en el rango.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Código</th>
                        <th className="px-3 py-2 text-left">Nombre</th>
                        <th className="px-3 py-2 text-left">Fecha 3.er apercibimiento</th>
                        <th className="px-3 py-2 text-left">Administrador</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.data.terceros.map((t) => (
                        <tr key={t.codigoEmpleado} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono">{t.codigoEmpleado}</td>
                          <td className="px-3 py-2">
                            <Link
                              href={`/disciplinario/empleados/${encodeURIComponent(t.codigoEmpleado)}`}
                              className="font-medium text-slate-800 hover:text-blue-600 hover:underline"
                            >
                              {t.nombreEmpleado}
                            </Link>
                          </td>
                          <td className="px-3 py-2">{formatDate(t.fechaTercero)}</td>
                          <td className="px-3 py-2 text-xs">{t.administrador ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
