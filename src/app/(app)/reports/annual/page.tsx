"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/layout/Topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { FileSpreadsheet } from "lucide-react";
import { formatCurrency } from "@/lib/utils/format";
import { exportRowsToExcel } from "@/lib/utils/excel-export";
import {
  companyDisplayName,
  CONTRACT_STATUS_LABELS,
  REPORT_PARTIDA_OPTIONS,
  type ReportPartidaFilter,
} from "@/lib/utils/constants";
import { useCompanies } from "@/lib/hooks/use-companies";
import type { AnnualReport, MonthCell } from "@/lib/business/annualProfitability";
import { ContractMonthDrilldownDialog, type MonthDrilldownTarget } from "@/components/reports/ContractMonthDrilldownDialog";

const MONTH_LABELS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// ── Rentabilidad view cells ────────────────────────────────────────────────────
function SurplusCell({ cell, onOpenMonth }: { cell: MonthCell; onOpenMonth?: () => void }) {
  if (!cell.hasData) {
    return <td className="px-2 py-2 text-center text-slate-300 text-xs">—</td>;
  }
  const isGood = cell.surplus >= 0;
  const title =
    cell.partidaAllDetail
      ? `MO: ${formatCurrency(cell.partidaAllDetail.laborBudget)} / ${formatCurrency(cell.partidaAllDetail.laborSpend)} · Ins: ${formatCurrency(cell.partidaAllDetail.suppliesBudget)} / ${formatCurrency(cell.partidaAllDetail.suppliesSpend)} · Adm: ${formatCurrency(cell.partidaAllDetail.adminBudget)} / ${formatCurrency(cell.partidaAllDetail.adminSpend)}${
          (cell.partidaAllDetail.unassignedSpend ?? 0) > 0
            ? ` · Sin partida: ${formatCurrency(cell.partidaAllDetail.unassignedSpend)}`
            : ""
        }`
      : `Presupuesto: ${formatCurrency(cell.lineBudget)} | Gastos: ${formatCurrency(cell.totalExpenses)}`;
  const content = (
    <span title={title} className={onOpenMonth ? "pointer-events-none" : undefined}>
      {isGood ? "+" : ""}{formatCurrency(cell.surplus)}
    </span>
  );
  return (
    <td className={`px-1 py-1 text-center text-xs font-semibold tabular-nums ${isGood ? "text-green-700 bg-green-50" : "text-red-700 bg-red-50"}`}>
      {onOpenMonth ? (
        <button
          type="button"
          title={`${title} · Clic para ver ingresos y gastos del mes`}
          onClick={onOpenMonth}
          className="w-full min-h-[2.25rem] rounded px-1 py-1.5 cursor-pointer hover:ring-2 hover:ring-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow text-inherit font-semibold"
        >
          {content}
        </button>
      ) : (
        <span className="block px-2 py-2">{content}</span>
      )}
    </td>
  );
}

function SurplusTotalCell({ surplus }: { surplus: number }) {
  if (surplus === 0) return <td className="px-2 py-2 text-center text-slate-400 text-xs">₡0</td>;
  const isGood = surplus >= 0;
  return (
    <td className={`px-2 py-2 text-center text-sm font-bold tabular-nums ${isGood ? "text-green-800" : "text-red-800"}`}>
      {isGood ? "+" : ""}{formatCurrency(surplus)}
    </td>
  );
}

