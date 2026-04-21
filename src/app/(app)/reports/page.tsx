"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/layout/Topbar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrafficLightBadge } from "@/components/shared/TrafficLightBadge";
import { MetricCard } from "@/components/shared/MetricCard";
import { formatCurrency, toMonthString } from "@/lib/utils/format";
import {
  companyDisplayName,
  CLIENT_TYPE_LABELS,
  CONTRACT_STATUS_LABELS,
  TrafficLight,
  REPORT_PARTIDA_OPTIONS,
  type ReportPartidaFilter,
} from "@/lib/utils/constants";
import type { RubroTrafficSnapshot } from "@/lib/business/profitability";
import { useCompanies } from "@/lib/hooks/use-companies";
import { BarChart3, Download, DollarSign, TrendingUp, AlertTriangle, FileText } from "lucide-react";
import * as XLSX from "xlsx";

interface ExpenseTypeColumn {
  type: string;
  label: string;
}

interface ProfitabilityRow {
  contractId: string;
  licitacionNo: string; company: string; client: string; clientType: string;
  status: string; officersCount: number; positionsCount: number; equivalencePct: number;
  monthlyBilling: number;
  suppliesBudgetPct: number;
  laborBudget: number;
  suppliesBudget: number;
  adminBudget: number;
  profitBudget: number;
  reportPartida: ReportPartidaFilter;
  reportBudget: number;
  reportBudgetPct: number;
  uniformsTotal: number; auditTotal: number; deferredTotal: number; adminTotal: number;
  expensesByTypeMerged: Record<string, number>;
  grandTotal: number; budgetUsagePctFormatted: number; trafficLight: TrafficLight;
  rubroTraffic: {
    LABOR: RubroTrafficSnapshot;
    SUPPLIES: RubroTrafficSnapshot;
    ADMIN: RubroTrafficSnapshot;
    PROFIT: RubroTrafficSnapshot;
  };
  remaining: number; isOverBudget: boolean;
}

interface ProfitabilityReport {
  rows: ProfitabilityRow[];
  expenseTypeColumns: ExpenseTypeColumn[];
  totals: {
    partida: ReportPartidaFilter;
    totalBilling: number;
    totalLaborBudget: number;
    totalSuppliesBudget: number;
    totalAdminBudget: number;
    totalProfitBudget: number;
    totalReportBudget: number;
    totalUniforms: number;
    totalAudit: number;
    totalDeferred: number;
    totalAdmin: number;
    totalExpenses: number; avgUsagePct: number;
    totalsByType: Record<string, number>;
  };
}

