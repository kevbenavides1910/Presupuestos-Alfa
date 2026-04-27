"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Send, Loader2, CheckCircle2 } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { rhfValueAsNumber } from "@/lib/rhf-safe-number";
import { toast } from "@/components/ui/toaster";
import { adminExpenseSchema, type AdminExpenseInput } from "@/lib/validations/expense.schema";
import { formatCurrency, formatMonthYear, toMonthString } from "@/lib/utils/format";
import { companyDisplayName } from "@/lib/utils/constants";
import { useCompanies } from "@/lib/hooks/use-companies";

interface AdminExpense {
  id: string; company: string; periodMonth: string; transport: number;
  adminCosts: number; phones: number; phoneLines: number; fuel: number;
  otherAmount: number; totalAmount: number; isDistributed: boolean;
}

const ADMIN_FIELDS = [
  { key: "transport",  label: "Transportes" },
  { key: "adminCosts", label: "Administrativo" },
  { key: "phones",     label: "Celulares" },
  { key: "phoneLines", label: "Líneas Telefónicas" },
  { key: "fuel",       label: "Combustible" },
  { key: "otherAmount", label: "Otros" },
] as const;

export default function AdminExpensesPage() {
  const [open, setOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState("all");
  const queryClient = useQueryClient();
  const { data: companiesRes } = useCompanies();
  const companyRows = companiesRes?.data ?? [];
  const activeCompanies = companyRows.filter((c) => c.isActive);

  const params = selectedCompany !== "all" ? `?company=${selectedCompany}` : "";
  const { data, isLoading } = useQuery<{ data: AdminExpense[] }>({
    queryKey: ["admin-expenses", selectedCompany],
    queryFn: () => fetch(`/api/expenses/admin${params}`).then((r) => r.json()),
  });

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<AdminExpenseInput>({
    resolver: zodResolver(adminExpenseSchema),
    defaultValues: { periodMonth: toMonthString(new Date()), transport: 0, adminCosts: 0, phones: 0, phoneLines: 0, fuel: 0, otherAmount: 0 },
  });

  const liveTotal = ADMIN_FIELDS.reduce((s, f) => s + (Number(watch(f.key as keyof AdminExpenseInput) ?? 0)), 0);

  const createMutation = useMutation({
    mutationFn: (data: AdminExpenseInput) =>
      fetch("/api/expenses/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-expenses"] });
      toast.success("Gastos administrativos registrados");
      setOpen(false);
      reset();
    },
    onError: () => toast.error("Error al registrar gastos"),
  });

  const distributeMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/expenses/admin/${id}/distribute`, { method: "POST" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["profitability"] });
      toast.success("Gastos distribuidos exitosamente");
    },
    onError: (e: Error) => toast.error("Error", e.message),
  });

  const expenses = data?.data ?? [];

  return (
    <>
      <Topbar title="Gastos Administrativos" />
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Gastos Administrativos</h2>
            <p className="text-sm text-slate-500">Transportes, celulares, combustible — distribuibles por empresa</p>
          </div>
          <Button className="gap-2" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Registrar Gastos
          </Button>
        </div>

        <Card>
          <CardContent className="p-4">
            <Select value={selectedCompany} onValueChange={setSelectedCompany}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las empresas</SelectItem>
                {companyRows.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-slate-400">Cargando...</div>
            ) : expenses.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No hay registros de gastos administrativos</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Empresa</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Período</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Transportes</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Celulares</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Combustible</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Total</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Estado</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {expenses.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Badge variant="outline">{companyDisplayName(e.company, companyRows)}</Badge>
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-500">{formatMonthYear(e.periodMonth)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(e.transport)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(e.phones)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(e.fuel)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(e.totalAmount)}</td>
                      <td className="px-4 py-3">
                        {e.isDistributed ? (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Distribuido
                          </Badge>
                        ) : <Badge variant="warning">Pendiente</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        {!e.isDistributed && (
                          <Button
                            variant="outline" size="sm"
                            className="gap-1 text-blue-600 hover:bg-blue-50"
                            onClick={() => {
                              if (confirm("¿Distribuir estos gastos entre los contratos activos de la empresa?")) {
                                distributeMutation.mutate(e.id);
                              }
                            }}
                            disabled={distributeMutation.isPending}
                          >
                            <Send className="h-3.5 w-3.5" />
                            Distribuir
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar Gastos Administrativos</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
                <Label>Período (mes) *</Label>
                <Input type="month" {...register("periodMonth")} />
              </div>
            </div>

            {ADMIN_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label>{f.label} (₡)</Label>
                <Input type="number" min="0" {...register(f.key, { setValueAs: rhfValueAsNumber })} />
              </div>
            ))}

            <div className="flex justify-between items-center p-3 bg-slate-50 rounded-md">
              <span className="text-sm font-medium">Total:</span>
              <span className="font-bold">{formatCurrency(liveTotal)}</span>
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
    </>
  );
}
