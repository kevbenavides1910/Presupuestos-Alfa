"use client";

import { useState, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Share2, Eye, Search, Receipt, Pencil, Upload, Download } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { formatCurrency, formatMonthYear } from "@/lib/utils/format";
import { companyDisplayName, EXPENSE_BUDGET_LINES, EXPENSE_BUDGET_LINE_LABELS } from "@/lib/utils/constants";
import { useCompanies } from "@/lib/hooks/use-companies";
import { canManageExpenses as userCanManageExpenses } from "@/lib/permissions";
import type { ExpenseBudgetLine, ExpenseType } from "@prisma/client";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Contract {
  id: string; licitacionNo: string; client: string; company: string;
  status: string; endDate: string;
}
interface Distribution {
  contractId: string; licitacionNo: string; client: string; company: string;
  equivalencePct: number; allocatedAmount: number;
}
interface ExpenseOrigin { id: string; name: string; isActive: boolean; sortOrder: number; }
interface Expense {
  id: string; type: ExpenseType; budgetLine?: ExpenseBudgetLine | null;
  description: string; amount: number;
  periodMonth: string; isDeferred: boolean; isDistributed: boolean;
  contractId?: string; positionId?: string; originId?: string; referenceNumber?: string;
  company?: string; notes?: string; createdAt: string;
  contract?: { id: string; licitacionNo: string; client: string; company: string } | null;
  position?: { id: string; name: string } | null;
  origin?: { id: string; name: string } | null;
  createdBy?: { name: string };
}

// ── Constants ─────────────────────────────────────────────────────────────────
const EXPENSE_TYPES: { value: ExpenseType; label: string; color: string }[] = [
  { value: "APERTURA",  label: "Apertura",       color: "bg-blue-100 text-blue-800" },
  { value: "UNIFORMS",  label: "Uniformes",       color: "bg-purple-100 text-purple-800" },
  { value: "AUDIT",     label: "Auditoría",       color: "bg-orange-100 text-orange-800" },
  { value: "ADMIN",     label: "Administrativo",  color: "bg-slate-100 text-slate-700" },
  { value: "TRANSPORT", label: "Transporte",      color: "bg-cyan-100 text-cyan-800" },
  { value: "FUEL",      label: "Combustible",     color: "bg-yellow-100 text-yellow-800" },
  { value: "PHONES",    label: "Teléfonos",       color: "bg-green-100 text-green-800" },
  { value: "PLANILLA",  label: "Planilla",        color: "bg-emerald-100 text-emerald-800" },
  { value: "OTHER",     label: "Otros",           color: "bg-gray-100 text-gray-700" },
];

function typeInfo(t: ExpenseType) {
  return EXPENSE_TYPES.find(e => e.value === t) ?? EXPENSE_TYPES[EXPENSE_TYPES.length - 1];
}