export default function ReportsPage() {
  const [selectedCompany, setSelectedCompany] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState(toMonthString(new Date()));
  const [selectedPartida, setSelectedPartida] = useState<ReportPartidaFilter>("ALL");
  const { data: companiesRes } = useCompanies();
  const companyRows = companiesRes?.data ?? [];

  const params = new URLSearchParams();
  if (selectedCompany !== "all") params.set("company", selectedCompany);
  if (selectedMonth) params.set("month", selectedMonth);
  if (selectedPartida !== "ALL") params.set("partida", selectedPartida);

  const { data, isLoading } = useQuery<{ data: ProfitabilityReport }>({
    queryKey: ["profitability-report", selectedCompany, selectedMonth, selectedPartida],
    queryFn: () => fetch(`/api/reports/profitability?${params}`).then((r) => r.json()),
  });

  const report = data?.data;
  const rows = report?.rows ?? [];
  const totals = report?.totals;
  const expenseTypeColumns = report?.expenseTypeColumns ?? [];
  const partida = totals?.partida ?? "ALL";

  const partidaLabel =
    REPORT_PARTIDA_OPTIONS.find((o) => o.value === selectedPartida)?.label ?? "Todas las partidas";

  function toNumPct(budget: number, billing: number): number {
    if (billing <= 0) return 0;
    return budget / billing;
  }

  function pctOfBillingStr(amount: number, billing: number): string {
    return `${(toNumPct(amount, billing) * 100).toFixed(1)}%`;
  }

  function exportToExcel() {
    if (!rows.length || !totals) return;

    const buildRow = (r: ProfitabilityRow): Record<string, string | number> => {
      const o: Record<string, string | number> = {
        "ID contrato": r.contractId,
        "N° Licitación": r.licitacionNo,
        Empresa: companyDisplayName(r.company, companyRows),
        Cliente: r.client,
        Tipo: CLIENT_TYPE_LABELS[r.clientType as keyof typeof CLIENT_TYPE_LABELS],
        Estado: CONTRACT_STATUS_LABELS[r.status as keyof typeof CONTRACT_STATUS_LABELS],
        Oficiales: r.officersCount,
        Puestos: r.positionsCount,
        "Equiv. %": `${(r.equivalencePct * 100).toFixed(2)}%`,
        "Facturación mensual": r.monthlyBilling,
        "Vista / partida": partidaLabel,
      };

      if (partida === "ALL") {
        o["P. mano de obra"] = r.laborBudget;
        o["% P. MO (s/ fact.)"] = pctOfBillingStr(r.laborBudget, r.monthlyBilling);
        o["% ejec. MO"] = `${r.rubroTraffic.LABOR.usagePctFormatted.toFixed(1)}%`;
        o["Sem. MO"] = r.rubroTraffic.LABOR.trafficLight;
        o["P. insumos"] = r.suppliesBudget;
        o["% P. insumos (s/ fact.)"] = pctOfBillingStr(r.suppliesBudget, r.monthlyBilling);
        o["% ejec. insumos"] = `${r.rubroTraffic.SUPPLIES.usagePctFormatted.toFixed(1)}%`;
        o["Sem. insumos"] = r.rubroTraffic.SUPPLIES.trafficLight;
        o["P. administrativo"] = r.adminBudget;
        o["% P. adm. (s/ fact.)"] = pctOfBillingStr(r.adminBudget, r.monthlyBilling);
        o["% ejec. adm."] = `${r.rubroTraffic.ADMIN.usagePctFormatted.toFixed(1)}%`;
        o["Sem. adm."] = r.rubroTraffic.ADMIN.trafficLight;
        o["P. utilidad"] = r.profitBudget;
        o["% P. utilidad (s/ fact.)"] = pctOfBillingStr(r.profitBudget, r.monthlyBilling);
        o["% ejec. utilidad"] = `${r.rubroTraffic.PROFIT.usagePctFormatted.toFixed(1)}%`;
        o["Sem. utilidad"] = r.rubroTraffic.PROFIT.trafficLight;
      } else {
        o.Presupuesto = r.reportBudget;
        o["% presup. (s/ fact.)"] = `${(r.reportBudgetPct * 100).toFixed(1)}%`;
      }

      for (const col of expenseTypeColumns) {
        o[col.label] = r.expensesByTypeMerged[col.type] ?? 0;
      }
      o["Total gastos"] = r.grandTotal;
      o["% ejec. (peor partida)"] = `${r.budgetUsagePctFormatted.toFixed(1)}%`;
      o["Semáforo peor partida"] = r.trafficLight;
      o["Disponible / variación"] = r.remaining;
      return o;
    };

    const exportData = rows.map(buildRow);

    const totalsRow: Record<string, string | number> = {
      "ID contrato": "",
      "N° Licitación": "TOTALES",
      Empresa: "",
      Cliente: "",
      Tipo: "",
      Estado: "",
      Oficiales: "",
      Puestos: "",
      "Equiv. %": "",
      "Facturación mensual": totals.totalBilling,
      "Vista / partida": partidaLabel,
    };

    if (partida === "ALL") {
      totalsRow["P. mano de obra"] = totals.totalLaborBudget;
      totalsRow["% P. MO (s/ fact.)"] = pctOfBillingStr(totals.totalLaborBudget, totals.totalBilling);
      totalsRow["% ejec. MO"] = "";
      totalsRow["Sem. MO"] = "";
      totalsRow["P. insumos"] = totals.totalSuppliesBudget;
      totalsRow["% P. insumos (s/ fact.)"] = pctOfBillingStr(totals.totalSuppliesBudget, totals.totalBilling);
      totalsRow["% ejec. insumos"] = "";
      totalsRow["Sem. insumos"] = "";
      totalsRow["P. administrativo"] = totals.totalAdminBudget;
      totalsRow["% P. adm. (s/ fact.)"] = pctOfBillingStr(totals.totalAdminBudget, totals.totalBilling);
      totalsRow["% ejec. adm."] = "";
      totalsRow["Sem. adm."] = "";
      totalsRow["P. utilidad"] = totals.totalProfitBudget;
      totalsRow["% P. utilidad (s/ fact.)"] = pctOfBillingStr(totals.totalProfitBudget, totals.totalBilling);
      totalsRow["% ejec. utilidad"] = "";
      totalsRow["Sem. utilidad"] = "";
    } else {
      totalsRow.Presupuesto = totals.totalReportBudget;
      totalsRow["% presup. (s/ fact.)"] = pctOfBillingStr(totals.totalReportBudget, totals.totalBilling);
    }

    for (const col of expenseTypeColumns) {
      totalsRow[col.label] = (totals.totalsByType ?? {})[col.type] ?? 0;
    }
    totalsRow["Total gastos"] = totals.totalExpenses;
    totalsRow["% ejec. (peor partida)"] =
      rows.length > 0 ? `${(totals.avgUsagePct * 100).toFixed(1)}%` : "";
    totalsRow["Semáforo peor partida"] = "";
    totalsRow["Disponible / variación"] = "";

    exportData.push(totalsRow);

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rentabilidad");
    const suffix = partida === "ALL" ? "todas-partidas" : selectedPartida.toLowerCase();
    XLSX.writeFile(wb, `reporte-mensual-${selectedMonth}-${suffix}.xlsx`);
  }

  /** % del monto respecto a la facturación mensual (misma fila) */
  function BudgetVsBilling({ amount, billing }: { amount: number; billing: number }) {
    const pct = billing > 0 ? (amount / billing) * 100 : 0;
    return (
      <div className="text-right tabular-nums leading-tight">
        <div>{formatCurrency(amount)}</div>
        <div className="text-[10px] text-slate-500 font-normal">{pct.toFixed(1)}%</div>
      </div>
    );
  }

  /** Presupuesto + % sobre facturación, con semáforo de ejecución de ese rubro */
  function BudgetVsBillingWithLight({
    amount,
    billing,
    rubro,
  }: {
    amount: number;
    billing: number;
    rubro: RubroTrafficSnapshot;
  }) {
    return (
      <div className="text-right tabular-nums leading-tight space-y-1">
        <div className="flex justify-end">
          <TrafficLightBadge light={rubro.trafficLight} pct={rubro.usagePctFormatted} size="sm" />
        </div>
        <BudgetVsBilling amount={amount} billing={billing} />
      </div>
    );
  }

  /** Partida única: usa el % configurado del contrato (coincide con export Excel) */
  function ReportBudgetCell({ amount, pctOfBilling }: { amount: number; pctOfBilling: number }) {
    return (
      <div className="text-right tabular-nums leading-tight">
        <div>{formatCurrency(amount)}</div>
        <div className="text-[10px] text-slate-500 font-normal">{(pctOfBilling * 100).toFixed(1)}%</div>
      </div>
    );
  }

  const trafficCounts = rows.reduce(
    (acc, r) => { acc[r.trafficLight]++; return acc; },
    { GREEN: 0, YELLOW: 0, RED: 0 }
  );

  return (
    <>
      <Topbar title="Reporte mensual de rentabilidad" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Reporte mensual</h2>
            <p className="text-sm text-slate-500">{rows.length} contratos analizados · {partidaLabel}</p>
          </div>
          <Button variant="outline" className="gap-2" onClick={exportToExcel}>
            <Download className="h-4 w-4" />
            Exportar Excel
          </Button>
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={selectedCompany} onValueChange={setSelectedCompany}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Empresa" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las empresas</SelectItem>
              {companyRows.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <Select value={selectedPartida} onValueChange={(v) => setSelectedPartida(v as ReportPartidaFilter)}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Partida" /></SelectTrigger>
            <SelectContent>
              {REPORT_PARTIDA_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {totals && (
          partida === "ALL" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard title="Facturación total" value={formatCurrency(totals.totalBilling)} icon={DollarSign} color="blue" />
                <MetricCard title="Presupuesto mano de obra" value={formatCurrency(totals.totalLaborBudget)} icon={FileText} color="green" />
                <MetricCard title="Presupuesto insumos" value={formatCurrency(totals.totalSuppliesBudget)} icon={FileText} color="green" />
                <MetricCard title="Presupuesto administrativo" value={formatCurrency(totals.totalAdminBudget)} icon={FileText} color="green" />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard title="Total gastos (todas las fuentes)" value={formatCurrency(totals.totalExpenses)} subtitle={`${(totals.avgUsagePct * 100).toFixed(1)}% ejecución máx. entre partidas`} icon={TrendingUp} color="purple" />
                <MetricCard title="Contratos en riesgo" value={String(trafficCounts.RED)} subtitle={`${trafficCounts.YELLOW} en precaución`} icon={AlertTriangle} color="red" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard title="Facturación total" value={formatCurrency(totals.totalBilling)} icon={DollarSign} color="blue" />
              <MetricCard title={`Presupuesto (${partidaLabel})`} value={formatCurrency(totals.totalReportBudget)} icon={FileText} color="green" />
              <MetricCard title="Total gastos (partida)" value={formatCurrency(totals.totalExpenses)} subtitle={`${(totals.avgUsagePct * 100).toFixed(1)}% promedio`} icon={TrendingUp} color="purple" />
              <MetricCard title="Contratos en riesgo" value={String(trafficCounts.RED)} subtitle={`${trafficCounts.YELLOW} en precaución`} icon={AlertTriangle} color="red" />
            </div>
          )
        )}

        <div className="grid grid-cols-3 gap-4">
          {(["GREEN", "YELLOW", "RED"] as TrafficLight[]).map((tl) => {
            const count = trafficCounts[tl];
            const pct = rows.length > 0 ? (count / rows.length) * 100 : 0;
            const colors = { GREEN: "border-green-200 bg-green-50", YELLOW: "border-yellow-200 bg-yellow-50", RED: "border-red-200 bg-red-50" };
            const labels = { GREEN: "Normal", YELLOW: "Precaución", RED: "Crítico" };
            const dotColors = { GREEN: "bg-green-500", YELLOW: "bg-yellow-500", RED: "bg-red-500" };
            return (
              <Card key={tl} className={`border-2 ${colors[tl]}`}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`h-12 w-12 rounded-full ${dotColors[tl]} flex items-center justify-center text-white text-lg font-bold`}>
                    {count}
                  </div>
                  <div>
                    <div className="font-semibold">{labels[tl]}</div>
                    <div className="text-sm text-slate-500">{pct.toFixed(0)}% del total</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Detalle por contrato
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-slate-400">Cargando reporte...</div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No hay datos para mostrar</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="text-left px-3 py-2 font-semibold text-slate-600">Licitación</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600">Cliente</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600">Empresa</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-600">Facturación</th>
                      {partida === "ALL" ? (
                        <>
                          <th className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">P. mano de obra</th>
                          <th className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">P. insumos</th>
                          <th className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">P. administrativo</th>
                          <th className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">P. utilidad</th>
                        </>
                      ) : (
                        <th className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Presupuesto</th>
                      )}
                      {expenseTypeColumns.map((col) => (
                        <th key={col.type} className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                          {col.label}
                        </th>
                      ))}
                      <th className="text-right px-3 py-2 font-semibold text-slate-600">Total</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Peor partida</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r) => (
                      <tr key={r.contractId} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <Link
                            href={`/contracts/${r.contractId}`}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            {r.licitacionNo}
                          </Link>
                        </td>
                        <td className="px-3 py-2 max-w-36">
                          <div className="truncate">{r.client}</div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-xs">{companyDisplayName(r.company, companyRows)}</Badge>
                        </td>
                        <td className="px-3 py-2 text-right">{formatCurrency(r.monthlyBilling)}</td>
                        {partida === "ALL" ? (
                          <>
                            <td className="px-3 py-2">
                              <BudgetVsBillingWithLight
                                amount={r.laborBudget}
                                billing={r.monthlyBilling}
                                rubro={r.rubroTraffic.LABOR}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <BudgetVsBillingWithLight
                                amount={r.suppliesBudget}
                                billing={r.monthlyBilling}
                                rubro={r.rubroTraffic.SUPPLIES}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <BudgetVsBillingWithLight
                                amount={r.adminBudget}
                                billing={r.monthlyBilling}
                                rubro={r.rubroTraffic.ADMIN}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <BudgetVsBillingWithLight
                                amount={r.profitBudget}
                                billing={r.monthlyBilling}
                                rubro={r.rubroTraffic.PROFIT}
                              />
                            </td>
                          </>
                        ) : (
                          <td className="px-3 py-2">
                            <ReportBudgetCell amount={r.reportBudget} pctOfBilling={r.reportBudgetPct} />
                          </td>
                        )}
                        {expenseTypeColumns.map((col) => {
                          const v = r.expensesByTypeMerged[col.type] ?? 0;
                          return (
                            <td key={col.type} className="px-3 py-2 text-right tabular-nums">
                              {v > 0 ? formatCurrency(v) : "—"}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right font-semibold">{r.grandTotal > 0 ? formatCurrency(r.grandTotal) : "—"}</td>
                        <td className="px-3 py-2" title="Mayor % de ejecución entre M.O., insumos, administrativo y utilidad">
                          <TrafficLightBadge light={r.trafficLight} pct={r.budgetUsagePctFormatted} size="sm" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {totals && (
                    <tfoot>
                      <tr className="border-t-2 bg-slate-50 font-bold">
                        <td colSpan={3} className="px-3 py-2 text-right">TOTALES:</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(totals.totalBilling)}</td>
                        {partida === "ALL" ? (
                          <>
                            <td className="px-3 py-2">
                              <BudgetVsBilling amount={totals.totalLaborBudget} billing={totals.totalBilling} />
                            </td>
                            <td className="px-3 py-2">
                              <BudgetVsBilling amount={totals.totalSuppliesBudget} billing={totals.totalBilling} />
                            </td>
                            <td className="px-3 py-2">
                              <BudgetVsBilling amount={totals.totalAdminBudget} billing={totals.totalBilling} />
                            </td>
                            <td className="px-3 py-2">
                              <BudgetVsBilling amount={totals.totalProfitBudget} billing={totals.totalBilling} />
                            </td>
                          </>
                        ) : (
                          <td className="px-3 py-2">
                            <BudgetVsBilling amount={totals.totalReportBudget} billing={totals.totalBilling} />
                          </td>
                        )}
                        {expenseTypeColumns.map((col) => (
                          <td key={col.type} className="px-3 py-2 text-right tabular-nums">
                            {formatCurrency((totals.totalsByType ?? {})[col.type] ?? 0)}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right">{formatCurrency(totals.totalExpenses)}</td>
                        <td className="px-3 py-2" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
