"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, CheckCircle2, Clock, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { rhfValueAsNumber } from "@/lib/rhf-safe-number";
import { auditFindingSchema, type AuditFindingInput } from "@/lib/validations/expense.schema";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { AUDIT_ITEMS } from "@/lib/utils/constants";
import { format } from "date-fns";

interface Finding {
  id: string; contractId: string; postName: string; findingDate: string;
  totalCost: number; status: "PENDING" | "COMPLETED"; notes?: string;
  radioQty: number; radioCost: number; handcuffsQty: number; handcuffsCost: number;
  umbrellaQty: number; umbrellaCost: number; blackjackQty: number; blackjackCost: number;
  flashlightQty: number; flashlightCost: number; otherQty: number; otherCost: number;
}

export function AuditFindingsTab({ contractId }: { contractId: string }) {
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ data: Finding[] }>({
    queryKey: ["audit-findings", contractId],
    queryFn: () => fetch(`/api/contracts/${contractId}/audit-findings`).then((r) => r.json()),
  });

  const findings = (data?.data ?? []).filter((f) =>
    statusFilter === "all" ? true : f.status === statusFilter
  );

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<AuditFindingInput>({
    resolver: zodResolver(auditFindingSchema),
    defaultValues: {
      contractId,
      findingDate: format(new Date(), "yyyy-MM-dd"),
    },
  });

  // Live total
  const values = watch();
  let liveTotal = 0;
  for (const item of AUDIT_ITEMS) {
    liveTotal += (Number(values[item.qtyKey as keyof typeof values] ?? 0)) *
                 (Number(values[item.costKey as keyof typeof values] ?? 0));
  }

  const createMutation = useMutation({
    mutationFn: (data: AuditFindingInput) =>
      fetch(`/api/contracts/${contractId}/audit-findings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit-findings", contractId] });
      queryClient.invalidateQueries({ queryKey: ["profitability", contractId] });
      toast.success("Hallazgo registrado");
      setOpen(false);
      reset();
    },
    onError: () => toast.error("Error al registrar hallazgo"),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      fetch(`/api/contracts/${contractId}/audit-findings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit-findings", contractId] });
      queryClient.invalidateQueries({ queryKey: ["profitability", contractId] });
      toast.success("Estado actualizado");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/contracts/${contractId}/audit-findings/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit-findings", contractId] });
      queryClient.invalidateQueries({ queryKey: ["profitability", contractId] });
      toast.success("Hallazgo eliminado");
    },
  });

  const pendingTotal = (data?.data ?? [])
    .filter((f) => f.status === "PENDING")
    .reduce((s, f) => s + f.totalCost, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-slate-800">Hallazgos de Auditoría</h3>
          {pendingTotal > 0 && (
            <Badge variant="warning">
              Impacto al presupuesto: {formatCurrency(pendingTotal)}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-md overflow-hidden text-sm">
            {["all", "PENDING", "COMPLETED"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 transition-colors ${
                  statusFilter === s ? "bg-blue-600 text-white" : "hover:bg-slate-50 text-slate-600"
                }`}
              >
                {s === "all" ? "Todos" : s === "PENDING" ? "Pendientes" : "Completados"}
              </button>
            ))}
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Registrar Hallazgo
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center text-slate-400 py-8">Cargando...</div>
      ) : findings.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-slate-400">
            No hay hallazgos {statusFilter !== "all" ? "con este estado" : "registrados"}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {findings.map((f) => (
            <Card key={f.id} className={f.status === "COMPLETED" ? "opacity-70" : ""}>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {f.status === "PENDING" ? (
                    <Clock className="h-5 w-5 text-orange-500 shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                  )}
                  <div>
                    <div className="text-sm font-medium">{f.postName}</div>
                    <div className="text-xs text-slate-400">{formatDate(f.findingDate)}</div>
                    {f.notes && <div className="text-xs text-slate-500 mt-0.5">{f.notes}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-semibold ${f.status === "PENDING" ? "text-red-600" : "text-slate-400 line-through"}`}>
                    {formatCurrency(f.totalCost)}
                  </span>
                  <Badge variant={f.status === "PENDING" ? "warning" : "success"}>
                    {f.status === "PENDING" ? "Pendiente" : "Completado"}
                  </Badge>
                  {f.status === "PENDING" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-green-600 hover:bg-green-50"
                      onClick={() => statusMutation.mutate({ id: f.id, status: "COMPLETED" })}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-400 hover:text-red-600"
                    onClick={() => {
                      if (confirm("¿Eliminar este hallazgo?")) deleteMutation.mutate(f.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add finding dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Registrar Hallazgo de Auditoría</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Puesto Auditado *</Label>
                <Input {...register("postName")} placeholder="Puesto Principal" />
                {errors.postName && <p className="text-xs text-red-600">{errors.postName.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Fecha del Hallazgo</Label>
                <Input type="date" {...register("findingDate")} />
              </div>
            </div>

            <table className="w-full text-sm border rounded-md overflow-hidden">
              <thead>
                <tr className="bg-slate-50 border-b">
                  <th className="text-left px-3 py-2">Artículo</th>
                  <th className="text-right px-3 py-2 w-24">Cantidad</th>
                  <th className="text-right px-3 py-2 w-36">Costo (₡)</th>
                  <th className="text-right px-3 py-2 w-28">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {AUDIT_ITEMS.map((item) => {
                  const qty = Number(watch(item.qtyKey as keyof AuditFindingInput) ?? 0);
                  const cost = Number(watch(item.costKey as keyof AuditFindingInput) ?? 0);
                  return (
                    <tr key={item.key} className="border-b">
                      <td className="px-3 py-2">{item.label}</td>
                      <td className="px-3 py-2">
                        <Input type="number" min="0" className="h-7 text-right"
                          {...register(item.qtyKey as keyof AuditFindingInput, { setValueAs: rhfValueAsNumber })} />
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min="0" className="h-7 text-right"
                          {...register(item.costKey as keyof AuditFindingInput, { setValueAs: rhfValueAsNumber })} />
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {qty * cost > 0 ? formatCurrency(qty * cost) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t font-bold bg-slate-50">
                  <td colSpan={3} className="px-3 py-2 text-right">Total:</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(liveTotal)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Input {...register("notes")} placeholder="Observaciones adicionales..." />
            </div>
            <div className="space-y-1.5">
              <Label>Otros artículos</Label>
              <Input {...register("otherDesc")} placeholder="Descripción..." />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Registrar Hallazgo
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