// ── Gastos view cells ─────────────────────────────────────────────────────────
function ExpenseCell({ cell, onOpenMonth }: { cell: MonthCell; onOpenMonth?: () => void }) {
  if (!cell.hasData) {
    return <td className="px-2 py-2 text-center text-slate-300 text-xs">—</td>;
  }
  if (cell.totalExpenses === 0) {
    return (
      <td className="px-1 py-1 text-center text-slate-400 text-xs">
        {onOpenMonth ? (
          <button
            type="button"
            title="Clic para ver ingresos y gastos del mes"
            onClick={onOpenMonth}
            className="w-full min-h-[2.25rem] rounded px-1 py-1.5 cursor-pointer hover:ring-2 hover:ring-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            ₡0
          </button>
        ) : (
          "₡0"
        )}
      </td>
    );
  }
  let cls = "text-slate-700";
  let usagePct = 0;
  if (cell.partidaAllDetail) {
    const d = cell.partidaAllDetail;
    usagePct = Math.max(
      d.laborBudget > 0 ? d.laborSpend / d.laborBudget : 0,
      d.suppliesBudget > 0 ? d.suppliesSpend / d.suppliesBudget : 0,
      d.adminBudget > 0 ? d.adminSpend / d.adminBudget : 0
    );
    if (usagePct > 1) cls = "text-red-700 bg-red-50 font-semibold";
    else if (usagePct > 0.8) cls = "text-orange-700 bg-orange-50";
  } else if (cell.lineBudget > 0) {
    usagePct = cell.totalExpenses / cell.lineBudget;
    if (usagePct > 1) cls = "text-red-700 bg-red-50 font-semibold";
    else if (usagePct > 0.8) cls = "text-orange-700 bg-orange-50";
  }
  const pctLabel =
    cell.partidaAllDetail || cell.lineBudget > 0
      ? ` (${(usagePct * 100).toFixed(0)}% del ppto. partida)`
      : "";
  const tip = `Gastos: ${formatCurrency(cell.totalExpenses)} | Presupuesto partida: ${formatCurrency(cell.lineBudget)}${pctLabel}`;
  const inner = <span className={onOpenMonth ? "pointer-events-none" : undefined}>{formatCurrency(cell.totalExpenses)}</span>;
  return (
    <td className={`px-1 py-1 text-center text-xs tabular-nums ${cls}`}>
      {onOpenMonth ? (
        <button
          type="button"
          title={`${tip} · Clic para ver detalle`}
          onClick={onOpenMonth}
          className="w-full min-h-[2.25rem] rounded px-1 py-1.5 cursor-pointer hover:ring-2 hover:ring-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow text-inherit"
        >
          {inner}
        </button>
      ) : (
        <span className="block px-2 py-2" title={tip}>{inner}</span>
      )}
    </td>
  );
}

function ExpenseTotalCell({ amount }: { amount: number }) {
  if (amount === 0) return <td className="px-2 py-2 text-center text-slate-400 text-xs">₡0</td>;
  return (
    <td className="px-2 py-2 text-center text-sm font-bold tabular-nums text-slate-800">
      {formatCurrency(amount)}
    </td>
  );
}

// ── Facturación view cells ────────────────────────────────────────────────────
function BillingCell({ cell, onOpenMonth }: { cell: MonthCell; onOpenMonth?: () => void }) {
  if (!cell.hasData) {
    return <td className="px-2 py-2 text-center text-slate-300 text-xs">—</td>;
  }
  const tip = `Presupuesto (vista actual): ${formatCurrency(cell.lineBudget)}`;
  const inner = <span className={onOpenMonth ? "pointer-events-none" : undefined}>{formatCurrency(cell.monthlyBilling)}</span>;
  return (
    <td className="px-1 py-1 text-center text-xs tabular-nums text-slate-700">
      {onOpenMonth ? (
        <button
          type="button"
          title={`${tip} · Clic para ver ingresos y gastos del mes`}
          onClick={onOpenMonth}
          className="w-full min-h-[2.25rem] rounded px-1 py-1.5 cursor-pointer hover:ring-2 hover:ring-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow text-inherit"
        >
          {inner}
        </button>
      ) : (
        <span className="block px-2 py-2" title={tip}>{inner}</span>
      )}
    </td>
  );
}

