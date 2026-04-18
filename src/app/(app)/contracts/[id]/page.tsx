"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  ChevronLeft, Edit, Trash2,
  DollarSign, Users, Calendar, ShieldCheck, PieChart, TrendingUp, TrendingDown, Minus
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BudgetBar } from "@/components/shared/BudgetBar";
import { TrafficLightBadge } from "@/components/shared/TrafficLightBadge";
import { MetricCard } from "@/components/shared/MetricCard";
import { toast } from "@/components/ui/toaster";
import { formatCurrency, formatDate, formatPct, formatMonthYear } from "@/lib/utils/format";
import { companyDisplayName, CLIENT_TYPE_LABELS, CONTRACT_STATUS_LABELS, TrafficLight, calcTrafficLight } from "@/lib/utils/constants";
import { useCompanies } from "@/lib/hooks/use-companies";
// calcTrafficLight used in BudgetBar lifetime section
import { PeriodsTab } from "@/components/contracts/PeriodsTab";
import { PositionsTab } from "@/components/contracts/PositionsTab";
import { BillingHistoryTab } from "@/components/contracts/BillingHistoryTab";
import { ContractExpensesTab } from "@/components/contracts/ContractExpensesTab";
import { AssetsTab } from "@/components/contracts/AssetsTab";
import { canModifyContracts, canManageExpenses, isAdmin } from "@/lib/permissions";
import type { ContractStatus, ClientType } from "@prisma/client";

interface Contract {
  id: string; licitacionNo: string; company: string; client: string;
  clientType: ClientType; officersCount: number; positionsCount: number;
  status: ContractStatus; startDate: string; endDate: string;
  baseMonthlyBilling: number;
  monthlyBilling: number; suppliesBudgetPct: number; suppliesBudget: number;
  equivalencePct: number; notes?: string;
  laborPct: number; suppliesPct: number; adminPct: number; profitPct: number;
  totalSuppliesBudget: number; suppliesSharePct: number;
  periods: { id: string; periodNumber: number; startDate: string; endDate: string; monthlyBilling: number }[];
}

