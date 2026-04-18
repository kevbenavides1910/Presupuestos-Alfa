"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Eye, Receipt, FileSpreadsheet } from "lucide-react";
import { exportRowsToExcel } from "@/lib/utils/excel-export";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { formatCurrency, formatMonthYear } from "@/lib/utils/format";
import { companyDisplayName } from "@/lib/utils/constants";
import { useCompanies } from "@/lib/hooks/use-companies";
import type { ExpenseType } from "@prisma/client";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Distribution {
  contractId: string; licitacionNo: string; client: string; company: string;
  equivalencePct: number; allocatedAmount: number;
}
interface Expense {
  id: string; type: ExpenseType; description: string; amount: number;
  periodMonth: string; isDeferred: boolean; isDistributed: boolean;
  approvalStatus?: string;
  referenceNumber?: string; notes?: string; createdAt: string;
  // Extra fields returned for deferred distributions
  fullAmount?: number; equivalencePct?: number; allocatedAmount?: number;
  origin?: { id: string; name: string } | null;
  position?: { id: string; name: string; location?: { name: string } | null } | null;
  createdBy?: { name: string };
}
interface ExpenseTypeConfig {
  type: string; label: string; color: string; isActive: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const FALLBACK_TYPES: Record<string, { label: string; color: string }> = {
  APERTURA:  { label: "Apertura",       color: "bg-blue-100 text-blue-800" },
  UNIFORMS:  { label: "Uniformes",      color: "bg-purple-100 text-purple-800" },
  AUDIT:     { label: "Auditoría",      color: "bg-orange-100 text-orange-800" },
  ADMIN:     { label: "Administrativo", color: "bg-slate-100 text-slate-700" },
  TRANSPORT: { label: "Transporte",     color: "bg-cyan-100 text-cyan-800" },
  FUEL:      { label: "Combustible",    color: "bg-yellow-100 text-yellow-800" },
  PHONES:    { label: "Teléfonos",      color: "bg-green-100 text-green-800" },
  PLANILLA:  { label: "Planilla",       color: "bg-emerald-100 text-emerald-800" },
  OTHER:     { label: "Otros",          color: "bg-gray-100 text-gray-700" },
};

function typeInfo(type: string, configs: ExpenseTypeConfig[]) {
  const cfg = configs.find(c => c.type === type);
  if (cfg) return { label: cfg.label, color: cfg.color };
  return FALLBACK_TYPES[type] ?? { label: type, color: "bg-gray-100 text-gray-700" };
}

/** YYYY-MM for <input type="month"> and filtering */
function expenseMonthKey(periodMonth: string | Date): string {
  const d = new Date(periodMonth);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  contractId: string;
  /** Lock to a specific expense type (e.g. "UNIFORMS", "AUDIT") */
  lockedType?: string;
  /** Label shown in empty-state when a type is locked */
  lockedTypeLabel?: string;
  /** Show only deferred (isDeferred=true) expenses distributed to this contract */
  isDeferred?: boolean;
  /** Alta/edición de gastos (eliminar, distribuir) */
  canManageExpenses?: boolean;
}

export function ContractExpensesTab({
  contractId,
  lockedType,
  lockedTypeLabel,
  isDeferred,
  canManageExpenses = true,
}: Props) {
  const qc = useQueryClient();
  const { data: companiesRes } = useCompanies();
  const companyRows = companiesRes?.data ?? [];
  const [filterType, setFilterType] = useState(lockedType ?? "all");
  /** Empty string = todos los meses */
  const [filterMonth, setFilterMonth] = useState("");
  const [previewExpense, setPreviewExpense] = useState<Expense | null>(null);

  // Fetch type configs for labels/colors
  const { data: typeConfigData } = useQuery<{ data: ExpenseTypeConfig[] }>({
    queryKey: ["expense-type-configs"],
    queryFn: () => fetch("/api/admin/catalogs/expense-types").then(r => r.json()),
    staleTime: 300000,
  });
  const typeConfigs = typeConfigData?.data ?? [];

  // For deferred tab: fetch via distributions endpoint
  const { data: deferredData, isLoading: deferredLoading } = useQuery<{ data: Expense[] }>({
    queryKey: ["contract-deferred-expenses", contractId],
    queryFn: () => fetch(`/api/expenses?isDeferred=true&distributedTo=${contractId}&pageSize=200`).then(r => r.json()),
    enabled: !!isDeferred,
  });

  // For all other tabs: fetch direct expenses linked to this contract
  const { data, isLoading: directLoading } = useQuery<{ data: Expense[]; meta: { total: number } }>({
    queryKey: ["contract-expenses", contractId, filterType],
    queryFn: () => {
      const p = new URLSearchParams({ contractId, pageSize: "200" });
      const activeType = lockedType ?? filterType;
      if (activeType !== "all") p.set("type", activeType);
      return fetch(`/api/expenses?${p}`).then(r => r.json());
    },
    enabled: !isDeferred,
  });

  const isLoading = isDeferred ? deferredLoading : directLoading;

  // Distribution preview
  const { data: previewData, isLoading: previewLoading } = useQuery<{ data: Distribution[] }>({
    queryKey: ["expense-preview", previewExpense?.id],
    queryFn: () =>
      fetch(`/api/expenses/${previewExpense!.id}/distribute`, { credentials: "same-origin" }).then((r) =>
        r.json()
      ),
    enabled: !!previewExpense && !!previewExpense.isDeferred && previewExpense.approvalStatus !== "REJECTED",
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/expenses/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: (res) => {
      if (res.error) { toast.error(res.error.message ?? "Error"); return; }
      toast.success("Gasto eliminado");
      qc.invalidateQueries({ queryKey: ["contract-expenses", contractId] });
      qc.invalidateQueries({ queryKey: ["profitability", contractId] });
    },
    onError: () => toast.error("Error al eliminar"),
  });

  const expenses = isDeferred ? (deferredData?.data ?? []) : (data?.data ?? []);

  const displayedExpenses = useMemo(() => {
    if (!filterMonth) return expenses;
    return expenses.filter((e) => expenseMonthKey(e.periodMonth) === filterMonth);
  }, [expenses, filterMonth]);

  const total = displayedExpenses.reduce((s, e) => s + e.amount, 0);

  // Tipos presentes en los datos cargados (sin filtrar por mes)
  const presentTypes = [...new Set(expenses.map((e) => e.type))];

  return (
    <div className="space-y-4">
      {/* Header + filter */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-slate-600">
            {displayedExpenses.length} registro{displayedExpenses.length !== 1 ? "s" : ""} ·{" "}
            <span className="font-semibold text-slate-800">{formatCurrency(total)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 whitespace-nowrap">Mes</span>
            <input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Filtrar por mes"
            />
            {filterMonth ? (
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setFilterMonth("")}>
                Quitar mes
              </Button>
            ) : null}
          </div>
          {/* Only show type selector when NOT locked to a specific type */}
          {!lockedType && (
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-44 h-8 text-sm">
                <SelectValue placeholder="Todos los tipos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {presentTypes.map(t => {
                  const ti = typeInfo(t, typeConfigs);
                  return <SelectItem key={t} value={t}>{ti.label}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-2"
            disabled={displayedExpenses.length === 0}
            onClick={() => {
              const exportRows = displayedExpenses.map((e) => {
                const ti = typeInfo(e.type, typeConfigs);
                return {
                  Tipo: ti.label,
                  Descripción: e.description,
                  Notas: e.notes ?? "",
                  Ubicación: e.position?.location?.name ?? "",
                  Puesto: e.position?.name ?? "",
                  Origen: e.origin?.name ?? "",
                  "Referencia": e.referenceNumber ?? "",
                  Período: formatMonthYear(e.periodMonth),
                  "Registrado": new Date(e.createdAt).toLocaleString("es-CR"),
                  "Registrado por": e.createdBy?.name ?? "",
                  Monto: e.amount,
                  "Monto total (diferido)": e.fullAmount ?? "",
                  "Equivalencia %": e.equivalencePct != null ? (e.equivalencePct * 100).toFixed(2) + "%" : "",
                  Reparto: isDeferred ? "Diferido" : e.isDeferred ? "Diferido" : "Directo",
                  Estado: e.approvalStatus ?? "",
                };
              });
              const totalRow: Record<string, string | number> = {
                Tipo: "TOTAL",
                Descripción: "",
                Notas: "",
                Ubicación: "",
                Puesto: "",
                Origen: "",
                Referencia: "",
                Período: "",
                Registrado: "",
                "Registrado por": "",
                Monto: total,
              };
              exportRowsToExcel({
                filename: `gastos_contrato_${contractId}`,
                sheetName: "Gastos",
                rows: exportRows,
                totalRow,
                columnWidths: [16, 36, 30, 22, 18, 18, 18, 14, 18, 22, 16, 18, 14, 12, 14],
              });
            }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Exportar a Excel ({displayedExpenses.length})
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="p-10 text-center text-slate-400">Cargando gastos...</div>
      ) : expenses.length === 0 ? (
        <div className="p-10 text-center text-slate-400 border rounded-lg">
          <Receipt className="h-8 w-8 mx-auto mb-2 opacity-30" />
          {isDeferred
            ? "No hay gastos diferidos distribuidos a este contrato"
            : lockedTypeLabel
              ? `No hay gastos de tipo "${lockedTypeLabel}" registrados para este contrato`
              : "No hay gastos registrados para este contrato"
          }
          {!isDeferred && (
            <p className="text-xs mt-2">
              Vaya a <span className="font-medium">Gastos → Agregar Gasto</span> y seleccione este contrato
            </p>
          )}
        </div>
      ) : displayedExpenses.length === 0 ? (
        <div className="p-10 text-center text-slate-400 border rounded-lg">
          <Receipt className="h-8 w-8 mx-auto mb-2 opacity-30" />
          No hay gastos que coincidan con el mes seleccionado. Pruebe otro mes o use &quot;Quitar mes&quot;.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Tipo</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Descripción</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Origen / Ref.</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Período</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Registrado</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Monto</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Estado</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {displayedExpenses.map(e => {
                const ti = typeInfo(e.type, typeConfigs);
                return (
                  <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ti.color}`}>
                        {ti.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="font-medium text-slate-800 truncate">{e.description}</div>
                      {e.position && (
                        <div className="text-xs text-blue-500">
                          {e.position.location
                            ? `${e.position.location.name} › ${e.position.name}`
                            : `Puesto: ${e.position.name}`}
                        </div>
                      )}
                      {e.notes && <div className="text-xs text-slate-400 truncate">{e.notes}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {e.origin ? (
                        <div>
                          <div className="text-xs font-medium text-slate-700">{e.origin.name}</div>
                          {e.referenceNumber && <div className="text-xs text-slate-400 font-mono">{e.referenceNumber}</div>}
                        </div>
                      ) : e.referenceNumber ? (
                        <div className="text-xs text-slate-500 font-mono">{e.referenceNumber}</div>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-sm">
                      {formatMonthYear(e.periodMonth)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-slate-500">
                        {new Date(e.createdAt).toLocaleDateString("es-CR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                      </div>
                      <div className="text-xs text-slate-400">
                        {new Date(e.createdAt).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })}
                        {e.createdBy?.name ? ` · ${e.createdBy.name}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-semibold text-slate-800">{formatCurrency(e.amount)}</div>
                      {e.fullAmount !== undefined && (
                        <div className="text-xs text-slate-400">
                          {((e.equivalencePct ?? 0) * 100).toFixed(2)}% de {formatCurrency(e.fullAmount)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isDeferred ? (
                        <Badge variant="success">Distribuido</Badge>
                      ) : e.isDeferred ? (
                        e.isDistributed
                          ? <Badge variant="success">Distribuido</Badge>
                          : <Badge variant="warning">Pendiente</Badge>
                      ) : (
                        <Badge variant="secondary">Directo</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {(isDeferred || e.isDeferred) && (
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => setPreviewExpense(e)}>
                            <Eye className="h-3 w-3" />
                          </Button>
                        )}
                        {canManageExpenses && !isDeferred && !e.isDistributed && (
                          <Button size="sm" variant="ghost"
                            className="text-red-500 hover:bg-red-50 h-7"
                            onClick={() => { if (confirm("¿Eliminar este gasto?")) deleteMutation.mutate(e.id); }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td className="px-4 py-3 font-bold text-slate-700" colSpan={5}>Total</td>
                <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Distribution preview modal */}
      <Dialog open={!!previewExpense} onOpenChange={v => { if (!v) setPreviewExpense(null); }}>
        <DialogContent className="max-w-2xl max-h-[min(90vh,900px)] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <div className="px-6 pt-6 pb-4 shrink-0">
            <DialogHeader>
              <DialogTitle>
                {previewExpense?.isDeferred ? "Reparto del gasto diferido" : "Detalle de gasto"}
              </DialogTitle>
            </DialogHeader>
          </div>
          {previewExpense && (
            <div className="flex-1 min-h-0 overflow-y-auto px-6 space-y-4 pb-4">
              <div className="bg-slate-50 rounded-lg p-4 grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-slate-500">Descripción:</span> <span className="font-medium ml-1">{previewExpense.description}</span></div>
                <div><span className="text-slate-500">Monto:</span> <span className="font-semibold ml-1">{formatCurrency(previewExpense.amount)}</span></div>
                <div><span className="text-slate-500">Período:</span> <span className="font-medium ml-1">{formatMonthYear(previewExpense.periodMonth)}</span></div>
              </div>
              {previewExpense.isDeferred ? (
                previewLoading ? (
                  <div className="text-center py-6 text-slate-400">Calculando distribución...</div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <p className="text-xs text-slate-500 px-3 py-2 bg-slate-50 border-b">
                      Para cambiar los contratos del reparto use la pantalla global de Gastos.
                    </p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b">
                          <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Contrato</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Empresa</th>
                          <th className="text-right px-4 py-2.5 font-semibold text-slate-600">Equiv. %</th>
                          <th className="text-right px-4 py-2.5 font-semibold text-slate-600">Monto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {(previewData?.data ?? []).map((d) => (
                          <tr key={d.contractId} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5">
                              <div className="font-medium">{d.client}</div>
                              <div className="text-xs text-slate-400">{d.licitacionNo}</div>
                            </td>
                            <td className="px-4 py-2.5 text-slate-500 text-sm">
                              {companyDisplayName(d.company, companyRows)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-slate-600">
                              {(d.equivalencePct * 100).toFixed(2)}%
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold">
                              {formatCurrency(d.allocatedAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : null}
            </div>
          )}
          <div className="shrink-0 border-t bg-background px-6 py-4">
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setPreviewExpense(null)}>Cerrar</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
