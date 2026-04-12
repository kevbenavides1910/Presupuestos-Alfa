"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, MapPin, Clock, ChevronDown, ChevronRight, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { formatCurrency, formatMonthYear } from "@/lib/utils/format";
import type { ExpenseType } from "@prisma/client";

interface PositionExpense {
  id: string; type: ExpenseType; description: string;
  amount: number; periodMonth: string;
}
interface Position {
  id: string; name: string; description?: string | null;
  shift?: string | null; location?: string | null;
  totalExpenses: number;
  expenses: PositionExpense[];
}

const TYPE_LABELS: Record<ExpenseType, string> = {
  APERTURA: "Apertura", UNIFORMS: "Uniformes", AUDIT: "Auditoría",
  ADMIN: "Administrativo", TRANSPORT: "Transporte", FUEL: "Combustible",
  PHONES: "Teléfonos", PLANILLA: "Planilla", OTHER: "Otros",
};
const TYPE_COLOR: Record<ExpenseType, string> = {
  APERTURA: "bg-blue-100 text-blue-800", UNIFORMS: "bg-purple-100 text-purple-800",
  AUDIT: "bg-orange-100 text-orange-800", ADMIN: "bg-slate-100 text-slate-700",
  TRANSPORT: "bg-cyan-100 text-cyan-800", FUEL: "bg-yellow-100 text-yellow-800",
  PHONES: "bg-green-100 text-green-800", PLANILLA: "bg-emerald-100 text-emerald-800",
  OTHER: "bg-gray-100 text-gray-700",
};

export function PositionsTab({
  contractId,
  readOnly,
}: {
  contractId: string;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", shift: "", location: "" });

  const { data, isLoading } = useQuery<{ data: Position[] }>({
    queryKey: ["positions", contractId],
    queryFn: () => fetch(`/api/contracts/${contractId}/positions`).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (body: object) =>
      fetch(`/api/contracts/${contractId}/positions`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then(r => r.json()),
    onSuccess: (res) => {
      if (res.error) { toast.error(res.error.message ?? "Error"); return; }
      toast.success("Puesto creado");
      qc.invalidateQueries({ queryKey: ["positions", contractId] });
      setShowForm(false);
      setForm({ name: "", description: "", shift: "", location: "" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (posId: string) =>
      fetch(`/api/contracts/${contractId}/positions/${posId}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: (res) => {
      if (res.error) { toast.error(res.error.message ?? "Error al eliminar"); return; }
      toast.success("Puesto eliminado");
      qc.invalidateQueries({ queryKey: ["positions", contractId] });
    },
  });

  const positions = data?.data ?? [];
  const totalExpenses = positions.reduce((s, p) => s + p.totalExpenses, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">Puestos del Contrato</h3>
          <p className="text-sm text-slate-500">
            {positions.length} puestos · Gastos totales por puesto: <span className="font-medium">{formatCurrency(totalExpenses)}</span>
          </p>
        </div>
        {!readOnly && (
          <Button size="sm" className="gap-2" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" /> Agregar Puesto
          </Button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-8 text-slate-400">Cargando puestos...</div>
      ) : positions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-slate-400">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No hay puestos definidos aún.</p>
            <p className="text-sm mt-1">Agrega los puestos para poder asignarles gastos individualmente.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {positions.map(pos => (
            <Card key={pos.id} className="overflow-hidden">
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setExpanded(expanded === pos.id ? null : pos.id)}
              >
                <div className="text-slate-400">
                  {expanded === pos.id
                    ? <ChevronDown className="h-4 w-4" />
                    : <ChevronRight className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{pos.name}</span>
                    {pos.shift && (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <Clock className="h-3 w-3" />{pos.shift}
                      </span>
                    )}
                    {pos.location && (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <MapPin className="h-3 w-3" />{pos.location}
                      </span>
                    )}
                  </div>
                  {pos.description && <p className="text-xs text-slate-400 mt-0.5">{pos.description}</p>}
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-700">{formatCurrency(pos.totalExpenses)}</div>
                  <div className="text-xs text-slate-400">{pos.expenses.length} gasto(s)</div>
                </div>
                {!readOnly && (
                  <Button
                    size="sm" variant="ghost"
                    className="text-red-500 hover:bg-red-50 shrink-0"
                    onClick={e => {
                      e.stopPropagation();
                      if (confirm(`¿Eliminar el puesto "${pos.name}"?`)) deleteMutation.mutate(pos.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {/* Expanded: expenses list */}
              {expanded === pos.id && (
                <div className="border-t bg-slate-50">
                  {pos.expenses.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-slate-400 flex items-center gap-2">
                      <Receipt className="h-4 w-4" />
                      Sin gastos asignados a este puesto.
                      <a href="/expenses" className="text-blue-600 hover:underline">Agregar desde Gastos</a>
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Tipo</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Descripción</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Período</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500">Monto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {pos.expenses.map(e => (
                          <tr key={e.id} className="hover:bg-white">
                            <td className="px-4 py-2">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLOR[e.type]}`}>
                                {TYPE_LABELS[e.type]}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-slate-700">{e.description}</td>
                            <td className="px-4 py-2 text-slate-500">{formatMonthYear(e.periodMonth)}</td>
                            <td className="px-4 py-2 text-right font-semibold">{formatCurrency(e.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t">
                          <td colSpan={3} className="px-4 py-2 text-sm font-semibold text-slate-600">Total puesto</td>
                          <td className="px-4 py-2 text-right font-bold text-slate-800">{formatCurrency(pos.totalExpenses)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Add position modal */}
      <Dialog open={showForm && !readOnly} onOpenChange={v => { if (!readOnly) setShowForm(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar Puesto</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Nombre del puesto *</label>
              <Input
                placeholder="Ej: Puesto Principal Entrada, Control Acceso Norte..."
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Turno</label>
                <Input
                  placeholder="Ej: Diurno, Nocturno, 24h..."
                  value={form.shift}
                  onChange={e => setForm(f => ({ ...f, shift: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Ubicación</label>
                <Input
                  placeholder="Ej: Edificio A, Piso 3..."
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Descripción (opcional)</label>
              <Input
                placeholder="Notas adicionales sobre el puesto..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!form.name.trim()) { toast.error("Ingrese el nombre del puesto"); return; }
                createMutation.mutate({
                  name: form.name.trim(),
                  description: form.description.trim() || undefined,
                  shift: form.shift.trim() || undefined,
                  location: form.location.trim() || undefined,
                });
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Guardando..." : "Guardar Puesto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