interface Profitability {
  suppliesBudget: number;
  uniformsTotal: number; auditTotal: number; deferredTotal: number; adminTotal: number;
  directTotal: number; expenseDistTotal: number;
  directByType: Record<string, number>;
  expenseDistByType: Record<string, number>;
  expensesByType: Record<string, number>;
  grandTotal: number;
  budgetUsagePctFormatted: number; trafficLight: TrafficLight; remaining: number;
  lifetime?: {
    totalBilled: number; totalBudget: number; totalExpenses: number;
    totalMonths: number; surplus: number;
  };
}

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canEditContract = role ? canModifyContracts(role) : false;
  const canEditExpenses = role ? canManageExpenses(role) : false;
  const canDeleteContract = role ? isAdmin(role) : false;

  const { data: companiesRes } = useCompanies();
  const companyRows = companiesRes?.data ?? [];

  const { data: contractData, isLoading } = useQuery<{ data: Contract }>({
    queryKey: ["contract", id],
    queryFn: () => fetch(`/api/contracts/${id}`).then((r) => r.json()),
  });

  const { data: profData } = useQuery<{ data: Profitability }>({
    queryKey: ["profitability", id],
    queryFn: () => fetch(`/api/contracts/${id}/profitability`).then((r) => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: () => fetch(`/api/contracts/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
      toast.success("Contrato eliminado");
      router.push("/contracts");
    },
    onError: () => toast.error("Error al eliminar contrato"),
  });

  if (isLoading) {
    return (
      <>
        <Topbar title="Detalle de Contrato" />
        <div className="p-8 text-center text-slate-400">Cargando...</div>
      </>
    );
  }

  const contract = contractData?.data;
  if (!contract) return null;

  const prof = profData?.data;
  const tl = prof?.trafficLight ?? "GREEN";

  const statusColors: Record<ContractStatus, "success" | "warning" | "secondary" | "destructive"> = {
    ACTIVE: "success", PROLONGATION: "warning", SUSPENDED: "warning",
    FINISHED: "secondary", CANCELLED: "destructive",
  };

  return (
    <>
      <Topbar title={contract.licitacionNo} />
      <div className="p-6 space-y-6">
        {/* Breadcrumb + Actions */}
        <div className="flex items-start justify-between">
          <div>
            <Link href="/contracts" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-700 gap-1 mb-2">
              <ChevronLeft className="h-4 w-4" />
              Contratos
            </Link>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{contract.licitacionNo}</h1>
              <Badge variant={statusColors[contract.status]}>{CONTRACT_STATUS_LABELS[contract.status]}</Badge>
              <Badge variant="outline">{companyDisplayName(contract.company, companyRows)}</Badge>
              {prof && <TrafficLightBadge light={tl} pct={prof.budgetUsagePctFormatted} />}
            </div>
            <p className="text-slate-500 mt-1">{contract.client} · {CLIENT_TYPE_LABELS[contract.clientType]}</p>
          </div>
          <div className="flex gap-2">
            {canEditContract && (
              <Link href={`/contracts/${id}/edit`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Edit className="h-4 w-4" />
                  Editar
                </Button>
              </Link>
            )}
            {canDeleteContract && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-red-600 hover:bg-red-50 hover:border-red-300"
                onClick={() => {
                  if (confirm("¿Eliminar este contrato? Esta acción es irreversible.")) {
                    deleteMutation.mutate();
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
                Eliminar
              </Button>
            )}
          </div>
        </div>

        {/* Lifetime summary banner */}
        {prof?.lifetime && (() => {
          const lt = prof.lifetime!;
          const usagePct = lt.totalBudget > 0 ? lt.totalExpenses / lt.totalBudget : 0;
          const isOver = lt.surplus < 0;
          const isGood = lt.surplus >= 0;
          return (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Total facturado */}
              <Card className="border-blue-200 bg-blue-50">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">Facturado desde inicio</p>
                      <p className="text-2xl font-bold text-blue-900 mt-1">{formatCurrency(lt.totalBilled)}</p>
                      <p className="text-xs text-blue-600 mt-1">{lt.totalMonths} mes{lt.totalMonths !== 1 ? "es" : ""} de contrato · {formatCurrency(contract.monthlyBilling)}/mes actual</p>
                    </div>
                    <div className="bg-blue-100 rounded-lg p-2.5">
                      <DollarSign className="h-5 w-5 text-blue-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Presupuesto insumos acumulado */}
              <Card className="border-indigo-200 bg-indigo-50">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-medium text-indigo-600 uppercase tracking-wide">Presupuesto insumos acumulado</p>
                      <p className="text-2xl font-bold text-indigo-900 mt-1">{formatCurrency(lt.totalBudget)}</p>
                      <p className="text-xs text-indigo-600 mt-1">{(contract.suppliesBudgetPct * 100).toFixed(1)}% de cada facturación · {formatCurrency(contract.suppliesBudget)}/mes actual</p>
                    </div>
                    <div className="bg-indigo-100 rounded-lg p-2.5">
                      <ShieldCheck className="h-5 w-5 text-indigo-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Gastos vs presupuesto */}
              <Card className={isOver ? "border-red-300 bg-red-50" : "border-green-200 bg-green-50"}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium uppercase tracking-wide ${isOver ? "text-red-600" : "text-green-600"}`}>Gastos acumulados</p>
                      <p className={`text-2xl font-bold mt-1 ${isOver ? "text-red-900" : "text-green-900"}`}>{formatCurrency(lt.totalExpenses)}</p>
                      <div className="mt-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span className={isOver ? "text-red-600" : "text-green-600"}>{(usagePct * 100).toFixed(1)}% del presupuesto</span>
                          <span className={`font-semibold ${isOver ? "text-red-700" : "text-green-700"}`}>
                            {isGood ? "+" : ""}{formatCurrency(lt.surplus)}
                          </span>
                        </div>
                        <div className="w-full bg-white bg-opacity-60 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all ${isOver ? "bg-red-500" : usagePct > 0.8 ? "bg-orange-500" : "bg-green-500"}`}
                            style={{ width: `${Math.min(usagePct * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className={`rounded-lg p-2.5 ml-3 ${isOver ? "bg-red-100" : "bg-green-100"}`}>
                      {isOver
                        ? <TrendingDown className="h-5 w-5 text-red-600" />
                        : isGood
                          ? <TrendingUp className="h-5 w-5 text-green-600" />
                          : <Minus className="h-5 w-5 text-slate-500" />
                      }
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })()}

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Facturación Mensual"
            value={formatCurrency(contract.monthlyBilling)}
            icon={DollarSign}
            color="blue"
          />
          <MetricCard
            title="Presupuesto Insumos/Mes"
            value={formatCurrency(contract.suppliesBudget)}
            subtitle={`${(contract.suppliesBudgetPct * 100).toFixed(1)}% de facturación`}
            icon={ShieldCheck}
            color="green"
          />
          <MetricCard
            title="Personal"
            value={`${contract.officersCount} oficiales`}
            subtitle={`${contract.positionsCount} puestos`}
            icon={Users}
            color="purple"
          />
          <MetricCard
            title="Vigencia"
            value={formatDate(contract.endDate)}
            subtitle={`Inicio: ${formatDate(contract.startDate)}`}
            icon={Calendar}
            color="blue"
          />
        </div>

        {/* Supplies share indicator — only for active contracts */}
        {(contract.status === "ACTIVE" || contract.status === "PROLONGATION") ? (
        <Card className="border-indigo-200 bg-indigo-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <PieChart className="h-5 w-5 text-indigo-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-indigo-800">
                  Participación en Presupuesto Global de Insumos
                </p>
                <p className="text-xs text-indigo-600">
                  Base para distribución proporcional de gastos diferidos
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-2xl font-bold text-indigo-700">
                  {(contract.suppliesSharePct * 100).toFixed(2)}%
                </p>
                <p className="text-xs text-indigo-500">del total global</p>
              </div>
            </div>
            <div className="w-full bg-indigo-100 rounded-full h-2.5">
              <div
                className="bg-indigo-500 h-2.5 rounded-full transition-all"
                style={{ width: `${Math.min(contract.suppliesSharePct * 100, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-indigo-600 mt-1.5">
              <span>Este contrato: {formatCurrency(contract.suppliesBudget)}/mes</span>
              <span>Total global activo: {formatCurrency(contract.totalSuppliesBudget)}/mes</span>
            </div>
          </CardContent>
        </Card>
        ) : null}

        {/* Tabs */}
        <Tabs defaultValue="expenses">
          <TabsList className="flex-wrap">
            <TabsTrigger value="expenses">Todos los Gastos</TabsTrigger>
            <TabsTrigger value="deferred">Diferidos</TabsTrigger>
            <TabsTrigger value="overview">Resumen</TabsTrigger>
            <TabsTrigger value="locations">Ubicaciones</TabsTrigger>
            <TabsTrigger value="assets">Activos</TabsTrigger>
            <TabsTrigger value="billing">Facturación</TabsTrigger>
            <TabsTrigger value="periods">Prórrogas</TabsTrigger>
          </TabsList>

          <TabsContent value="expenses" className="mt-4">
            <ContractExpensesTab contractId={id} canManageExpenses={canEditExpenses} />
          </TabsContent>

          <TabsContent value="overview" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Expense breakdown */}
              {prof && (() => {
                const EXPENSE_TYPE_META: Record<string, { label: string; color: string; bar: string }> = {
                  APERTURA:  { label: "Apertura",       color: "text-blue-700",   bar: "bg-blue-500" },
                  UNIFORMS:  { label: "Uniformes",      color: "text-purple-600", bar: "bg-purple-400" },
                  AUDIT:     { label: "Auditoría",      color: "text-orange-600", bar: "bg-orange-400" },
                  ADMIN:     { label: "Administrativo", color: "text-slate-600",  bar: "bg-slate-400" },
                  TRANSPORT: { label: "Transporte",     color: "text-cyan-600",   bar: "bg-cyan-400" },
                  FUEL:      { label: "Combustible",    color: "text-yellow-600", bar: "bg-yellow-400" },
                  PHONES:    { label: "Teléfonos",      color: "text-green-600",  bar: "bg-green-400" },
                  PLANILLA:  { label: "Planilla",       color: "text-emerald-600", bar: "bg-emerald-400" },
                  OTHER:     { label: "Otros",          color: "text-gray-600",   bar: "bg-gray-400" },
                };

                // Unified buckets: new Expense table (direct + distributed) + legacy tables folded in
                const buckets: Record<string, number> = { ...prof.expensesByType };
                // Legacy tables: fold into type buckets (for contracts with pre-existing data)
                if (prof.uniformsTotal > 0) buckets["UNIFORMS"] = (buckets["UNIFORMS"] ?? 0) + prof.uniformsTotal;
                if (prof.auditTotal    > 0) buckets["AUDIT"]    = (buckets["AUDIT"]    ?? 0) + prof.auditTotal;
                // Legacy deferred/admin distributions stay as separate lines (no type info available)
                const legacyLines = [
                  { label: "Diferidos legacy (dist.)",        value: prof.deferredTotal, color: "text-indigo-500", bar: "bg-indigo-300" },
                  { label: "Administrativos legacy (dist.)",  value: prof.adminTotal,    color: "text-slate-400",  bar: "bg-slate-300" },
                ].filter(l => l.value > 0);

                const allLines = [
                  ...Object.entries(buckets)
                    .filter(([, v]) => v > 0)
                    .map(([type, value]) => ({
                      label: EXPENSE_TYPE_META[type]?.label ?? type,
                      value,
                      color: EXPENSE_TYPE_META[type]?.color ?? "text-slate-600",
                      bar:   EXPENSE_TYPE_META[type]?.bar   ?? "bg-slate-400",
                    }))
                    .sort((a, b) => b.value - a.value),
                  ...legacyLines,
                ];

                return (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Desglose de Gastos Acumulados</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {allLines.length === 0 && (
                        <p className="text-sm text-slate-400 text-center py-4">Sin gastos registrados</p>
                      )}
                      {allLines.map((item) => {
                        const pct = prof.grandTotal > 0 ? (item.value / prof.grandTotal) * 100 : 0;
                        return (
                          <div key={item.label} className="py-1.5 border-b last:border-0">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-sm text-slate-600">{item.label}</span>
                              <span className={`text-sm font-semibold ${item.color}`}>{formatCurrency(item.value)}</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-1.5">
                              <div className={`${item.bar} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex justify-between items-center pt-2 font-bold border-t">
                        <span>Total Gastos</span>
                        <span className={prof.grandTotal > (prof.lifetime?.totalBudget ?? prof.suppliesBudget) ? "text-red-600" : "text-slate-800"}>
                          {formatCurrency(prof.grandTotal)}
                        </span>
                      </div>
                      {prof.lifetime && (
                        <div className="mt-1">
                          <div className="flex justify-between text-xs text-slate-500 mb-1">
                            <span>vs. presupuesto acumulado ({formatCurrency(prof.lifetime.totalBudget)})</span>
                            <span className={prof.lifetime.surplus >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                              {prof.lifetime.surplus >= 0 ? "+" : ""}{formatCurrency(prof.lifetime.surplus)}
                            </span>
                          </div>
                          <BudgetBar
                            pct={prof.lifetime.totalBudget > 0 ? (prof.lifetime.totalExpenses / prof.lifetime.totalBudget) * 100 : 0}
                            light={calcTrafficLight(prof.lifetime.totalBudget > 0 ? prof.lifetime.totalExpenses / prof.lifetime.totalBudget : 0)}
                            showLabel={false}
                            height="md"
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Contract info */}
              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Datos del Contrato</CardTitle></CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {[
                      { label: "N° Licitación", value: contract.licitacionNo },
                      { label: "Empresa", value: companyDisplayName(contract.company, companyRows) },
                      { label: "Cliente", value: contract.client },
                      { label: "Tipo", value: CLIENT_TYPE_LABELS[contract.clientType] },
                      { label: "Equivalencia", value: formatPct(contract.equivalencePct) },
                      { label: "Inicio", value: formatDate(contract.startDate) },
                      { label: "Cierre", value: formatDate(contract.endDate) },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between border-b pb-2 last:border-0">
                        <span className="text-slate-500">{row.label}</span>
                        <span className="font-medium text-right">{row.value}</span>
                      </div>
                    ))}
                    {contract.notes && (
                      <div className="pt-2">
                        <span className="text-slate-500 text-xs block mb-1">Notas</span>
                        <p className="text-sm">{contract.notes}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Budget distribution */}
                {(contract.laborPct > 0 || contract.suppliesPct > 0 || contract.adminPct > 0 || contract.profitPct > 0) && (
                  <Card>
                    <CardHeader><CardTitle className="text-base">Distribución del Contrato</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {[
                        { label: "Mano de obra",         pct: contract.laborPct,    color: "bg-blue-500" },
                        { label: "Insumos",              pct: contract.suppliesPct, color: "bg-purple-500" },
                        { label: "Gasto administrativo", pct: contract.adminPct,    color: "bg-orange-500" },
                        { label: "Utilidad",             pct: contract.profitPct,   color: "bg-green-500" },
                      ].filter(r => r.pct > 0).map(row => (
                        <div key={row.label}>
                          <div className="flex justify-between mb-1">
                            <span className="text-slate-600">{row.label}</span>
                            <span className="font-semibold">
                              {(row.pct * 100).toFixed(1)}% — {formatCurrency(contract.monthlyBilling * row.pct)}
                            </span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-1.5">
                            <div className={`${row.color} h-1.5 rounded-full`} style={{ width: `${row.pct * 100}%` }} />
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2 border-t font-semibold">
                        <span>Total distribuido</span>
                        <span className={(contract.laborPct + contract.suppliesPct + contract.adminPct + contract.profitPct) > 0.999
                          ? "text-green-600" : "text-yellow-600"}>
                          {((contract.laborPct + contract.suppliesPct + contract.adminPct + contract.profitPct) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="locations" className="mt-4">
            <PositionsTab contractId={id} readOnly={!canEditContract} />
          </TabsContent>

          <TabsContent value="assets" className="mt-4">
            <AssetsTab contractId={id} readOnly={!canEditExpenses} />
          </TabsContent>

          <TabsContent value="deferred" className="mt-4">
            <ContractExpensesTab
              contractId={id}
              lockedType="DEFERRED"
              lockedTypeLabel="Diferidos"
              isDeferred
              canManageExpenses={canEditExpenses}
            />
          </TabsContent>

          <TabsContent value="billing" className="mt-4">
            <BillingHistoryTab
              contractId={id}
              monthlyBilling={contract.monthlyBilling}
              contractBaseBilling={contract.baseMonthlyBilling}
              suppliesBudgetPct={contract.suppliesBudgetPct}
              readOnly={!canEditContract}
            />
          </TabsContent>

          <TabsContent value="periods" className="mt-4">
            <PeriodsTab contractId={id} periods={contract.periods} readOnly={!canEditContract} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
