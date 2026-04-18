"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Eye, Search, Receipt, Pencil, Upload, Download, Paperclip, X } from "lucide-react";
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
import {
  DeferredContractSelector,
  type DeferredContractDraft,
} from "@/components/expenses/DeferredContractSelector";
import { canManageExpenses as userCanManageExpenses } from "@/lib/permissions";
import type { ExpenseApprovalStatus, ExpenseBudgetLine, ExpenseType } from "@prisma/client";
import * as XLSX from "xlsx";

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
type ExpenseDetailDto = {
  id: string;
  deferredIncludeContractIds?: string[];
  registroCxp?: string | null;
  registroTr?: string | null;
  approvals: Array<{
    id: string;
    stepOrder: number;
    decision: string;
    comment: string | null;
    decidedAt: string;
    approver: { name: string };
  }>;
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    downloadUrl: string;
    createdAt: string;
    uploadedBy: { name: string };
    note: string | null;
  }>;
};

type PreviewableAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  downloadUrl: string;
};

function isPdf(mime: string | undefined, fileName: string) {
  if (mime && mime.toLowerCase() === "application/pdf") return true;
  return fileName.toLowerCase().endsWith(".pdf");
}

function isImage(mime: string | undefined, fileName: string) {
  if (mime && mime.toLowerCase().startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);
}

function isPreviewable(mime: string | undefined, fileName: string) {
  return isPdf(mime, fileName) || isImage(mime, fileName);
}

