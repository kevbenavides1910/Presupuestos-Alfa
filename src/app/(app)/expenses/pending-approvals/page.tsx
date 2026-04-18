"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/ui/toaster";
import { formatCurrency, formatMonthYear } from "@/lib/utils/format";
import { companyDisplayName } from "@/lib/utils/constants";
import { useCompanies } from "@/lib/hooks/use-companies";
import { exportRowsToExcel } from "@/lib/utils/excel-export";
import { FileSpreadsheet } from "lucide-react";
import {
  DeferredContractSelector,
  draftFromServer,
  type DeferredContractDraft,
} from "@/components/expenses/DeferredContractSelector";
import type { ExpenseApprovalDecision, ExpenseApprovalStatus, ExpenseType } from "@prisma/client";

interface PendingExpense {
  id: string;
  sequentialNo?: number | null;
  type: ExpenseType;
  description: string;
  amount: number;
  periodMonth: string;
  company?: string | null;
  approvalStatus: ExpenseApprovalStatus;
  currentApprovalStep: number | null;
  requiredApprovalSteps: number;
  isDeferred: boolean;
  deferredIncludeContractIds?: string[];
  registroCxp?: string | null;
  registroTr?: string | null;
  createdBy?: { id: string; name: string; email: string };
  contract?: { licitacionNo: string; client: string; company: string } | null;
  origin?: { name: string } | null;
  approvals: Array<{
    id: string;
    stepOrder: number;
    decision: ExpenseApprovalDecision;
    comment: string | null;
    decidedAt: string;
    approver: { id: string; name: string };
  }>;
  attachments?: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    note: string | null;
    createdAt: string;
    uploadedBy: { id: string; name: string };
    downloadUrl: string;
  }>;
}

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

function formatSequentialNo(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `#${String(n).padStart(5, "0")}`;
}

interface ExpenseDetail {
  id: string;
  isDeferred: boolean;
  approvalStatus: ExpenseApprovalStatus;
  deferredIncludeContractIds?: string[];
  amount: number;
  distributions: Array<{
    contractId: string;
    equivalencePct: number;
    allocatedAmount: number;
    contract?: { licitacionNo: string; client: string } | null;
  }>;
}

interface AssignableContract {
  id: string;
  licitacionNo: string;
  client: string;
  company: string;
  status: string;
}

const TYPE_LABEL: Partial<Record<ExpenseType, string>> = {
  APERTURA: "Apertura",
  UNIFORMS: "Uniformes",
  AUDIT: "Auditoría",
  ADMIN: "Administrativo",
  TRANSPORT: "Transporte",
  FUEL: "Combustible",
  PHONES: "Teléfonos",
  PLANILLA: "Planilla",
  OTHER: "Otros",
};

