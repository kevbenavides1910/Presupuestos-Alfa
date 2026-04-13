"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Send, Eye, Loader2, CheckCircle2 } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { deferredExpenseSchema, type DeferredExpenseInput } from "@/lib/validations/expense.schema";
import { formatCurrency, formatDate, formatMonthYear, fromMonthString, toMonthString } from "@/lib/utils/format";
import { companyDisplayName, EXPENSE_CATEGORY_LABELS } from "@/lib/utils/constants";
import { useCompanies } from "@/lib/hooks/use-companies";

interface DeferredExpense {
  id: string; company: string; description: string; category: string;
  totalAmount: number; periodMonth: string; isDistributed: boolean; createdAt: string;
  distributions: { contractId: string; allocatedAmount: number; contract: { licitacionNo: string; client: string } }[];
}

interface DistributionPreview {
  contractId: string; licitacionNo: string; client: string;
  equivalencePct: number; allocatedAmount: number;
}

export default function DeferredExpensesPage() {
  const [open, setOpen] = useState(false);
  const [previewExpenseId, setPreviewExpenseId] = useState<string | null>(null);
  const [selectedCompany, setSelectedCompany] = useState("all");
  const queryClient = useQueryClient();
  const { data: companiesRes } = useCompanies();
  const companyRows = companiesRes?.data ?? [];
  const activeCompanies = companyRows.filter((c) => c.isActive);

  const params = selectedCompany !== "all" ? `?company=${selectedCompany}` : "";

  const { data, isLoading } = useQuery<{ data: DeferredExpense[] }>({
    queryKey: ["deferred-expenses", selectedCompany],
    queryFn: () => fetch(`/api/expenses/deferred${params}`).then((r) => r.json()),
  });

  const { data: previewData, isLoading: previewLoading } = useQuery<{ data: DistributionPreview[] }>({
    queryKey: ["distribution-preview", previewExpenseId],
    queryFn: () => fetch(`/api/expenses/deferred/${previewExpenseId}/distribute`).then((r) => r.json()),
    enabled: !!previewExpenseId,
  });

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<DeferredExpenseInput>({
    resolver: zodResolver(deferredExpenseSchema),
    defaultValues: { periodMonth: toMonthString(new Date()), category: "OTHER" },
  });

  const createMutation = useMutation({
    mutationFn: (data: DeferredExpenseInput) =>
      fetch("/api/expenses/deferred", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deferred-expenses"] });
      toast.success("Gasto diferido registrado");
      setOpen(false);
      reset();
    },
    onError: () => toast.error("Error al registrar gasto"),
  });

  const distributeMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/expenses/deferred/${id}/distribute`, { method: "POST" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deferred-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["profitability"] });
      toast.success("Distribución completada exitosamente");
      setPreviewExpenseId(null);
    },
    onError: (e: Error) => toast.error("Error", e.message),
  });

  const expenses = data?.data ?? [];

  return (
    <>
      <Topbar title="Gastos Diferidos" />
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Gastos Diferidos</h2>
            <p className="text-sm text-slate-500">Gastos distribuibles proporcionalmente entre contratos</p>
          </div>
          <Button className="gap-2" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Nuevo Gasto Diferido
          </Button>
        </div>

        {/* Filter */}
        <Card>
          <CardContent className="p-4">
            <Select value={selectedCompany} onValueChange={setSelectedCompany}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filtrar por empresa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las empresas</SelectItem>
                {companyRows.map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* List */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-slate-400">Cargando...</div>
            ) : expenses.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No hay gastos diferidos registrados</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Descripción</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Empresa</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Categoría</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Período</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Monto</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Estado</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {expenses.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{e.description}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">{companyDisplayName(e.company, companyRows)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {EXPENSE_CATEGORY_LABELS[e.category as keyof typeof EXPENSE_CATEGORY_LABELS]}
                      </td>
                      <td className="px-4 py-3 text-slate-500 capitalize">
                        {formatMonthYear(e.periodMonth)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(e.totalAmount)}</td>
                      <td className="px-4 py-3">
                        {e.isDistributed ? (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Distribuido
                          </Badge>
                        ) : (
                          <Badge variant="warning">Pendiente</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {e.isDistributed && (
                            <Button variant="ghost" size="sm" onClick={() => setPreviewExpenseId(e.id)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                          {!e.isDistributed && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-blue-600 hover:bg-blue-50"
                              onClick={() => setPreviewExpenseId(e.id)}
                            >
                              <Send className="h-3.5 w-3.5" />
                              Distribuir
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* New expense dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Gasto Diferido</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Empresa *</Label>
              <Select onValueChange={(v) => setValue("company", v as never)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  {activeCompanies.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.company && <p className="text-xs text-red-600">{errors.company.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Descripción *</Label>
              <Input {...register("description")} placeholder="Mantenimiento vehículos Q4..." />
              {errors.description && <p className="text-xs text-red-600">{errors.description.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Categoría *</Label>
                <Select defaultValue="OTHER" onValueChange={(v) => setValue("category", v as never)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EXPENSE_CATEGORY_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Período (mes) *</Label>
                <Input type="month" {...register("periodMonth")} />
                {errors.periodMonth && <p className="text-xs text-red-600">{errors.periodMonth.message}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Monto Total (₡) *</Label>
              <Input type="number" min="0" {...register("totalAmount", { valueAsNumber: true })} />
              {errors.totalAmount && <p className="text-xs text-red-600">{errors.totalAmount.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Registrar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Distribution preview dialog */}
      {previewExpenseId && (
        <Dialog open={!!previewExpenseId} onOpenChange={() => setPreviewExpenseId(null)}>
          <DialogContent className="max-w-2xl max-h-[min(90vh,900px)] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <div className="px-6 pt-6 pb-4 shrink-0">
              <DialogHeader>
                <DialogTitle>Distribución Proporcional</DialogTitle>
              </DialogHeader>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 space-y-4 pb-4">
              {previewLoading ? (
                <div className="py-8 text-center text-slate-400">Calculando distribución...</div>
              ) : (
                <>
                  <p className="text-sm text-slate-500">
                    El monto será distribuido proporcionalmente según el % de equivalencia (puestos del contrato / total de puestos de la empresa):
                  </p>
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b">
                          <th className="text-left px-3 py-2">Contrato</th>
                          <th className="text-left px-3 py-2">Cliente</th>
                          <th className="text-right px-3 py-2">Equiv. %</th>
                          <th className="text-right px-3 py-2">Monto Asignado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(previewData?.data ?? []).map((d) => (
                          <tr key={d.contractId} className="border-b">
                            <td className="px-3 py-2 font-medium">{d.licitacionNo}</td>
                            <td className="px-3 py-2 text-slate-500">{d.client}</td>
                            <td className="px-3 py-2 text-right">{(d.equivalencePct * 100).toFixed(2)}%</td>
                            <td className="px-3 py-2 text-right font-medium">{formatCurrency(d.allocatedAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!expenses.find((e) => e.id === previewExpenseId)?.isDistributed && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800">
                      Al confirmar, cada contrato absorberá su porción del gasto, afectando su semáforo de presupuesto.
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="shrink-0 border-t bg-background px-6 py-4">
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setPreviewExpenseId(null)}>Cerrar</Button>
                {!expenses.find((e) => e.id === previewExpenseId)?.isDistributed && (
                  <Button
                    onClick={() => distributeMutation.mutate(previewExpenseId)}
                    disabled={distributeMutation.isPending}
                  >
                    {distributeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                    Confirmar Distribución
                  </Button>
                )}
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