interface Expense {
  id: string; sequentialNo?: number | null; type: ExpenseType; budgetLine?: ExpenseBudgetLine | null;
  description: string; amount: number;
  periodMonth: string; isDeferred: boolean; isDistributed: boolean;
  deferredIncludeContractIds?: string[];
  contractId?: string; positionId?: string; originId?: string; referenceNumber?: string;
  company?: string; notes?: string; createdAt: string;
  approvalStatus?: ExpenseApprovalStatus;
  currentApprovalStep?: number | null;
  requiredApprovalSteps?: number;
  registroCxp?: string | null;
  registroTr?: string | null;
  contract?: { id: string; licitacionNo: string; client: string; company: string } | null;
  position?: { id: string; name: string; location?: { name: string } | null } | null;
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

function formatSequentialNo(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `#${String(n).padStart(5, "0")}`;
}

function approvalBadge(e: Expense) {
  const st = e.approvalStatus ?? "APPROVED";
  const req = e.requiredApprovalSteps ?? 0;
  if (req <= 0 || st === "APPROVED") {
    return <Badge variant="success">Compra confirmada</Badge>;
  }
  if (st === "REJECTED") return <Badge variant="destructive">Rechazado</Badge>;
  if (st === "PENDING_APPROVAL") {
    return (
      <Badge variant="warning">
        Pendiente ({e.currentApprovalStep ?? 1}/{req})
      </Badge>
    );
  }
  if (st === "PARTIALLY_APPROVED") {
    return (
      <Badge variant="warning">
        En aprobación ({e.currentApprovalStep ?? "—"}/{req})
      </Badge>
    );
  }
  return <Badge variant="secondary">{st}</Badge>;
}

function AttachmentPreviewDialog({
  attachment,
  onOpenChange,
}: {
  attachment: PreviewableAttachment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = !!attachment;
  const inlineUrl = attachment ? `${attachment.downloadUrl}?inline=1` : "";
  const pdf = attachment ? isPdf(attachment.mimeType, attachment.fileName) : false;
  const img = attachment ? isImage(attachment.mimeType, attachment.fileName) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="flex items-center justify-between gap-3 pr-6">
            <span className="truncate text-sm font-medium" title={attachment?.fileName}>
              {attachment?.fileName ?? "Previsualización"}
            </span>
            {attachment && (
              <a
                href={attachment.downloadUrl}
                className="text-xs text-blue-600 hover:underline shrink-0"
                target="_blank"
                rel="noreferrer"
              >
                Descargar
              </a>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="bg-slate-100" style={{ height: "80vh" }}>
          {attachment && pdf && (
            <iframe
              src={inlineUrl}
              title={attachment.fileName}
              className="w-full h-full bg-white"
            />
          )}
          {attachment && img && (
            <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={inlineUrl}
                alt={attachment.fileName}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}
          {attachment && !pdf && !img && (
            <div className="w-full h-full flex items-center justify-center text-sm text-slate-500">
              No hay previsualización disponible para este formato.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const DEFAULT_EXPENSE_LIST_URL = "/api/expenses?pageSize=200";

const ATTACH_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.xls,.csv";
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

async function uploadExpenseAttachments(expenseIds: string[], files: File[]): Promise<void> {
  if (files.length === 0 || expenseIds.length === 0) return;
  const targets = expenseIds.length > 1 ? [expenseIds[0]!] : expenseIds;
  for (const expenseId of targets) {
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(`«${file.name}» supera el máximo de 15 MB`);
      }
      const fd = new FormData();
      fd.set("file", file);
      const r = await fetch(`/api/expenses/${expenseId}/attachments`, {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const j = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) throw new Error(j.error?.message ?? `No se pudo subir «${file.name}»`);
    }
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ExpensesPageClient({ initialExpenses }: { initialExpenses: Expense[] }) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canEdit = session?.user?.role ? userCanManageExpenses(session.user.role) : false;
  const { data: companiesRes } = useCompanies();
  const companyRows = companiesRes?.data ?? [];
  const activeCompanies = companyRows.filter((c) => c.isActive);
  const expenseFileRef = useRef<HTMLInputElement>(null);
  const addExpenseAttachRef = useRef<HTMLInputElement>(null);
  const [expenseImporting, setExpenseImporting] = useState(false);
  /** Archivos a subir después de crear el gasto (modal Agregar) */
  const [addExpenseFiles, setAddExpenseFiles] = useState<File[]>([]);

  // Filters
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterCompany, setFilterCompany] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [previewExpense, setPreviewExpense] = useState<Expense | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<PreviewableAttachment | null>(null);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [editForm, setEditForm] = useState({
    type: "OTHER" as ExpenseType,
    budgetLine: "LABOR" as ExpenseBudgetLine,
    company: "",
    description: "",
    originId: "",
    referenceNumber: "",
    notes: "",
    registroCxp: "",
    registroTr: "",
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
    registroCxp: "",
    registroTr: "",
    /** Prorrateo del monto en N meses (solo contrato específico) */
    spreadMonths: 1,
  });
  /** Reparto diferido al crear: "all" = todos los contratos activos; si no, solo los IDs listados. */
  const [createDeferredDraft, setCreateDeferredDraft] = useState<DeferredContractDraft>("all");
  /** Borrador en el modal de detalle / reparto */
  const [distributionDraft, setDistributionDraft] = useState<DeferredContractDraft>("all");
  const [contractSearch, setContractSearch] = useState("");
  const [contractFocused, setContractFocused] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────
  // Nota: no usar el nombre `params` (reservado para props de Page en Next.js 15).
  const expenseListUrl = useMemo(() => {
    const sp = new URLSearchParams({ pageSize: "200" });
    if (filterType !== "all") sp.set("type", filterType);
    if (filterCompany !== "all") sp.set("company", filterCompany);
    if (filterStatus !== "all") sp.set("approvalStatus", filterStatus);
    return `/api/expenses?${sp.toString()}`;
  }, [filterType, filterCompany, filterStatus]);

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

  const { data: positionsData } = useQuery<{
    data: { id: string; name: string; label: string; locationName: string; shifts: { label: string | null; hours: number }[] }[];
  }>({
    queryKey: ["positions-for-expense", form.contractId],
    queryFn: () => fetch(`/api/contracts/${form.contractId}/positions`).then((r) => r.json()),
    enabled: form.mode === "contract" && !!form.contractId,
  });

  const { data: previewData, isLoading: previewLoading } = useQuery<{ data: Distribution[] }>({
    queryKey: ["expense-preview", previewExpense?.id, distributionDraft],
    queryFn: async () => {
      const id = previewExpense!.id;
      const sp = new URLSearchParams();
      if (distributionDraft !== "all" && distributionDraft.length > 0) {
        sp.set("contractIds", distributionDraft.join(","));
      }
      const q = sp.toString();
      const r = await fetch(`/api/expenses/${id}/distribute${q ? `?${q}` : ""}`, {
        credentials: "same-origin",
      });
      return r.json();
    },
    enabled:
      !!previewExpense &&
      previewExpense.isDeferred &&
      (previewExpense.approvalStatus ?? "APPROVED") !== "REJECTED",
  });

  const { data: previewDetail, refetch: refetchPreviewDetail } = useQuery({
    queryKey: ["expense-detail", previewExpense?.id],
    queryFn: async (): Promise<ExpenseDetailDto> => {
      const r = await fetch(`/api/expenses/${previewExpense!.id}`, { credentials: "same-origin" });
      const j = (await r.json()) as { data?: ExpenseDetailDto; error?: { message?: string } };
      if (!r.ok || !j.data) throw new Error(j.error?.message ?? "Error al cargar detalle");
      return j.data;
    },
    enabled: !!previewExpense,
  });

  const allContracts = contractsData?.data ?? [];
  const deferredAssignableContracts = useMemo(
    () => allContracts.filter((c) => c.status === "ACTIVE" || c.status === "PROLONGATION"),
    [allContracts]
  );
  const deferredAssignableIds = useMemo(
    () => deferredAssignableContracts.map((c) => c.id),
    [deferredAssignableContracts]
  );

  useEffect(() => {
    if (!previewExpense?.isDeferred) return;
    setDistributionDraft("all");
  }, [previewExpense?.id, previewExpense?.isDeferred]);

  useEffect(() => {
    if (!previewExpense?.isDeferred || !previewDetail) return;
    const ids = previewDetail.deferredIncludeContractIds;
    if (ids === undefined) return;
    if (ids.length > 0) setDistributionDraft(ids);
    else setDistributionDraft("all");
  }, [previewExpense?.id, previewExpense?.isDeferred, previewDetail?.deferredIncludeContractIds]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (payload: { body: Record<string, unknown>; files: File[] }) => {
      const { body, files } = payload;
      const r = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      const json = (await r.json()) as {
        data?: { count?: number; expenses?: { id: string }[] };
        error?: { message?: string };
      };
      if (!r.ok) {
        throw new Error(json?.error?.message ?? "Error al crear gasto");
      }
      const ids = json.data?.expenses?.map((e) => e.id).filter(Boolean) ?? [];
      let uploadWarning: string | null = null;
      if (files.length > 0 && ids.length > 0) {
        try {
          await uploadExpenseAttachments(ids, files);
        } catch (e) {
          uploadWarning = e instanceof Error ? e.message : "Error al subir adjuntos";
        }
      }
      return {
        json,
        uploadWarning,
        createdCount: json.data?.count ?? Math.max(1, ids.length),
      };
    },
    onSuccess: (res) => {
      const count = res.createdCount;
      if (res.uploadWarning) {
        toast.error("Gasto guardado, pero hubo un problema con los archivos", res.uploadWarning, { durationMs: 12_000 });
      } else {
        toast.success(count > 1 ? `Se registraron ${count} cuotas mensuales` : "Gasto registrado");
      }
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

  const saveDeferredTargetsMutation = useMutation({
    mutationFn: async ({ id, contractIds }: { id: string; contractIds: string[] }) => {
      const r = await fetch(`/api/expenses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deferredIncludeContractIds: contractIds }),
        credentials: "same-origin",
      });
      const json = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) throw new Error(json.error?.message ?? "Error al guardar el reparto");
      return json;
    },
    onSuccess: () => {
      toast.success("Reparto actualizado");
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense-preview"] });
      qc.invalidateQueries({ queryKey: ["expense-detail"] });
      qc.invalidateQueries({ queryKey: ["profitability"] });
      qc.invalidateQueries({ queryKey: ["traffic-light"] });
      qc.invalidateQueries({ queryKey: ["contract-deferred-expenses"] });
    },
    onError: (e: Error) => toast.error(e.message || "Error al guardar"),
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function resetForm() {
    setForm({
      type: "OTHER",
      budgetLine: "",
      description: "",
      amount: "",
      periodMonth: currentMonth(),
      mode: "contract",
      contractId: "",
      positionId: "",
      originId: "",
      referenceNumber: "",
      company: "",
      notes: "",
      registroCxp: "",
      registroTr: "",
      spreadMonths: 1,
    });
    setCreateDeferredDraft("all");
    setContractSearch("");
    setAddExpenseFiles([]);
    if (addExpenseAttachRef.current) addExpenseAttachRef.current.value = "";
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
      registroCxp: e.registroCxp ?? "",
      registroTr: e.registroTr ?? "",
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
        registroCxp: editForm.registroCxp.trim() || null,
        registroTr: editForm.registroTr.trim() || null,
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
    if (form.mode === "deferred") {
      if (createDeferredDraft !== "all" && createDeferredDraft.length === 0) {
        toast.error("Seleccione al menos un contrato para el reparto");
        return;
      }
    }

    createMutation.mutate({
      body: {
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
        registroCxp: form.registroCxp.trim() || undefined,
        registroTr: form.registroTr.trim() || undefined,
        spreadMonths,
        ...(form.mode === "deferred"
          ? {
              deferredIncludeContractIds:
                createDeferredDraft === "all" ? [] : createDeferredDraft,
            }
          : {}),
      },
      files: addExpenseFiles,
    });
  }

  // ── Filtered contracts for search ──────────────────────────────────────────
  // The API already filters by assignable=true (server-side, timezone-aware)

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

  function approvalStatusLabel(e: Expense): string {
    const st = e.approvalStatus ?? "APPROVED";
    const req = e.requiredApprovalSteps ?? 0;
    if (req <= 0 || st === "APPROVED") return "Aprobado";
    if (st === "REJECTED") return "Rechazado";
    if (st === "PENDING_APPROVAL")
      return `Pendiente (${e.currentApprovalStep ?? 1}/${req})`;
    if (st === "PARTIALLY_APPROVED")
      return `Aprobado parcial (${e.currentApprovalStep ?? 0}/${req})`;
    return st;
  }

  function exportExpensesToExcel() {
    if (expenses.length === 0) {
      toast.info("No hay gastos para exportar");
      return;
    }

    const rows = expenses.map((e) => {
      const typeLabel = EXPENSE_TYPES.find((t) => t.value === e.type)?.label ?? e.type;
      const deferredScope =
        e.isDeferred
          ? e.deferredIncludeContractIds && e.deferredIncludeContractIds.length > 0
            ? `Diferido (${e.deferredIncludeContractIds.length} contratos)`
            : "Diferido (todos los contratos)"
          : "Contrato específico";

      return {
        "N°": formatSequentialNo(e.sequentialNo),
        Tipo: typeLabel,
        Partida: budgetLineLabel(e.budgetLine ?? null),
        Empresa: e.company ? companyDisplayName(e.company, companyRows) : "",
        Descripción: e.description,
        "Origen / Ref.": [e.origin?.name, e.referenceNumber].filter(Boolean).join(" · "),
        Contrato: e.contract?.client ?? "",
        "N° Licitación": e.contract?.licitacionNo ?? "",
        "Empresa contrato": e.contract?.company
          ? companyDisplayName(e.contract.company, companyRows)
          : "",
        Puesto: e.position?.name ?? "",
        Ubicación: e.position?.location?.name ?? "",
        "Tipo reparto": deferredScope,
        Período: formatMonthYear(e.periodMonth),
        Monto: e.amount,
        "Registro CXP": e.registroCxp ?? "",
        "Registro TR": e.registroTr ?? "",
        Estado: approvalStatusLabel(e),
        Registrado: new Date(e.createdAt).toLocaleString("es-CR"),
        "Creado por": e.createdBy?.name ?? "",
        Notas: e.notes ?? "",
      };
    });

    const totalRow: Record<string, string | number> = {
      "N°": "",
      Tipo: "",
      Partida: "",
      Empresa: "",
      Descripción: "TOTAL",
      "Origen / Ref.": "",
      Contrato: "",
      "N° Licitación": "",
      "Empresa contrato": "",
      Puesto: "",
      Ubicación: "",
      "Tipo reparto": "",
      Período: "",
      Monto: total,
      "Registro CXP": "",
      "Registro TR": "",
      Estado: "",
      Registrado: "",
      "Creado por": "",
      Notas: "",
    };
    const exportData = [...rows, totalRow];

    const ws = XLSX.utils.json_to_sheet(exportData);
    ws["!cols"] = [
      { wch: 9 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 36 },
      { wch: 22 }, { wch: 28 }, { wch: 22 }, { wch: 18 },
      { wch: 20 }, { wch: 20 }, { wch: 26 }, { wch: 12 },
      { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 22 },
      { wch: 20 }, { wch: 22 }, { wch: 30 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gastos");

    const stamp = new Date().toISOString().slice(0, 10);
    const parts = ["gastos", stamp];
    if (filterType !== "all") {
      const lbl = EXPENSE_TYPES.find((t) => t.value === filterType)?.label ?? filterType;
      parts.push(lbl.toLowerCase().replace(/\s+/g, "-"));
    }
    if (filterCompany !== "all") {
      parts.push(filterCompany.toLowerCase());
    }
    XLSX.writeFile(wb, `${parts.join("_")}.xlsx`);
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={exportExpensesToExcel}
              disabled={expenses.length === 0}
              title={
                expenses.length === 0
                  ? "No hay gastos para exportar"
                  : "Exportar a Excel los gastos visibles (aplicando filtros y búsqueda)"
              }
            >
              <Download className="h-4 w-4" />
              Exportar Excel
            </Button>
            {canEdit && (
              <>
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
              </>
            )}
          </div>
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
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Estado" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="PENDING">En aprobación</SelectItem>
                  <SelectItem value="APPROVED">Aprobados</SelectItem>
                  <SelectItem value="REJECTED">Rechazados</SelectItem>
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
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">N°</th>
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
                          <td className="px-4 py-3 font-mono text-xs text-slate-600">
                            {formatSequentialNo(e.sequentialNo)}
                          </td>
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
                                {e.position && (
                                  <div className="text-xs text-blue-500 mt-0.5">
                                    {e.position.location
                                      ? `${e.position.location.name} › ${e.position.name}`
                                      : `Puesto: ${e.position.name}`}
                                  </div>
                                )}
                              </div>
                            ) : e.isDeferred ? (
                              <div>
                                <Badge variant="outline">
                                  {e.deferredIncludeContractIds && e.deferredIncludeContractIds.length > 0
                                    ? `${e.deferredIncludeContractIds.length} contrato(s) en reparto`
                                    : "Todos los contratos activos"}
                                </Badge>
                                <div className="text-xs text-slate-400 mt-0.5">
                                  Diferido · impacto inmediato al presupuesto
                                </div>
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
                          <td className="px-4 py-3 space-y-1">
                            <div>{approvalBadge(e)}</div>
                            {e.isDeferred ? (
                              e.isDistributed ? (
                                <Badge variant="success">En presupuesto</Badge>
                              ) : (
                                <Badge variant="outline">Sin reparto (sin contratos elegibles)</Badge>
                              )
                            ) : (
                              <Badge variant="secondary">Directo</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 justify-end">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                title="Detalle, aprobaciones y adjuntos"
                                onClick={() => setPreviewExpense(e)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
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
                              {canEdit && (
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Registro 1 CXP</label>
                <Input
                  value={editForm.registroCxp}
                  onChange={(e) => setEditForm((f) => ({ ...f, registroCxp: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Registro 2 TR</label>
                <Input
                  value={editForm.registroTr}
                  onChange={(e) => setEditForm((f) => ({ ...f, registroTr: e.target.value }))}
                />
              </div>
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
                  onClick={() => {
                    setCreateDeferredDraft("all");
                    setForm((f) => ({ ...f, mode: "contract" }));
                  }}
                >
                  Contrato específico
                </button>
                <button
                  type="button"
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${form.mode === "deferred" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                  onClick={() => {
                    setCreateDeferredDraft("all");
                    setForm((f) => ({
                      ...f,
                      mode: "deferred",
                      contractId: "",
                      positionId: "",
                      spreadMonths: 1,
                    }));
                  }}
                >
                  Diferido (reparto entre contratos)
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
                  <p className="text-xs text-slate-400">
                    Este contrato no tiene puestos en ninguna ubicación.{" "}
                    <a href={`/contracts/${form.contractId}`} className="text-blue-600 hover:underline" target="_blank">
                      Agregar en Ubicaciones
                    </a>
                  </p>
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
                      {(positionsData?.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                          {p.shifts.length > 0
                            ? ` (${p.shifts.map((s) => (s.label ? `${s.label} ` : "") + `${s.hours}h`).join(", ")})`
                            : ""}
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

            {/* Deferred: contratos incluidos en el reparto */}
            {form.mode === "deferred" && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/80 p-3 text-sm space-y-2">
                <p className="font-medium text-blue-900">Gasto diferido</p>
                <p className="text-xs text-blue-800">
                  El monto <strong>entra de inmediato</strong> al presupuesto de los contratos marcados (proporcional al presupuesto de insumos). Si un aprobador rechaza el gasto, ese impacto se revierte.
                </p>
                <p className="text-xs font-medium text-slate-700">Contratos que reciben el reparto</p>
                <DeferredContractSelector
                  contracts={deferredAssignableContracts}
                  allIds={deferredAssignableIds}
                  draft={createDeferredDraft}
                  onChange={setCreateDeferredDraft}
                  companyRows={companyRows}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Registro 1 CXP (opcional)</label>
                <Input
                  placeholder="Referencia CXP…"
                  value={form.registroCxp}
                  onChange={(e) => setForm((f) => ({ ...f, registroCxp: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Registro 2 TR (opcional)</label>
                <Input
                  placeholder="Referencia TR…"
                  value={form.registroTr}
                  onChange={(e) => setForm((f) => ({ ...f, registroTr: e.target.value }))}
                />
              </div>
            </div>

            {/* Adjuntos (se suben al guardar, tras crear el gasto) */}
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-slate-500 shrink-0" />
                <label className="text-sm font-medium text-slate-700">Archivos adjuntos (opcional)</label>
              </div>
              <input
                ref={addExpenseAttachRef}
                type="file"
                multiple
                accept={ATTACH_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  setAddExpenseFiles((prev) => [...prev, ...picked]);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => addExpenseAttachRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                Elegir archivos
              </Button>
              {addExpenseFiles.length > 0 ? (
                <ul className="text-xs space-y-1.5 max-h-28 overflow-y-auto">
                  {addExpenseFiles.map((f, i) => (
                    <li
                      key={`${f.name}-${i}-${f.size}`}
                      className="flex items-center justify-between gap-2 rounded border bg-white px-2 py-1.5"
                    >
                      <span className="truncate text-slate-700" title={f.name}>
                        {f.name}
                        <span className="text-slate-400"> · {(f.size / 1024).toFixed(0)} KB</span>
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Quitar ${f.name}`}
                        onClick={() => setAddExpenseFiles((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">PDF, imágenes, Excel o CSV. Máx. 15 MB por archivo.</p>
              )}
              {form.mode === "contract" && form.spreadMonths > 1 && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                  Con prorrateo en varios meses, los adjuntos se asocian al <strong>primer</strong> mes generado;
                  puede abrir las demás cuotas desde la tabla y añadir más desde el detalle.
                </p>
              )}
            </div>

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
                {createMutation.isPending ? "Guardando…" : "Guardar Gasto"}
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
              <DialogTitle className="flex items-center gap-2">
                <span>
                  {previewExpense?.isDeferred ? "Gasto diferido — reparto y detalle" : "Detalle del gasto"}
                </span>
                {previewExpense?.sequentialNo != null && (
                  <span className="text-xs font-mono text-slate-500 font-normal">
                    {formatSequentialNo(previewExpense.sequentialNo)}
                  </span>
                )}
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
                <div className="col-span-2">{approvalBadge(previewExpense)}</div>
              </div>

              {previewExpense.isDeferred &&
                (previewExpense.approvalStatus ?? "APPROVED") !== "APPROVED" &&
                (previewExpense.approvalStatus ?? "APPROVED") !== "REJECTED" && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 text-blue-950 text-sm p-3">
                    Este gasto ya impacta el presupuesto según el reparto indicado. Los aprobadores pueden ver el efecto antes de confirmar. Si alguien rechaza el gasto, el impacto se revierte.
                  </div>
                )}

              {previewDetail?.registroCxp || previewDetail?.registroTr ? (
                <div className="rounded-lg border p-3 text-sm space-y-1 bg-white">
                  <p className="font-medium text-slate-800">Registros</p>
                  {previewDetail.registroCxp && (
                    <div>
                      <span className="text-slate-500">Registro 1 CXP:</span> {previewDetail.registroCxp}
                    </div>
                  )}
                  {previewDetail.registroTr && (
                    <div>
                      <span className="text-slate-500">Registro 2 TR:</span> {previewDetail.registroTr}
                    </div>
                  )}
                </div>
              ) : null}

              {previewDetail && previewDetail.approvals.length > 0 && (
                <div className="rounded-lg border p-3 text-sm bg-white">
                  <p className="font-medium text-slate-800 mb-2">Aprobaciones</p>
                  <ul className="space-y-1 text-xs text-slate-700">
                    {previewDetail.approvals.map((a) => (
                      <li key={a.id}>
                        Paso {a.stepOrder} · {a.approver.name} · {a.decision === "APPROVED" ? "Aprobado" : "Rechazado"}
                        {a.comment ? ` — ${a.comment}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-lg border p-3 text-sm space-y-2 bg-white">
                <p className="font-medium text-slate-800">Documentación</p>
                {previewDetail?.attachments?.length ? (
                  <ul className="text-xs space-y-1">
                    {previewDetail.attachments.map((att) => {
                      const canPreview = isPreviewable(att.mimeType, att.fileName);
                      return (
                        <li key={att.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {canPreview ? (
                            <button
                              type="button"
                              className="text-blue-600 hover:underline text-left"
                              onClick={() =>
                                setPreviewAttachment({
                                  id: att.id,
                                  fileName: att.fileName,
                                  mimeType: att.mimeType,
                                  downloadUrl: att.downloadUrl,
                                })
                              }
                              title="Previsualizar"
                            >
                              {att.fileName}
                            </button>
                          ) : (
                            <a
                              href={att.downloadUrl}
                              className="text-blue-600 hover:underline"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {att.fileName}
                            </a>
                          )}
                          {canPreview && (
                            <a
                              href={att.downloadUrl}
                              className="text-[11px] text-slate-500 hover:text-slate-700 hover:underline"
                              target="_blank"
                              rel="noreferrer"
                              title="Descargar"
                            >
                              descargar
                            </a>
                          )}
                          <span className="text-slate-400">· {att.uploadedBy.name}</span>
                          {att.note ? <span className="text-slate-500">— {att.note}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">Sin archivos adjuntos.</p>
                )}
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.xls,.csv"
                  className="text-xs w-full"
                  onChange={async (ev) => {
                    const f = ev.target.files?.[0];
                    if (!f) return;
                    const fd = new FormData();
                    fd.set("file", f);
                    const r = await fetch(`/api/expenses/${previewExpense.id}/attachments`, {
                      method: "POST",
                      body: fd,
                      credentials: "same-origin",
                    });
                    const j = (await r.json()) as { error?: { message?: string } };
                    if (!r.ok) {
                      toast.error(j.error?.message ?? "Error al subir");
                    } else {
                      toast.success("Archivo adjuntado");
                      refetchPreviewDetail();
                      qc.invalidateQueries({ queryKey: ["expenses"] });
                    }
                    ev.target.value = "";
                  }}
                />
              </div>

              {previewExpense.isDeferred && (previewExpense.approvalStatus ?? "APPROVED") !== "REJECTED" && (
                <>
                  <div className="rounded-lg border bg-white p-3 text-sm space-y-2">
                    <p className="font-medium text-slate-800">Contratos incluidos en el reparto</p>
                    <p className="text-xs text-slate-500">
                      Solo los marcados reciben el gasto. Los porcentajes suman 100 % entre los seleccionados (peso = presupuesto de insumos de cada contrato).
                    </p>
                    <DeferredContractSelector
                      contracts={deferredAssignableContracts}
                      allIds={deferredAssignableIds}
                      draft={distributionDraft}
                      onChange={setDistributionDraft}
                      companyRows={companyRows}
                      listClassName="max-h-40 overflow-y-auto space-y-2 rounded-md border p-2 bg-slate-50/80"
                    />
                  </div>
                  {previewLoading ? (
                    <div className="text-center py-6 text-slate-400">Calculando distribución...</div>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <p className="text-xs text-slate-500 px-3 py-2 bg-slate-50 border-b">
                        Vista del reparto (según selección arriba; guarde para aplicar cambios al presupuesto)
                      </p>
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
                </>
              )}
            </div>
          )}

          <div className="shrink-0 border-t bg-background px-6 py-4">
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setPreviewExpense(null)}>Cerrar</Button>
              {canEdit &&
                previewExpense &&
                previewExpense.isDeferred &&
                (previewExpense.approvalStatus ?? "APPROVED") !== "REJECTED" && (
                  <Button
                    onClick={() => {
                      if (distributionDraft !== "all" && distributionDraft.length === 0) {
                        toast.error("Seleccione al menos un contrato para el reparto");
                        return;
                      }
                      const ids = distributionDraft === "all" ? [] : distributionDraft;
                      saveDeferredTargetsMutation.mutate({
                        id: previewExpense.id,
                        contractIds: ids,
                      });
                    }}
                    disabled={
                      saveDeferredTargetsMutation.isPending ||
                      previewLoading ||
                      (distributionDraft !== "all" && distributionDraft.length === 0)
                    }
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {saveDeferredTargetsMutation.isPending ? "Guardando…" : "Guardar reparto"}
                  </Button>
                )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <AttachmentPreviewDialog
        attachment={previewAttachment}
        onOpenChange={(open) => { if (!open) setPreviewAttachment(null); }}
      />
    </>
  );
}