export default function PendingApprovalsPage() {
  const qc = useQueryClient();
  const { data: companiesRes } = useCompanies();
  const companyRows = companiesRes?.data ?? [];

  const { data, isLoading } = useQuery<{ data: PendingExpense[] }>({
    queryKey: ["expenses-pending-approvals"],
    queryFn: async () => {
      const r = await fetch("/api/expenses/pending-approvals", { credentials: "same-origin" });
      const json = (await r.json()) as { data?: PendingExpense[]; error?: { message?: string } };
      if (!r.ok) throw new Error(json.error?.message ?? "Error al cargar");
      return json as { data: PendingExpense[] };
    },
  });

  const [dialogExpense, setDialogExpense] = useState<PendingExpense | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<PreviewableAttachment | null>(null);
  const [comment, setComment] = useState("");
  const [uploadNote, setUploadNote] = useState("");
  const [distributionDraft, setDistributionDraft] = useState<DeferredContractDraft>("all");

  // Contratos activos para el selector de reparto
  const { data: contractsRes } = useQuery<{ data: AssignableContract[] }>({
    queryKey: ["contracts", "assignable"],
    queryFn: async () => {
      const r = await fetch("/api/contracts?pageSize=200&assignable=true", { credentials: "same-origin" });
      const j = (await r.json()) as { data?: AssignableContract[] };
      return { data: j.data ?? [] };
    },
  });
  const assignableContracts = useMemo(
    () => (contractsRes?.data ?? []).filter((c) => c.status === "ACTIVE" || c.status === "PROLONGATION"),
    [contractsRes?.data]
  );
  const assignableIds = useMemo(() => assignableContracts.map((c) => c.id), [assignableContracts]);

  // Detalle del gasto abierto en el diálogo (para ver distribuciones)
  const { data: detail, refetch: refetchDetail } = useQuery<ExpenseDetail | null>({
    queryKey: ["expense-detail-approval", dialogExpense?.id],
    queryFn: async (): Promise<ExpenseDetail | null> => {
      if (!dialogExpense) return null;
      const r = await fetch(`/api/expenses/${dialogExpense.id}`, { credentials: "same-origin" });
      const j = (await r.json()) as { data?: ExpenseDetail; error?: { message?: string } };
      if (!r.ok || !j.data) throw new Error(j.error?.message ?? "Error al cargar detalle");
      return j.data;
    },
    enabled: !!dialogExpense,
  });

  // Sincroniza el draft con lo que trae el detalle
  useEffect(() => {
    if (!dialogExpense?.isDeferred) return;
    setDistributionDraft(draftFromServer(detail?.deferredIncludeContractIds));
  }, [dialogExpense?.id, dialogExpense?.isDeferred, detail?.deferredIncludeContractIds]);

  const approveMutation = useMutation({
    mutationFn: async (payload: { id: string; decision: "APPROVED" | "REJECTED"; comment?: string }) => {
      const r = await fetch(`/api/expenses/${payload.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: payload.decision, comment: payload.comment }),
      });
      const json = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) throw new Error(json.error?.message ?? "Error al registrar decisión");
      return json;
    },
    onSuccess: () => {
      toast.success("Decisión registrada");
      setDialogExpense(null);
      setComment("");
      qc.invalidateQueries({ queryKey: ["expenses-pending-approvals"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveDistributionMutation = useMutation({
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
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expenses-pending-approvals"] });
      qc.invalidateQueries({ queryKey: ["expense-detail"] });
      qc.invalidateQueries({ queryKey: ["profitability"] });
      qc.invalidateQueries({ queryKey: ["traffic-light"] });
      qc.invalidateQueries({ queryKey: ["contract-deferred-expenses"] });
    },
    onError: (e: Error) => toast.error(e.message || "Error al guardar"),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ id, file, note }: { id: string; file: File; note: string | null }) => {
      const fd = new FormData();
      fd.set("file", file);
      if (note) fd.set("note", note);
      const r = await fetch(`/api/expenses/${id}/attachments`, { method: "POST", body: fd, credentials: "same-origin" });
      const json = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) throw new Error(json.error?.message ?? "Error al subir archivo");
      return json;
    },
    onSuccess: () => {
      toast.success("Archivo adjuntado");
      setUploadNote("");
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expenses-pending-approvals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = data?.data ?? [];

  function handleExport() {
    const exportRows = rows.map((e) => {
      const done = e.approvals.filter((a) => a.decision === "APPROVED").length;
      return {
        "N°": e.sequentialNo != null ? `#${String(e.sequentialNo).padStart(5, "0")}` : "",
        Tipo: TYPE_LABEL[e.type] ?? e.type,
        Descripción: e.description,
        "Creado por": e.createdBy?.name ?? "",
        Empresa: e.company ? companyDisplayName(e.company, companyRows) : "",
        Contrato: e.contract?.licitacionNo ?? (e.isDeferred ? "Diferido" : ""),
        Cliente: e.contract?.client ?? "",
        Origen: e.origin?.name ?? "",
        Período: formatMonthYear(e.periodMonth),
        Monto: e.amount,
        "Reparto": e.isDeferred ? "Diferido" : "Directo",
        "Paso actual": e.currentApprovalStep ?? "",
        "Pasos requeridos": e.requiredApprovalSteps,
        "Decididos": done,
        "Registro CXP": e.registroCxp ?? "",
        "Registro TR": e.registroTr ?? "",
        "Adjuntos": e.attachments?.length ?? 0,
      };
    });
    exportRowsToExcel({
      filename: "aprobaciones_pendientes",
      sheetName: "Pendientes",
      rows: exportRows,
      columnWidths: [10, 14, 36, 22, 14, 22, 28, 18, 12, 14, 14, 14, 16, 12, 16, 16, 10],
    });
  }

  return (
    <>
      <Topbar title="Aprobaciones pendientes" />
      <div className="p-6 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            Gastos que requieren su aprobación en el paso actual del flujo. Aquí puede revisar el historial, adjuntar documentos y aprobar o rechazar.
          </p>
          <Button
            type="button"
            variant="outline"
            className="gap-2 shrink-0"
            onClick={handleExport}
            disabled={rows.length === 0}
            title="Descargar las aprobaciones pendientes a Excel"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Exportar a Excel ({rows.length})
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center text-slate-400">Cargando…</div>
            ) : rows.length === 0 ? (
              <div className="p-12 text-center text-slate-500">No tiene aprobaciones pendientes.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">N°</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Tipo</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Descripción</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Empresa</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Período</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Monto</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Progreso</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((e) => {
                      const done = e.approvals.filter((a) => a.decision === "APPROVED").length;
                      return (
                        <tr key={e.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-mono text-xs text-slate-600">{formatSequentialNo(e.sequentialNo)}</td>
                          <td className="px-4 py-3 text-xs font-medium">{TYPE_LABEL[e.type] ?? e.type}</td>
                          <td className="px-4 py-3 max-w-xs">
                            <div className="font-medium text-slate-800 truncate">{e.description}</div>
                            <div className="text-xs text-slate-400">
                              {e.createdBy?.name ?? "—"} · {e.contract ? `${e.contract.licitacionNo}` : e.isDeferred ? "Diferido" : "—"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {e.company ? companyDisplayName(e.company, companyRows) : "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{formatMonthYear(e.periodMonth)}</td>
                          <td className="px-4 py-3 text-right font-semibold">{formatCurrency(e.amount)}</td>
                          <td className="px-4 py-3">
                            <Badge variant="warning">
                              Paso {e.currentApprovalStep ?? "—"} de {e.requiredApprovalSteps} · {done} decidido(s)
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button size="sm" variant="outline" onClick={() => setDialogExpense(e)}>
                              Revisar / Aprobar
                            </Button>
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

      <Dialog open={!!dialogExpense} onOpenChange={(v) => !v && setDialogExpense(null)}>
        <DialogContent className={cn("max-h-[90vh] overflow-y-auto", dialogExpense?.isDeferred ? "max-w-2xl" : "max-w-lg")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>Revisar gasto</span>
              {dialogExpense?.sequentialNo != null && (
                <span className="text-xs font-mono text-slate-500 font-normal">
                  {formatSequentialNo(dialogExpense.sequentialNo)}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {dialogExpense && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 text-slate-700">
                <div>
                  <span className="text-slate-500">Monto:</span>{" "}
                  <strong>{formatCurrency(dialogExpense.amount)}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Período:</span> {formatMonthYear(dialogExpense.periodMonth)}
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500">Descripción:</span> {dialogExpense.description}
                </div>
                {(dialogExpense.registroCxp || dialogExpense.registroTr) && (
                  <div className="col-span-2 space-y-1 border rounded p-2 bg-slate-50">
                    {dialogExpense.registroCxp && (
                      <div>
                        <span className="text-slate-500">Registro 1 CXP:</span> {dialogExpense.registroCxp}
                      </div>
                    )}
                    {dialogExpense.registroTr && (
                      <div>
                        <span className="text-slate-500">Registro 2 TR:</span> {dialogExpense.registroTr}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {dialogExpense.isDeferred && detail && dialogExpense.approvalStatus !== "REJECTED" && (
                <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm">
                  <div>
                    <p className="font-medium text-blue-900">Reparto del gasto diferido</p>
                    <p className="text-xs text-blue-800">
                      Este gasto ya impacta el presupuesto de los contratos marcados. Puede modificar la
                      selección antes de aprobar o rechazar; al guardar, se recalcula la distribución
                      proporcional según el presupuesto de insumos de cada contrato.
                    </p>
                  </div>

                  {detail.distributions.length > 0 && (
                    <div className="rounded-md border bg-white">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="text-left px-3 py-2 font-semibold">Contrato</th>
                            <th className="text-right px-3 py-2 font-semibold">%</th>
                            <th className="text-right px-3 py-2 font-semibold">Monto asignado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {detail.distributions.map((d) => (
                            <tr key={d.contractId}>
                              <td className="px-3 py-1.5">
                                <div className="font-medium text-slate-800">
                                  {d.contract?.client ?? "—"}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {d.contract?.licitacionNo ?? d.contractId}
                                </div>
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {(d.equivalencePct * 100).toFixed(2)}%
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                                {formatCurrency(d.allocatedAmount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-medium text-slate-700 mb-1">
                      Contratos incluidos en el reparto
                    </p>
                    <DeferredContractSelector
                      contracts={assignableContracts}
                      allIds={assignableIds}
                      draft={distributionDraft}
                      onChange={setDistributionDraft}
                      companyRows={companyRows}
                      listClassName="max-h-40 overflow-y-auto space-y-2 rounded-md border p-2 bg-white"
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (distributionDraft !== "all" && distributionDraft.length === 0) {
                          toast.error("Seleccione al menos un contrato para el reparto");
                          return;
                        }
                        const contractIds =
                          distributionDraft === "all" ? [] : distributionDraft;
                        saveDistributionMutation.mutate({
                          id: dialogExpense.id,
                          contractIds,
                        });
                      }}
                      disabled={
                        saveDistributionMutation.isPending ||
                        (distributionDraft !== "all" && distributionDraft.length === 0)
                      }
                    >
                      {saveDistributionMutation.isPending ? "Guardando…" : "Guardar reparto"}
                    </Button>
                  </div>
                </div>
              )}

              <div>
                <p className="font-medium text-slate-800 mb-2">Historial de aprobaciones</p>
                <ul className="space-y-2 text-xs border rounded p-3 bg-slate-50 max-h-40 overflow-y-auto">
                  {dialogExpense.approvals.length === 0 ? (
                    <li className="text-slate-500">Ninguna decisión previa.</li>
                  ) : (
                    dialogExpense.approvals.map((a) => (
                      <li key={a.id}>
                        <strong>Paso {a.stepOrder}</strong> · {a.approver.name} ·{" "}
                        {a.decision === "APPROVED" ? "Aprobado" : "Rechazado"}
                        {a.comment ? ` — ${a.comment}` : ""}
                        <span className="text-slate-400"> ({new Date(a.decidedAt).toLocaleString("es-CR")})</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div className="space-y-2 rounded-lg border bg-white p-3 text-sm">
                <p className="font-medium text-slate-800">Documentación del gasto</p>
                {dialogExpense.attachments && dialogExpense.attachments.length > 0 ? (
                  <ul className="text-xs space-y-1">
                    {dialogExpense.attachments.map((att) => {
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
                  <p className="text-xs text-slate-500">El solicitante no adjuntó documentación.</p>
                )}
                <div className="pt-2 border-t space-y-2">
                  <p className="text-xs font-medium text-slate-700">Agregar otro adjunto</p>
                  <Input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.xls,.csv"
                    onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      if (!f) return;
                      uploadMutation.mutate({ id: dialogExpense.id, file: f, note: uploadNote || null });
                      ev.target.value = "";
                    }}
                  />
                  <Input
                    placeholder="Nota del adjunto (opcional)"
                    value={uploadNote}
                    onChange={(e) => setUploadNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="font-medium text-slate-800">Comentario (opcional)</p>
                <textarea
                  className={cn(
                    "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                    "ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  )}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder="Motivo del rechazo o nota interna…"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button variant="outline" onClick={() => setDialogExpense(null)}>
              Cerrar
            </Button>
            <Button
              variant="destructive"
              disabled={!dialogExpense || approveMutation.isPending}
              onClick={() =>
                dialogExpense &&
                approveMutation.mutate({ id: dialogExpense.id, decision: "REJECTED", comment: comment.trim() || undefined })
              }
            >
              Rechazar
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              disabled={!dialogExpense || approveMutation.isPending}
              onClick={() =>
                dialogExpense &&
                approveMutation.mutate({ id: dialogExpense.id, decision: "APPROVED", comment: comment.trim() || undefined })
              }
            >
              Aprobar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!previewAttachment}
        onOpenChange={(o) => { if (!o) setPreviewAttachment(null); }}
      >
        <DialogContent className="max-w-5xl w-[95vw] p-0 overflow-hidden">
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle className="flex items-center justify-between gap-3 pr-6">
              <span className="truncate text-sm font-medium" title={previewAttachment?.fileName}>
                {previewAttachment?.fileName ?? "Previsualización"}
              </span>
              {previewAttachment && (
                <a
                  href={previewAttachment.downloadUrl}
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
            {previewAttachment && isPdf(previewAttachment.mimeType, previewAttachment.fileName) && (
              <iframe
                src={`${previewAttachment.downloadUrl}?inline=1`}
                title={previewAttachment.fileName}
                className="w-full h-full bg-white"
              />
            )}
            {previewAttachment && isImage(previewAttachment.mimeType, previewAttachment.fileName) && (
              <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${previewAttachment.downloadUrl}?inline=1`}
                  alt={previewAttachment.fileName}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
