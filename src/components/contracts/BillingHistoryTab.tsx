"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { formatCurrency, formatMonthYear } from "@/lib/utils/format";

interface BillingEntry {
  id: string;
  periodMonth: string;
  monthlyBilling: number;
  suppliesBudget: number;
  notes?: string;
}

interface Props {
  contractId: string;
  /** Facturación mensual vigente (historial + base), para KPIs y formulario nuevo */
  monthlyBilling: number;
  /** Facturación base guardada en el contrato (comparación "vs. base") */
  contractBaseBilling: number;
  suppliesBudgetPct: number;
  readOnly?: boolean;
}

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export function BillingHistoryTab({
  contractId,
  monthlyBilling,
  contractBaseBilling,
  suppliesBudgetPct,
  readOnly,
}: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const now = new Date();
  const [form, setForm] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    monthlyBilling,
    notes: "",
  });

  const { data, isLoading } = useQuery<{ data: BillingEntry[] }>({
    queryKey: ["billing-history", contractId],
    queryFn: () => fetch(`/api/contracts/${contractId}/billing-history`).then((r) => r.json()),
  });

  const saveMutation = useMutation({
    mutationFn: (body: { periodMonth: string; monthlyBilling: number; notes?: string }) =>
      fetch(`/api/contracts/${contractId}/billing-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) { toast.error(res.error); return; }
      qc.invalidateQueries({ queryKey: ["billing-history", contractId] });
      qc.invalidateQueries({ queryKey: ["contract", contractId] });
      qc.invalidateQueries({ queryKey: ["profitability", contractId] });
      toast.success("Facturación actualizada");
      setShowForm(false);
    },
    onError: () => toast.error("Error al guardar"),
  });

  function submit() {
    const periodMonth = `${form.year}-${String(form.month).padStart(2, "0")}`;
    saveMutation.mutate({ periodMonth, monthlyBilling: form.monthlyBilling, notes: form.notes || undefined });
  }

  const entries = data?.data ?? [];

  // Year options (current year back 3)
  const yearOpts = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">Historial de Facturación</h3>
          <p className="text-sm text-slate-500">
            Facturación mensual vigente: <span className="font-semibold">{formatCurrency(monthlyBilling)}/mes</span>
            {" · "}Base contrato: <span className="font-semibold">{formatCurrency(contractBaseBilling)}/mes</span>
            {" · "}Presupuesto insumos: <span className="font-semibold">{(suppliesBudgetPct * 100).toFixed(1)}%</span>
          </p>
        </div>
        {!readOnly && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setShowForm((prev) => {
                if (!prev) setForm((f) => ({ ...f, monthlyBilling }));
                return !prev;
              });
            }}
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? "Cancelar" : "Actualizar Facturación"}
          </Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-medium text-blue-800">Registrar facturación para un mes específico</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-slate-600 block mb-1">Año</label>
                <select
                  className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                  value={form.year}
                  onChange={(e) => setForm({ ...form, year: parseInt(e.target.value) })}
                >
                  {yearOpts.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Mes</label>
                <select
                  className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                  value={form.month}
                  onChange={(e) => setForm({ ...form, month: parseInt(e.target.value) })}
                >
                  {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Facturación mensual (₡)</label>
                <Input
                  type="number"
                  value={form.monthlyBilling}
                  onChange={(e) => setForm({ ...form, monthlyBilling: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="flex items-end">
                <div className="w-full bg-white rounded-md border px-3 py-2 text-sm">
                  <span className="text-xs text-slate-500 block">Presupuesto insumos</span>
                  <span className="font-semibold text-green-700">{formatCurrency(form.monthlyBilling * suppliesBudgetPct)}</span>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">Notas (opcional)</label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Ej: Ajuste por prórroga, incremento salarial..."
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={submit} disabled={saveMutation.isPending} size="sm">
                Guardar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* History table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Registros guardados</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-slate-400">Cargando...</div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              No hay registros de facturación guardados.<br />
              <span className="text-xs">Se usa la facturación base del contrato en todos los meses.</span>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Período</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Facturación</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Presupuesto Insumos</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">vs. Base</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.map((e) => {
                  const diff = e.monthlyBilling - contractBaseBilling;
                  const pct = contractBaseBilling > 0 ? (diff / contractBaseBilling) * 100 : 0;
                  return (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{formatMonthYear(e.periodMonth)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(e.monthlyBilling)}</td>
                      <td className="px-4 py-3 text-right text-green-700">{formatCurrency(e.suppliesBudget)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : "text-slate-400"}`}>
                          {diff > 0 ? <TrendingUp className="h-3 w-3" /> : diff < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                          {diff !== 0 ? `${diff > 0 ? "+" : ""}${pct.toFixed(1)}%` : "Igual"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{e.notes ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