function BillingTotalCell({ amount }: { amount: number }) {
  if (amount === 0) return <td className="px-2 py-2 text-center text-slate-400 text-xs">—</td>;
  return (
    <td className="px-2 py-2 text-center text-sm font-bold tabular-nums text-slate-800">
      {formatCurrency(amount)}
    </td>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
type ViewMode = "rentabilidad" | "facturacion" | "gastos";

export default function AnnualReportPage() {
  const [year, setYear] = useState(0);
  const [companies, setCompanies] = useState<string[]>([]);
  const [selectedPartida, setSelectedPartida] = useState<ReportPartidaFilter>("ALL");
  const [view, setView] = useState<ViewMode>("rentabilidad");
  const [monthDrilldown, setMonthDrilldown] = useState<MonthDrilldownTarget | null>(null);
  const { data: companiesRes } = useCompanies();
  const companyRows = companiesRes?.data ?? [];

  const serverYear = year || new Date().getFullYear();
  const yearOpts = Array.from({ length: 6 }, (_, i) => serverYear - i + 1);

  const params = new URLSearchParams();
  if (year > 0) params.set("year", String(year));
  if (companies.length === 1) params.set("company", companies[0]);
  if (selectedPartida !== "ALL") params.set("partida", selectedPartida);

  const { data, isLoading } = useQuery<{ data: AnnualReport }>({
    queryKey: ["annual-report", year, companies, selectedPartida],
    queryFn: () => fetch(`/api/reports/annual?${params}`).then((r) => r.json()),
    staleTime: 60000,
  });

  // Sync year from server response using useEffect (avoids setState-during-render warning)
  const reportYear = data?.data?.year;
  useEffect(() => {
    if (reportYear && year === 0) {
      setYear(reportYear);
    }
  }, [reportYear, year]);

  const report = data?.data;
  const partida = report?.partida ?? "ALL";
  const partidaLabel = REPORT_PARTIDA_OPTIONS.find((o) => o.value === partida)?.label ?? "Todas las partidas";
  const effectiveYear = report?.year ?? (year > 0 ? year : new Date().getFullYear());

  // Filter rows by selected companies (client-side for multi)
  const rows = report?.rows.filter((r) =>
    companies.length === 0 || companies.includes(r.company)
  ) ?? [];

  // Summary totals
  const totalBilling   = rows.reduce((s, r) => s + r.months.reduce((ms, m) => ms + (m.hasData ? m.monthlyBilling : 0), 0), 0);
  const totalBudget    = rows.reduce((s, r) => s + r.annualBudget, 0);
  const totalExpenses  = rows.reduce((s, r) => s + r.annualExpenses, 0);
  const totalSurplus   = rows.reduce((s, r) => s + r.annualSurplus, 0);

  function handleExport() {
    if (rows.length === 0) return;
    const valueByMonth = (cell: typeof rows[0]["months"][number]): number => {
      if (!cell.hasData) return 0;
      if (view === "rentabilidad") return cell.surplus;
      if (view === "facturacion") return cell.monthlyBilling;
      return cell.totalExpenses;
    };
    const totalByRow = (r: typeof rows[0]): number => {
      if (view === "rentabilidad") return r.annualSurplus;
      if (view === "facturacion") return r.months.reduce((s, m) => s + (m.hasData ? m.monthlyBilling : 0), 0);
      return r.annualExpenses;
    };

    const exportRows = rows.map((r) => {
      const obj: Record<string, string | number> = {
        Licitación: r.licitacionNo,
        Cliente: r.client,
        Empresa: companyDisplayName(r.company, companyRows),
        Estado: CONTRACT_STATUS_LABELS[r.status as keyof typeof CONTRACT_STATUS_LABELS] ?? r.status,
      };
      MONTH_LABELS.forEach((m, i) => {
        obj[m] = r.months[i].hasData ? valueByMonth(r.months[i]) : "";
      });
      obj["Anual"] = totalByRow(r);
      return obj;
    });

    const totalRow: Record<string, string | number> = {
      Licitación: "TOTALES",
      Cliente: `${rows.length} contratos`,
      Empresa: "",
      Estado: "",
    };
    MONTH_LABELS.forEach((m, i) => {
      const sum = rows.reduce((s, r) => s + valueByMonth(r.months[i]), 0);
      totalRow[m] = sum;
    });
    totalRow["Anual"] =
      view === "rentabilidad" ? totalSurplus
      : view === "facturacion" ? totalBilling
      : totalExpenses;

    const viewSuffix = view === "rentabilidad" ? "rentabilidad" : view === "facturacion" ? "facturacion" : "gastos";
    const partidaSuffix = partida === "ALL" ? "todas" : partida.toLowerCase();
    exportRowsToExcel({
      filename: `reporte_anual_${effectiveYear}_${viewSuffix}_${partidaSuffix}`,
      sheetName: `Anual ${effectiveYear}`,
      rows: exportRows,
      totalRow,
      columnWidths: [16, 30, 14, 14, ...Array(12).fill(13), 16],
    });
  }

  return (
    <>
      <Topbar title="Reporte Anual" />
      <div className="p-6 space-y-4">

        {/* View toggle + Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          {/* View toggle */}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Vista</label>
            <div className="flex rounded-md border overflow-hidden text-sm">
              {([
                { key: "rentabilidad", label: "Rentabilidad" },
                { key: "facturacion",  label: "Facturación"  },
                { key: "gastos",       label: "Gastos"       },
              ] as { key: ViewMode; label: string }[]).map(v => (
                <button
                  key={v.key}
                  className={`px-4 py-1.5 font-medium transition-colors ${view === v.key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                  onClick={() => setView(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Year */}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Año</label>
            <Select value={String(year || "")} onValueChange={(v) => setYear(parseInt(v))}>
              <SelectTrigger className="w-28"><SelectValue placeholder="Año" /></SelectTrigger>
              <SelectContent>
                {yearOpts.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Company */}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Empresa</label>
            <MultiSelect
              options={companyRows.map((c) => ({ value: c.code, label: c.name }))}
              value={companies}
              onChange={setCompanies}
              placeholder="Todas las empresas"
              className="w-52"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Partida</label>
            <Select value={selectedPartida} onValueChange={(v) => setSelectedPartida(v as ReportPartidaFilter)}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Partida" />
              </SelectTrigger>
              <SelectContent>
                {REPORT_PARTIDA_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">&nbsp;</label>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={handleExport}
              disabled={rows.length === 0}
              title="Descargar el reporte anual a Excel"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Exportar a Excel ({rows.length})
            </Button>
          </div>

          {/* Summary KPIs */}
          {report && (
            <div className="ml-auto flex gap-6 text-sm">
              {view === "facturacion" && (
                <>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">Facturación Total</p>
                    <p className="font-bold text-slate-800">{formatCurrency(totalBilling)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">{partida === "ALL" ? "Presupuesto (MO+Ins+Adm.)" : `Presupuesto (${partidaLabel})`}</p>
                    <p className="font-bold text-slate-800">{formatCurrency(totalBudget)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">Contratos</p>
                    <p className="font-bold text-slate-800">{rows.length}</p>
                  </div>
                </>
              )}
              {view === "gastos" && (
                <>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">Total Gastos</p>
                    <p className="font-bold text-slate-800">{formatCurrency(totalExpenses)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">{partida === "ALL" ? "Presupuesto (MO+Ins+Adm.)" : `Presupuesto (${partidaLabel})`}</p>
                    <p className="font-bold text-slate-800">{formatCurrency(totalBudget)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">Consumo</p>
                    <p className={`font-bold text-lg ${totalBudget > 0 && totalExpenses / totalBudget > 1 ? "text-red-700" : "text-slate-800"}`}>
                      {totalBudget > 0 ? `${((totalExpenses / totalBudget) * 100).toFixed(1)}%` : "—"}
                    </p>
                  </div>
                </>
              )}
              {view === "rentabilidad" && (
                <>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">{partida === "ALL" ? "Presupuesto (MO+Ins+Adm.)" : `Presupuesto (${partidaLabel})`}</p>
                    <p className="font-bold text-slate-800">{formatCurrency(totalBudget)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">Gastos Totales</p>
                    <p className="font-bold text-slate-800">{formatCurrency(totalExpenses)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">Resultado</p>
                    <p className={`font-bold text-lg ${totalSurplus >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {totalSurplus >= 0 ? "+" : ""}{formatCurrency(totalSurplus)}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center text-slate-400">Calculando reporte...</div>
            ) : rows.length === 0 ? (
              <div className="p-12 text-center text-slate-400">No hay contratos para el período seleccionado</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b bg-slate-800 text-white">
                      <th className="text-left px-4 py-3 font-semibold sticky left-0 bg-slate-800 min-w-48">Contrato</th>
                      <th className="text-left px-3 py-3 font-semibold min-w-24">Empresa</th>
                      {MONTH_LABELS.map((m) => (
                        <th key={m} className="px-2 py-3 font-semibold text-center min-w-24">{m}</th>
                      ))}
                      <th className="px-3 py-3 font-semibold text-center min-w-28">Anual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((row) => (
                      <tr key={row.contractId} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2 sticky left-0 bg-white">
                          <div className="font-medium text-blue-700 text-xs">{row.licitacionNo}</div>
                          <div className="text-xs text-slate-500 truncate max-w-44">{row.client}</div>
                          <Badge variant="secondary" className="text-[10px] mt-0.5 px-1 py-0">
                            {CONTRACT_STATUS_LABELS[row.status as never]}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-xs font-medium text-slate-600">{companyDisplayName(row.company, companyRows)}</span>
                        </td>
                        {view === "rentabilidad" && row.months.map((cell) => (
                          <SurplusCell
                            key={cell.month}
                            cell={cell}
                            onOpenMonth={() =>
                              setMonthDrilldown({
                                contractId: row.contractId,
                                licitacionNo: row.licitacionNo,
                                client: row.client,
                                year: effectiveYear,
                                month: cell.month,
                              })
                            }
                          />
                        ))}
                        {view === "facturacion" && row.months.map((cell) => (
                          <BillingCell
                            key={cell.month}
                            cell={cell}
                            onOpenMonth={() =>
                              setMonthDrilldown({
                                contractId: row.contractId,
                                licitacionNo: row.licitacionNo,
                                client: row.client,
                                year: effectiveYear,
                                month: cell.month,
                              })
                            }
                          />
                        ))}
                        {view === "gastos" && row.months.map((cell) => (
                          <ExpenseCell
                            key={cell.month}
                            cell={cell}
                            onOpenMonth={() =>
                              setMonthDrilldown({
                                contractId: row.contractId,
                                licitacionNo: row.licitacionNo,
                                client: row.client,
                                year: effectiveYear,
                                month: cell.month,
                              })
                            }
                          />
                        ))}
                        {view === "rentabilidad" && <SurplusTotalCell surplus={row.annualSurplus} />}
                        {view === "facturacion"  && <BillingTotalCell amount={row.months.reduce((s, m) => s + (m.hasData ? m.monthlyBilling : 0), 0)} />}
                        {view === "gastos"       && <ExpenseTotalCell amount={row.annualExpenses} />}
                      </tr>
                    ))}
                  </tbody>

                  {/* Totals row */}
                  <tfoot>
                    <tr className="border-t-2 border-slate-400 bg-slate-100">
                      <td className="px-4 py-2 font-bold text-slate-700 sticky left-0 bg-slate-100" colSpan={2}>
                        TOTALES ({rows.length} contratos)
                      </td>
                      {Array.from({ length: 12 }, (_, i) => {
                        const hasAnyData = rows.some((r) => r.months[i].hasData);
                        if (!hasAnyData) return <td key={i} className="px-2 py-2 text-center text-slate-300 text-xs">—</td>;

                        if (view === "rentabilidad") {
                          const surplus = rows.reduce((s, r) => s + r.months[i].surplus, 0);
                          const isGood = surplus >= 0;
                          return (
                            <td key={i} className={`px-2 py-2 text-center text-xs font-bold tabular-nums ${isGood ? "text-green-800" : "text-red-800"}`}>
                              {isGood ? "+" : ""}{formatCurrency(surplus)}
                            </td>
                          );
                        } else if (view === "facturacion") {
                          const billing = rows.reduce((s, r) => s + (r.months[i].hasData ? r.months[i].monthlyBilling : 0), 0);
                          return (
                            <td key={i} className="px-2 py-2 text-center text-xs font-bold tabular-nums text-slate-800">
                              {formatCurrency(billing)}
                            </td>
                          );
                        } else {
                          // gastos
                          const expenses = rows.reduce((s, r) => s + r.months[i].totalExpenses, 0);
                          return (
                            <td key={i} className="px-2 py-2 text-center text-xs font-bold tabular-nums text-slate-800">
                              {expenses > 0 ? formatCurrency(expenses) : <span className="text-slate-400">₡0</span>}
                            </td>
                          );
                        }
                      })}

                      {/* Annual total */}
                      {view === "rentabilidad" && (
                        <td className={`px-3 py-2 text-center text-sm font-bold ${totalSurplus >= 0 ? "text-green-800" : "text-red-800"}`}>
                          {totalSurplus >= 0 ? "+" : ""}{formatCurrency(totalSurplus)}
                        </td>
                      )}
                      {view === "facturacion" && (
                        <td className="px-3 py-2 text-center text-sm font-bold text-slate-800">
                          {formatCurrency(totalBilling)}
                        </td>
                      )}
                      {view === "gastos" && (
                        <td className="px-3 py-2 text-center text-sm font-bold text-slate-800">
                          {formatCurrency(totalExpenses)}
                        </td>
                      )}
                    </tr>

                    {/* Filas de presupuesto por partida (gastos) */}
                    {view === "gastos" && partida === "ALL" && (
                      <>
                        {(
                          [
                            { key: "mo", label: "PPTO. MANO DE OBRA", rowClass: "bg-emerald-50", labelClass: "text-emerald-800", cellClass: "text-emerald-700",
                              budget: (m: MonthCell) => m.partidaAllDetail?.laborBudget ?? 0,
                              spend: (m: MonthCell) => m.partidaAllDetail?.laborSpend ?? 0 },
                            { key: "ins", label: "PPTO. INSUMOS", rowClass: "bg-orange-50", labelClass: "text-orange-800", cellClass: "text-orange-700",
                              budget: (m: MonthCell) => m.partidaAllDetail?.suppliesBudget ?? 0,
                              spend: (m: MonthCell) => m.partidaAllDetail?.suppliesSpend ?? 0 },
                            { key: "adm", label: "PPTO. ADMINISTRATIVO", rowClass: "bg-violet-50", labelClass: "text-violet-800", cellClass: "text-violet-700",
                              budget: (m: MonthCell) => m.partidaAllDetail?.adminBudget ?? 0,
                              spend: (m: MonthCell) => m.partidaAllDetail?.adminSpend ?? 0 },
                          ] as const
                        ).map((spec) => (
                          <tr key={spec.key} className={`border-t border-slate-300 ${spec.rowClass}`}>
                            <td className={`px-4 py-2 font-semibold sticky left-0 text-xs ${spec.labelClass}`} style={{ background: "inherit" }} colSpan={2}>
                              {spec.label}
                            </td>
                            {Array.from({ length: 12 }, (_, i) => {
                              const budgetM = rows.reduce((s, r) => s + spec.budget(r.months[i]), 0);
                              const spendM = rows.reduce((s, r) => s + spec.spend(r.months[i]), 0);
                              const hasAny = rows.some((r) => r.months[i].hasData);
                              if (!hasAny) return <td key={i} className="px-2 py-2 text-center text-slate-300 text-xs">—</td>;
                              const over = budgetM > 0 && spendM > budgetM;
                              return (
                                <td key={i} className={`px-2 py-2 text-center text-xs tabular-nums font-medium ${over ? "text-red-600" : spec.cellClass}`}
                                  title={budgetM > 0 ? `${((spendM / budgetM) * 100).toFixed(0)}% ejecutado` : undefined}>
                                  {formatCurrency(budgetM)}
                                </td>
                              );
                            })}
                            <td className={`px-3 py-2 text-center text-sm font-bold ${spec.cellClass}`}>
                              {formatCurrency(rows.reduce((s, r) => s + r.months.reduce((ss, m) => ss + spec.budget(m), 0), 0))}
                            </td>
                          </tr>
                        ))}
                      </>
                    )}
                    {view === "gastos" && partida !== "ALL" && (
                      <tr className="border-t border-slate-300 bg-orange-50">
                        <td className="px-4 py-2 font-semibold text-orange-700 sticky left-0 bg-orange-50 text-xs" colSpan={2}>
                          PPTO. {partidaLabel.toUpperCase()}
                        </td>
                        {Array.from({ length: 12 }, (_, i) => {
                          const budget = rows.reduce((s, r) => s + r.months[i].lineBudget, 0);
                          const expenses = rows.reduce((s, r) => s + r.months[i].totalExpenses, 0);
                          const hasAny = rows.some((r) => r.months[i].hasData);
                          if (!hasAny) return <td key={i} className="px-2 py-2 text-center text-slate-300 text-xs">—</td>;
                          const over = budget > 0 && expenses > budget;
                          return (
                            <td key={i} className={`px-2 py-2 text-center text-xs tabular-nums font-medium ${over ? "text-red-600" : "text-orange-700"}`}
                              title={budget > 0 ? `${((expenses / budget) * 100).toFixed(0)}% consumido` : undefined}>
                              {formatCurrency(budget)}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center text-sm font-bold text-orange-700">
                          {formatCurrency(totalBudget)}
                        </td>
                      </tr>
                    )}

                    {view === "facturacion" && partida === "ALL" && (
                      <>
                        {(
                          [
                            { key: "mo", label: "PPTO. MANO DE OBRA", rowClass: "bg-emerald-50", labelClass: "text-emerald-800", cellClass: "text-emerald-700",
                              budget: (m: MonthCell) => m.partidaAllDetail?.laborBudget ?? 0 },
                            { key: "ins", label: "PPTO. INSUMOS", rowClass: "bg-indigo-50", labelClass: "text-indigo-800", cellClass: "text-indigo-700",
                              budget: (m: MonthCell) => m.partidaAllDetail?.suppliesBudget ?? 0 },
                            { key: "adm", label: "PPTO. ADMINISTRATIVO", rowClass: "bg-violet-50", labelClass: "text-violet-800", cellClass: "text-violet-700",
                              budget: (m: MonthCell) => m.partidaAllDetail?.adminBudget ?? 0 },
                          ] as const
                        ).map((spec) => (
                          <tr key={spec.key} className={`border-t border-slate-300 ${spec.rowClass}`}>
                            <td className={`px-4 py-2 font-semibold sticky left-0 text-xs ${spec.labelClass}`} style={{ background: "inherit" }} colSpan={2}>
                              {spec.label}
                            </td>
                            {Array.from({ length: 12 }, (_, i) => {
                              const budgetM = rows.reduce((s, r) => s + spec.budget(r.months[i]), 0);
                              const hasAny = rows.some((r) => r.months[i].hasData);
                              if (!hasAny) return <td key={i} className="px-2 py-2 text-center text-slate-300 text-xs">—</td>;
                              return (
                                <td key={i} className={`px-2 py-2 text-center text-xs tabular-nums font-medium ${spec.cellClass}`}>
                                  {formatCurrency(budgetM)}
                                </td>
                              );
                            })}
                            <td className={`px-3 py-2 text-center text-sm font-bold ${spec.cellClass}`}>
                              {formatCurrency(rows.reduce((s, r) => s + r.months.reduce((ss, m) => ss + spec.budget(m), 0), 0))}
                            </td>
                          </tr>
                        ))}
                      </>
                    )}
                    {view === "facturacion" && partida !== "ALL" && (
                      <tr className="border-t border-slate-300 bg-indigo-50">
                        <td className="px-4 py-2 font-semibold text-indigo-700 sticky left-0 bg-indigo-50 text-xs" colSpan={2}>
                          PPTO. {partidaLabel.toUpperCase()}
                        </td>
                        {Array.from({ length: 12 }, (_, i) => {
                          const budget = rows.reduce((s, r) => s + r.months[i].lineBudget, 0);
                          const hasAny = rows.some((r) => r.months[i].hasData);
                          if (!hasAny) return <td key={i} className="px-2 py-2 text-center text-slate-300 text-xs">—</td>;
                          return (
                            <td key={i} className="px-2 py-2 text-center text-xs tabular-nums text-indigo-700 font-medium">
                              {formatCurrency(budget)}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center text-sm font-bold text-indigo-700">
                          {formatCurrency(totalBudget)}
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Legend */}
        {view === "rentabilidad" && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-100 border border-green-300 inline-block" /> Superávit (presupuesto sobrante)</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-100 border border-red-300 inline-block" /> Déficit (presupuesto excedido)</span>
            <span className="flex items-center gap-1.5"><span className="text-slate-300">—</span> Sin datos ese mes</span>
            <span className="text-slate-600">Clic en una celda de mes para ver ingresos y gastos de ese contrato.</span>
          </div>
        )}
        {view === "facturacion" && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-white border border-slate-300 inline-block" /> Facturación mensual del contrato</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-indigo-100 border border-indigo-300 inline-block" /> Filas de presupuesto = partida seleccionada (o tres filas si “Todas las partidas”)</span>
            <span className="flex items-center gap-1.5"><span className="text-slate-300">—</span> Contrato no activo ese mes</span>
            <span className="text-slate-600">Clic en un mes para ver el detalle de ingresos y gastos.</span>
          </div>
        )}
        <ContractMonthDrilldownDialog
          open={!!monthDrilldown}
          onOpenChange={(v) => {
            if (!v) setMonthDrilldown(null);
          }}
          target={monthDrilldown}
          partida={partida}
        />

        {view === "gastos" && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-white border border-slate-300 inline-block" /> Gasto normal (&lt;80% del presupuesto de la partida)</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-300 inline-block" /> Gasto alto (80–100%)</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-100 border border-red-300 inline-block" /> Presupuesto de partida excedido (&gt;100%)</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-50 border border-orange-200 inline-block" /> Filas inferiores = presupuesto por partida (MO / insumos / administrativo)</span>
            <span className="flex items-center gap-1.5"><span className="text-slate-300">—</span> Sin datos ese mes</span>
            <span className="text-slate-600">Clic en un mes para ver el detalle de ingresos y gastos.</span>
          </div>
        )}
      </div>
    </>
  );
}