function budgetLineLabel(b: ExpenseBudgetLine | null | undefined) {
  if (!b) return "—";
  return EXPENSE_BUDGET_LINE_LABELS[b];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const DEFAULT_EXPENSE_LIST_URL = "/api/expenses?pageSize=200";

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ExpensesPageClient({ initialExpenses }: { initialExpenses: Expense[] }) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canEdit = session?.user?.role ? userCanManageExpenses(session.user.role) : false;
  const { data: companiesRes } = useCompanies();
  const companyRows = companiesRes?.data ?? [];
  const activeCompanies = companyRows.filter((c) => c.isActive);
  const expenseFileRef = useRef<HTMLInputElement>(null);
  const [expenseImporting, setExpenseImporting] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterCompany, setFilterCompany] = useState<string>("all");

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [previewExpense, setPreviewExpense] = useState<Expense | null>(null);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [editForm, setEditForm] = useState({
    type: "OTHER" as ExpenseType,
    budgetLine: "LABOR" as ExpenseBudgetLine,
    company: "",
    description: "",
    originId: "",
    referenceNumber: "",
    notes: "",
  });

  // Form state
  const [form, setForm] = useState({
    type: "OTHER" as ExpenseType,
    budgetLine: "" as ExpenseBudgetLine | "",
    description: "",
    amount: "",
    periodMonth: currentMonth(),
    mode: "contract" as "contract" | "deferred",
    contractId: "",
    positionId: "",
    originId: "",
    referenceNumber: "",
    company: "",
    notes: "",
    /** Prorrateo del monto en N meses (solo contrato específico) */
    spreadMonths: 1,
  });
  const [contractSearch, setContractSearch] = useState("");
  const [contractFocused, setContractFocused] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────
  // Nota: no usar el nombre `params` (reservado para props de Page en Next.js 15).
  const expenseListUrl = useMemo(() => {
    const sp = new URLSearchParams({ pageSize: "200" });
    if (filterType !== "all") sp.set("type", filterType);
    if (filterCompany !== "all") sp.set("company", filterCompany);
    return `/api/expenses?${sp.toString()}`;
  }, [filterType, filterCompany]);

  const { data, isLoading: expensesLoading, isError, error, refetch } = useQuery<{ data: Expense[] }>({
    queryKey: ["expenses", expenseListUrl],
    queryFn: async () => {
      const res = await fetch(expenseListUrl, { credentials: "same-origin" });
      const json = (await res.json()) as { data?: Expense[]; error?: { message?: string } };
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `Error al cargar gastos (${res.status})`);
      }
      return json as { data: Expense[] };
    },
    initialData: expenseListUrl === DEFAULT_EXPENSE_LIST_URL ? { data: initialExpenses } : undefined,
  });

  const { data: contractsData } = useQuery<{ data: Contract[] }>({
    queryKey: ["contracts-assignable"],
    queryFn: () => fetch("/api/contracts?pageSize=200&assignable=true").then(r => r.json()),
    staleTime: 60000,
  });

  const { data: originsData } = useQuery<{ data: ExpenseOrigin[] }>({
    queryKey: ["expense-origins"],
    queryFn: () => fetch("/api/admin/catalogs/origins").then(r => r.json()),
    staleTime: 300000,
  });

  const { data: positionsData } = useQuery<{ data: { id: string; name: string; shift?: string | null; location?: string | null }[] }>({
    queryKey: ["positions-for-expense", form.contractId],
    queryFn: () => fetch(`/api/contracts/${form.contractId}/positions`).then(r => r.json()),
    enabled: form.mode === "contract" && !!form.contractId,
  });

  const { data: previewData, isLoading: previewLoading } = useQuery<{ data: Distribution[] }>({
    queryKey: ["expense-preview", previewExpense?.id],
    queryFn: () => fetch(`/api/expenses/${previewExpense!.id}/distribute`).then(r => r.json()),
    enabled: !!previewExpense,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await r.json()) as { data?: { count?: number }; error?: { message?: string } };
      if (!r.ok) {
        throw new Error(json?.error?.message ?? "Error al crear gasto");
      }
      return json;
    },
    onSuccess: (res) => {
      const count = res.data?.count ?? 1;
      toast.success(count > 1 ? `Se registraron ${count} cuotas mensuales` : "Gasto registrado");
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["profitability"] });
      qc.invalidateQueries({ queryKey: ["traffic-light"] });
      setShowForm(false);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message || "Error al guardar"),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      fetch(`/api/expenses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) {
        toast.error(res.error?.message ?? "Error al actualizar");
        return;
      }
      toast.success("Gasto actualizado");
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["profitability"] });
      qc.invalidateQueries({ queryKey: ["traffic-light"] });
      qc.invalidateQueries({ queryKey: ["contract-expenses"] });
      setEditExpense(null);
    },
    onError: () => toast.error("Error al actualizar"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/expenses/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => {
      toast.success("Gasto eliminado");
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["profitability"] });
      qc.invalidateQueries({ queryKey: ["traffic-light"] });
    },
    onError: () => toast.error("Error al eliminar"),
  });

  const distributeMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/expenses/${id}/distribute`, { method: "POST" }).then(r => r.json()),
    onSuccess: () => {
      toast.success("Gasto distribuido correctamente");
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["profitability"] });
      qc.invalidateQueries({ queryKey: ["traffic-light"] });
      setPreviewExpense(null);
    },
    onError: () => toast.error("Error al distribuir"),
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function resetForm() {
    setForm({ type: "OTHER", budgetLine: "", description: "", amount: "", periodMonth: currentMonth(), mode: "contract", contractId: "", positionId: "", originId: "", referenceNumber: "", company: "", notes: "", spreadMonths: 1 });
    setContractSearch("");
  }

  function openEdit(e: Expense) {
    setEditExpense(e);
    setEditForm({
      type: e.type,
      budgetLine: e.budgetLine ?? "LABOR",
      company: e.company ?? "",
      description: e.description,
      originId: e.originId ?? "",
      referenceNumber: e.referenceNumber ?? "",
      notes: e.notes ?? "",
    });
  }

  function handleSaveEdit() {
    if (!editExpense) return;
    if (!editForm.description.trim()) {
      toast.error("Ingrese una descripción");
      return;
    }
    updateMutation.mutate({
      id: editExpense.id,
      body: {
        type: editForm.type,
        budgetLine: editForm.budgetLine,
        company: editForm.company || null,
        description: editForm.description.trim(),
        originId: editForm.originId || null,
        referenceNumber: editForm.referenceNumber.trim() || null,
        notes: editForm.notes.trim() || null,
      },
    });
  }

  function handleSubmit() {
    if (!form.budgetLine) { toast.error("Seleccione la partida (mano de obra, insumos, administrativo o utilidad)"); return; }
    if (!form.company) { toast.error("Seleccione la empresa a la que pertenece el gasto"); return; }
    if (!form.description.trim()) { toast.error("Ingrese una descripción"); return; }
    if (!form.amount || parseFloat(form.amount) <= 0) { toast.error("Ingrese un monto válido"); return; }
    if (form.mode === "contract" && !form.contractId) { toast.error("Seleccione un contrato"); return; }
    const spreadMonths =
      form.mode === "contract"
        ? Math.min(60, Math.max(1, Math.floor(Number(form.spreadMonths)) || 1))
        : 1;
    if (form.mode === "contract" && spreadMonths > 1) {
      const total = parseFloat(form.amount);
      if (!Number.isFinite(total) || total <= 0) {
        toast.error("Ingrese un monto válido para prorratear");
        return;
      }
    }

    createMutation.mutate({
      type: form.type,
      budgetLine: form.budgetLine,
      company: form.company,
      description: form.description.trim(),
      amount: parseFloat(form.amount),
      periodMonth: form.periodMonth,
      contractId: form.mode === "contract" ? form.contractId : undefined,
      positionId: form.mode === "contract" && form.positionId ? form.positionId : undefined,
      originId: form.originId || undefined,
      referenceNumber: form.referenceNumber.trim() || undefined,
      isDeferred: form.mode === "deferred",
      notes: form.notes.trim() || undefined,
      spreadMonths,
    });
  }

  // ── Filtered contracts for search ──────────────────────────────────────────
  // The API already filters by assignable=true (server-side, timezone-aware)
  const allContracts = contractsData?.data ?? [];

  const filteredContracts = allContracts.filter(c => {
    const q = contractSearch.toLowerCase();
    return !q || c.licitacionNo.toLowerCase().includes(q) || c.client.toLowerCase().includes(q) || c.company.toLowerCase().includes(q);
  }).slice(0, 20);

  // ── Filtered expenses ──────────────────────────────────────────────────────
  const expenses = (data?.data ?? []).filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return e.description.toLowerCase().includes(q)
      || e.contract?.client?.toLowerCase().includes(q)
      || e.contract?.licitacionNo?.toLowerCase().includes(q);
  });

  // ── Totals ─────────────────────────────────────────────────────────────────
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  async function downloadExpenseTemplate() {
    const res = await fetch("/api/import/expenses", { credentials: "same-origin" });
    if (!res.ok) {
      toast.error("No se pudo descargar la plantilla");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "plantilla_importar_gastos.xlsx";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function onExpenseFileSelected(f: File | null) {
    if (!f) return;
    setExpenseImporting(true);
    try {
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch("/api/import/expenses", { method: "POST", body: fd, credentials: "same-origin" });
      const json = (await res.json()) as {
        data?: { created?: number; errors?: { sheetRow: number; message: string }[]; message?: string };
        error?: { message?: string };
      };
      if (!res.ok) {
        toast.error(json.error?.message ?? "Error al importar");
        return;
      }
      const d = json.data;
      const createdN = d?.created ?? 0;
      const errLines =
        d?.errors && d.errors.length > 0
          ? d.errors
              .slice(0, 100)
              .map((e) => `Fila ${e.sheetRow}: ${e.message}`)
              .join("\n") +
              (d.errors.length > 100 ? `\n… y ${d.errors.length - 100} más.` : "")
          : "";
      const errHint =
        errLines !== ""
          ? `\n\n— «Fila N» es el número de fila en su Excel (la fila 1 son los títulos).`
          : "";
      if (createdN > 0) {
        toast.success(
          d?.message ?? `Se registraron ${createdN} movimiento(s).`,
          errLines ? `${errLines}${errHint}` : undefined,
          errLines ? { durationMs: 90_000, copyable: true } : undefined
        );
      } else if (errLines) {
        toast.error("No se importaron gastos", `${errLines}${errHint}`, {
          durationMs: 90_000,
          copyable: true,
        });
      } else {
        toast.info("Importación", d?.message ?? "Sin filas nuevas.");
      }
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["profitability"] });
      qc.invalidateQueries({ queryKey: ["traffic-light"] });
    } finally {
      setExpenseImporting(false);
      if (expenseFileRef.current) expenseFileRef.current.value = "";
    }
  }

  return (
    <>
      <Topbar title="Registro de Gastos" />
      <div className="p-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Gastos</h2>
            <p className="text-sm text-slate-500">
              {expensesLoading ? (
                "Cargando totales…"
              ) : (
                <>
                  {expenses.length} registros · Total: <span className="font-semibold text-slate-700">{formatCurrency(total)}</span>
                </>
              )}
            </p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={expenseFileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => onExpenseFileSelected(e.target.files?.[0] ?? null)}
              />
              <Button type="button" variant="outline" className="gap-2" onClick={downloadExpenseTemplate}>
                <Download className="h-4 w-4" />
                Plantilla Excel
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={expenseImporting}
                onClick={() => expenseFileRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                {expenseImporting ? "Importando…" : "Importar Excel"}
              </Button>
              <Button className="gap-2" onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4" /> Agregar Gasto
              </Button>
            </div>
          )}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input placeholder="Buscar por descripción o contrato..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tipos</SelectItem>
                  {EXPENSE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterCompany} onValueChange={setFilterCompany}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Empresa" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {companyRows.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {expensesLoading ? (
              <div className="p-12 text-center text-slate-400">Cargando gastos...</div>
            ) : isError ? (
              <div className="p-12 text-center space-y-3">
                <p className="text-red-600">
                  {error instanceof Error ? error.message : "No se pudieron cargar los gastos"}
                </p>
                <Button type="button" variant="outline" onClick={() => refetch()}>
                  Reintentar
                </Button>
              </div>
            ) : expenses.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <Receipt className="h-10 w-10 mx-auto mb-3 opacity-30" />
                No hay gastos registrados
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Tipo</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Partida</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Empresa</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Descripción</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Origen / Ref.</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Contrato / Empresa</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Período</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Registrado</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Monto</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Estado</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {expenses.map(e => {
                      const ti = typeInfo(e.type);
                      return (
                        <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ti.color}`}>
                              {ti.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600 text-xs">
                            {budgetLineLabel(e.budgetLine)}
                          </td>
                          <td className="px-4 py-3 text-slate-600 text-xs">
                            {e.company ? companyDisplayName(e.company, companyRows) : "—"}
                          </td>
                          <td className="px-4 py-3 max-w-xs">
                            <div className="font-medium text-slate-800 truncate">{e.description}</div>
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
                          <td className="px-4 py-3">
                            {e.contract ? (
                              <div>
                                <div className="font-medium text-slate-700">{e.contract.client}</div>
                                <div className="text-xs text-slate-400">{e.contract.licitacionNo} · {companyDisplayName(e.contract.company, companyRows)}</div>
                                {e.position && <div className="text-xs text-blue-500 mt-0.5">Puesto: {e.position.name}</div>}
                              </div>
                            ) : e.isDeferred ? (
                              <div>
                                <Badge variant="outline">Todos los contratos</Badge>
                                <div className="text-xs text-slate-400 mt-0.5">Diferido grupal</div>
                              </div>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
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
                          <td className="px-4 py-3 text-right font-semibold text-slate-800">
                            {formatCurrency(e.amount)}
                          </td>
                          <td className="px-4 py-3">
                            {e.isDeferred ? (
                              e.isDistributed
                                ? <Badge variant="success">Distribuido</Badge>
                                : <Badge variant="warning">Pendiente</Badge>
                            ) : (
                              <Badge variant="secondary">Directo</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 justify-end">
                              {canEdit && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="text-slate-600 hover:text-blue-600 hover:bg-blue-50"
                                  title="Editar tipo, descripción u origen"
                                  onClick={() => openEdit(e)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {canEdit && e.isDeferred && !e.isDistributed && (
                                <Button
                                  size="sm" variant="outline"
                                  className="gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                                  onClick={() => setPreviewExpense(e)}
                                >
                                  <Share2 className="h-3 w-3" /> Distribuir
                                </Button>
                              )}
                              {e.isDeferred && e.isDistributed && (
                                <Button size="sm" variant="ghost" onClick={() => setPreviewExpense(e)}>
                                  <Eye className="h-3 w-3" />
                                </Button>
                              )}
                              {canEdit && !e.isDistributed && (
                                <Button
                                  size="sm" variant="ghost"
                                  className="text-red-500 hover:bg-red-50"
                                  onClick={() => {
                                    if (confirm("¿Eliminar este gasto?")) deleteMutation.mutate(e.id);
                                  }}
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
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Edit Expense Modal ───────────────────────────────────────────────── */}
      <Dialog open={!!editExpense} onOpenChange={(v) => { if (!v) setEditExpense(null); }}>
        <DialogContent className="max-w-lg max-h-[min(92vh,880px)] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <div className="shrink-0 px-6 pt-6 pb-2 pr-12">
            <DialogHeader>
              <DialogTitle>Editar gasto</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-slate-500 mt-2">
              Corrija el tipo, la partida, la empresa, la descripción, el origen o la referencia si se registraron mal.
              {editExpense?.isDistributed ? " Este gasto ya está distribuido; solo se actualizan estos datos de clasificación." : ""}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-2">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Partida</label>
                <Select
                  value={editForm.budgetLine}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, budgetLine: v as ExpenseBudgetLine }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_BUDGET_LINES.map((bl) => (
                      <SelectItem key={bl} value={bl}>{EXPENSE_BUDGET_LINE_LABELS[bl]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Empresa</label>
                <Select
                  value={editForm.company || "none"}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, company: v === "none" ? "" : v }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sin especificar —</SelectItem>
                    {activeCompanies.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Tipo de gasto</label>
              <Select value={editForm.type} onValueChange={(v) => setEditForm((f) => ({ ...f, type: v as ExpenseType }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mr-2 ${t.color}`}>{t.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Origen</label>
                <Select value={editForm.originId || "none"} onValueChange={(v) => setEditForm((f) => ({ ...f, originId: v === "none" ? "" : v }))}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Origen..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sin especificar —</SelectItem>
                    {(originsData?.data ?? []).filter((o) => o.isActive).map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">N° Referencia</label>
                <Input
                  placeholder="Factura, OC..."
                  value={editForm.referenceNumber}
                  onChange={(e) => setEditForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Descripción</label>
              <Input
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Notas (opcional)</label>
              <Input
                placeholder="Detalles adicionales..."
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          </div>
          <div className="shrink-0 border-t border-slate-200 bg-background px-6 py-4">
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setEditExpense(null)}>Cancelar</Button>
              <Button onClick={handleSaveEdit} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add Expense Modal ────────────────────────────────────────────────── */}
      <Dialog open={showForm && canEdit} onOpenChange={v => { if (!v) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-w-lg max-h-[min(92vh,880px)] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <div className="shrink-0 px-6 pt-6 pb-2 pr-12">
            <DialogHeader>
              <DialogTitle>Agregar Gasto</DialogTitle>
            </DialogHeader>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-2">
          <div className="space-y-4">
            {/* Type */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Tipo de gasto</label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as ExpenseType }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mr-2 ${t.color}`}>{t.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Partida + Empresa del gasto */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Partida</label>
                <Select
                  value={form.budgetLine || "none"}
                  onValueChange={(v) => setForm((f) => ({ ...f, budgetLine: v === "none" ? "" : (v as ExpenseBudgetLine) }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Partida presupuestaria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Seleccione —</SelectItem>
                    {EXPENSE_BUDGET_LINES.map((bl) => (
                      <SelectItem key={bl} value={bl}>{EXPENSE_BUDGET_LINE_LABELS[bl]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-400">Alinea el gasto con la distribución del contrato.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Empresa</label>
                <Select
                  value={form.company || "none"}
                  onValueChange={(v) => setForm((f) => ({ ...f, company: v === "none" ? "" : v }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Empresa del gasto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Seleccione —</SelectItem>
                    {activeCompanies.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-400">Empresa a la que se imputa este gasto.</p>
              </div>
            </div>

            {/* Origin + Reference */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Origen</label>
                <Select value={form.originId || "none"} onValueChange={v => setForm(f => ({ ...f, originId: v === "none" ? "" : v }))}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Seleccionar origen..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sin especificar —</SelectItem>
                    {(originsData?.data ?? []).filter(o => o.isActive).map(o => (
                      <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">N° Referencia</label>
                <Input
                  placeholder="Factura, OC, transferencia..."
                  value={form.referenceNumber}
                  onChange={e => setForm(f => ({ ...f, referenceNumber: e.target.value }))}
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Descripción</label>
              <Input
                placeholder="Ej: Compra de uniformes octubre, Mantenimiento radio..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {/* Amount + Period */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Monto (₡)</label>
                <Input
                  type="number" min="0" step="100"
                  placeholder="0"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Período</label>
                <Input
                  type="month"
                  value={form.periodMonth}
                  onChange={e => setForm(f => ({ ...f, periodMonth: e.target.value }))}
                />
              </div>
            </div>

            {/* Mode toggle */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Asignar a</label>
              <div className="flex rounded-md border overflow-hidden">
                <button
                  type="button"
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${form.mode === "contract" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                  onClick={() => setForm(f => ({ ...f, mode: "contract" }))}
                >
                  Contrato específico
                </button>
                <button
                  type="button"
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${form.mode === "deferred" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                  onClick={() => setForm(f => ({ ...f, mode: "deferred", contractId: "", positionId: "", spreadMonths: 1 }))}
                >
                  Diferido (todos los contratos)
                </button>
              </div>
            </div>

            {/* Contract selector */}
            {form.mode === "contract" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Contrato *</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    className={`pl-9 ${form.contractId ? "border-green-400 bg-green-50" : ""}`}
                    placeholder="Escriba para buscar por licitación, cliente o empresa..."
                    value={contractSearch}
                    onFocus={() => setContractFocused(true)}
                    onBlur={() => setTimeout(() => setContractFocused(false), 150)}
                    onChange={e => {
                      setContractSearch(e.target.value);
                      setForm(f => ({ ...f, contractId: "", positionId: "" }));
                    }}
                  />
                </div>
                {/* Dropdown: show when focused OR when typing and no contract selected yet */}
                {(contractFocused || (contractSearch && !form.contractId)) && (
                  <div className="border rounded-md max-h-48 overflow-y-auto divide-y shadow-sm">
                    {filteredContracts.length === 0 ? (
                      <div className="p-3 text-sm text-slate-400">Sin resultados para "{contractSearch}"</div>
                    ) : filteredContracts.map(c => (
                      <button
                        key={c.id} type="button"
                        className={`w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 transition-colors ${form.contractId === c.id ? "bg-blue-50 text-blue-700" : ""}`}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          setForm(f => ({ ...f, contractId: c.id, company: c.company, positionId: "" }));
                          setContractSearch(`${c.licitacionNo} — ${c.client}`);
                          setContractFocused(false);
                        }}
                      >
                        <div className="font-medium text-slate-800">{c.client}</div>
                        <div className="text-xs text-slate-400">{c.licitacionNo} · {companyDisplayName(c.company, companyRows)}</div>
                      </button>
                    ))}
                  </div>
                )}
                {form.contractId
                  ? <p className="text-xs text-green-600 font-medium">✓ Contrato seleccionado</p>
                  : <p className="text-xs text-slate-400">Escriba para buscar y haga clic para seleccionar</p>
                }
              </div>
            )}

            {/* Position selector — shown when a contract is selected */}
            {form.mode === "contract" && form.contractId && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Puesto <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                {(positionsData?.data ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">Este contrato no tiene puestos definidos. <a href={`/contracts/${form.contractId}`} className="text-blue-600 hover:underline" target="_blank">Agregar puestos</a></p>
                ) : (
                  <Select
                    value={form.positionId || "none"}
                    onValueChange={v => setForm(f => ({ ...f, positionId: v === "none" ? "" : v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Asignar a puesto específico..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Sin puesto (contrato general) —</SelectItem>
                      {(positionsData?.data ?? []).map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}{p.shift ? ` · ${p.shift}` : ""}{p.location ? ` · ${p.location}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Prorrateo en meses (mismo contrato) */}
            {form.mode === "contract" && form.contractId && (
              <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                <label className="text-sm font-medium text-slate-700">Prorrateo en meses</label>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    className="w-24 h-9"
                    value={form.spreadMonths}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setForm((f) => ({
                        ...f,
                        spreadMonths: Number.isFinite(v) ? Math.min(60, Math.max(1, v)) : 1,
                      }));
                    }}
                  />
                  <span className="text-sm text-slate-600">
                    {form.spreadMonths <= 1
                      ? "Un solo mes (período indicado arriba)."
                      : `El monto total se divide en ${form.spreadMonths} cuotas iguales desde el período seleccionado.`}
                  </span>
                </div>
                {form.spreadMonths > 1 && form.amount && parseFloat(form.amount) > 0 && (
                  <p className="text-xs text-slate-500">
                    ≈ {formatCurrency(parseFloat(form.amount) / form.spreadMonths)} por mes (ajuste por redondeo en la última cuota si aplica).
                  </p>
                )}
              </div>
            )}

            {/* Deferred info */}
            {form.mode === "deferred" && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
                <p className="font-medium mb-0.5">Gasto diferido</p>
                <p className="text-blue-600 text-xs">Este gasto se distribuirá proporcionalmente entre <strong>todos los contratos activos</strong> del grupo, según el número de puestos de cada contrato.</p>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Notas (opcional)</label>
              <Input
                placeholder="Detalles adicionales..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-background px-6 py-4">
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancelar</Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Guardando..." : "Guardar Gasto"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Distribution Preview Modal ───────────────────────────────────────── */}
      <Dialog open={!!previewExpense} onOpenChange={v => { if (!v) setPreviewExpense(null); }}>
        <DialogContent className="max-w-2xl max-h-[min(90vh,900px)] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <div className="px-6 pt-6 pb-4 shrink-0">
            <DialogHeader>
              <DialogTitle>
                {previewExpense?.isDistributed ? "Detalle de distribución" : "Distribuir gasto proporcionalmente"}
              </DialogTitle>
            </DialogHeader>
          </div>

          {previewExpense && (
            <div className="flex-1 min-h-0 overflow-y-auto px-6 space-y-4 pb-4">
              <div className="bg-slate-50 rounded-lg p-4 grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-slate-500">Descripción:</span> <span className="font-medium ml-1">{previewExpense.description}</span></div>
                <div><span className="text-slate-500">Monto:</span> <span className="font-semibold ml-1">{formatCurrency(previewExpense.amount)}</span></div>
                <div><span className="text-slate-500">Empresa:</span> <span className="font-medium ml-1">{previewExpense.company ? companyDisplayName(previewExpense.company, companyRows) : "—"}</span></div>
                <div><span className="text-slate-500">Período:</span> <span className="font-medium ml-1">{formatMonthYear(previewExpense.periodMonth)}</span></div>
              </div>

              {previewLoading ? (
                <div className="text-center py-6 text-slate-400">Calculando distribución...</div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b">
                        <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Contrato</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Empresa</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-slate-600">Equiv. %</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-slate-600">Monto asignado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(previewData?.data ?? []).map(d => (
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
                    <tfoot>
                      <tr className="border-t bg-slate-50">
                        <td colSpan={2} className="px-4 py-2.5 font-semibold text-slate-700">Total</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-600">
                          {((previewData?.data ?? []).reduce((s, d) => s + d.equivalencePct, 0) * 100).toFixed(2)}%
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-slate-900">
                          {formatCurrency((previewData?.data ?? []).reduce((s, d) => s + d.allocatedAmount, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="shrink-0 border-t bg-background px-6 py-4">
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setPreviewExpense(null)}>Cerrar</Button>
              {canEdit && previewExpense && !previewExpense.isDistributed && (
                <Button
                  onClick={() => distributeMutation.mutate(previewExpense.id)}
                  disabled={distributeMutation.isPending || previewLoading}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {distributeMutation.isPending ? "Distribuyendo..." : "Confirmar distribución"}
                </Button>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
