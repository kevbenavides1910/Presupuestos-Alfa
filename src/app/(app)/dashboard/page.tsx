"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, TrendingUp, AlertTriangle, DollarSign, Building2, Calendar } from "lucide-react";
import { MetricCard } from "@/components/shared/MetricCard";
import { BudgetBar } from "@/components/shared/BudgetBar";
import { TrafficLightBadge } from "@/components/shared/TrafficLightBadge";
import { Topbar } from "@/components/layout/Topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate, daysUntilExpiry } from "@/lib/utils/format";
import { COMPANY_LABELS, TrafficLight } from "@/lib/utils/constants";
import type { CompanyName } from "@prisma/client";
import Link from "next/link";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  const names = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  return `${names[parseInt(m) - 1]} ${y}`;
}

interface TrafficLightReport {
  summary: {
    total: number; green: number; yellow: number; red: number;
    totalBilling: number; totalBudget: number; totalExpenses: number;
  };
  contracts: ContractRow[];
}

interface ContractRow {
  contractId: string; licitacionNo: string; company: CompanyName;
  client: string; status: string; startDate: string; endDate: string;
  monthlyBilling: number; suppliesBudget: number; grandTotal: number;
  budgetUsagePctFormatted: number; trafficLight: TrafficLight; isOverBudget: boolean;
}

export default function DashboardPage() {
  const [month, setMonth] = useState(currentMonth());

  const { data, isLoading } = useQuery<{ data: TrafficLightReport }>({
    queryKey: ["traffic-light", month],
    queryFn: () => fetch(`/api/reports/traffic-light?month=${month}`).then((r) => r.json()),
  });

  const report = data?.data;
  const contracts = report?.contracts ?? [];

  // Top 8 at-risk contracts
  const atRisk = [...contracts]
    .sort((a, b) => b.budgetUsagePctFormatted - a.budgetUsagePctFormatted)
    .slice(0, 8);

  // Expiring soon (≤90 days)
  const expiringSoon = contracts
    .filter((c) => c.status === "ACTIVE" || c.status === "PROLONGATION")
    .filter((c) => {
      const days = daysUntilExpiry(c.endDate);
      return days >= 0 && days <= 90;
    })
    .sort((a, b) => daysUntilExpiry(a.endDate) - daysUntilExpiry(b.endDate))
    .slice(0, 5);

  // Group by company
  const byCompany = contracts.reduce<Record<string, { green: number; yellow: number; red: number; total: number }>>((acc, c) => {
    if (!acc[c.company]) acc[c.company] = { green: 0, yellow: 0, red: 0, total: 0 };
    acc[c.company].total++;
    acc[c.company][c.trafficLight.toLowerCase() as "green" | "yellow" | "red"]++;
    return acc;
  }, {});

  if (isLoading) {
    return (
      <>
        <Topbar title="Dashboard" />
        <div className="p-8 flex items-center justify-center h-96">
          <div className="text-slate-500">Cargando datos...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Dashboard Ejecutivo" />
      <div className="p-6 space-y-6">

        {/* Month selector */}
        <div className="flex items-center gap-3">
          <Calendar className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-600">Período:</span>
          <Input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="w-40 h-8 text-sm"
          />
          <span className="text-sm text-slate-500">{monthLabel(month)}</span>
          {month !== currentMonth() && (
            <button
              onClick={() => setMonth(currentMonth())}
              className="text-xs text-blue-600 hover:underline"
            >
              Volver al mes actual
            </button>
          )}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Contratos Activos"
            value={String(report?.summary.total ?? 0)}
            subtitle="En el sistema"
            icon={FileText}
            color="blue"
          />
          <MetricCard
            title="Facturación Mensual"
            value={formatCurrency(report?.summary.totalBilling ?? 0)}
            subtitle="Ingresos totales"
            icon={DollarSign}
            color="green"
          />
          <MetricCard
            title="Contratos en Riesgo"
            value={String(report?.summary.red ?? 0)}
            subtitle={`${report?.summary.yellow ?? 0} en precaución`}
            icon={AlertTriangle}
            color="red"
          />
          <MetricCard
            title="Presupuesto Ejecutado"
            value={report?.summary.totalBudget
              ? `${((report.summary.totalExpenses / report.summary.totalBudget) * 100).toFixed(1)}%`
              : "0%"}
            subtitle={`Gastos: ${formatCurrency(report?.summary.totalExpenses ?? 0)} · Ppto: ${formatCurrency(report?.summary.totalBudget ?? 0)}`}
            icon={TrendingUp}
            color="purple"
          />
        </div>

        {/* Traffic light summary bar */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-6">
              <span className="text-sm font-medium text-slate-600">Semáforo General:</span>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-green-500" />
                  <span className="text-sm text-slate-600">Normal: <strong>{report?.summary.green ?? 0}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-yellow-500" />
                  <span className="text-sm text-slate-600">Precaución: <strong>{report?.summary.yellow ?? 0}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-red-500" />
                  <span className="text-sm text-slate-600">Crítico: <strong>{report?.summary.red ?? 0}</strong></span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* By company */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Estado por Empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {Object.entries(byCompany).map(([company, stats]) => (
                  <div key={company} className="flex items-center justify-between px-6 py-3">
                    <span className="text-sm font-medium">{COMPANY_LABELS[company as CompanyName]}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-green-600 font-medium w-6 text-center">{stats.green}</span>
                      <span className="text-xs text-yellow-600 font-medium w-6 text-center">{stats.yellow}</span>
                      <span className="text-xs text-red-600 font-medium w-6 text-center">{stats.red}</span>
                      <span className="text-xs text-slate-400 ml-1">/ {stats.total}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top at-risk */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Mayor Ejecución de Presupuesto — {monthLabel(month)}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {atRisk.map((c) => (
                  <Link
                    key={c.contractId}
                    href={`/contracts/${c.contractId}`}
                    className="flex items-center gap-4 px-6 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <TrafficLightBadge light={c.trafficLight} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{c.client}</span>
                        <Badge variant="outline" className="text-xs shrink-0">{c.company}</Badge>
                      </div>
                      <BudgetBar
                        pct={c.budgetUsagePctFormatted}
                        light={c.trafficLight}
                        showLabel={false}
                        height="sm"
                      />
                    </div>
                    <span className="text-sm font-bold shrink-0 w-16 text-right">
                      {c.budgetUsagePctFormatted.toFixed(1)}%
                    </span>
                  </Link>
                ))}
                {atRisk.length === 0 && (
                  <div className="px-6 py-8 text-center text-slate-400 text-sm">
                    No hay contratos con datos de gasto
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Expiring soon */}
        {expiringSoon.length > 0 && (
          <Card className="border-orange-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-orange-700 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Contratos Próximos a Vencer (90 días)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {expiringSoon.map((c) => {
                  const days = daysUntilExpiry(c.endDate);
                  return (
                    <Link
                      key={c.contractId}
                      href={`/contracts/${c.contractId}`}
                      className="flex items-center justify-between px-6 py-3 hover:bg-orange-50 transition-colors"
                    >
                      <div>
                        <span className="text-sm font-medium">{c.client}</span>
                        <span className="text-xs text-slate-400 ml-2">— {COMPANY_LABELS[c.company]}</span>
                        <div className="text-xs text-slate-400 mt-0.5">
                          Inicio: {formatDate(c.startDate)} · Vence: {formatDate(c.endDate)}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={days <= 30 ? "danger" : "warning"}>
                          {days} días
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
