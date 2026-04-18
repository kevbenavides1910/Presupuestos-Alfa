"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, MapPin, Clock, ChevronDown, ChevronRight, Receipt, Building2, FileSpreadsheet } from "lucide-react";
import { exportRowsToExcel } from "@/lib/utils/excel-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { formatCurrency, formatMonthYear } from "@/lib/utils/format";
import type { ExpenseType } from "@prisma/client";

interface PositionExpense {
  id: string;
  type: ExpenseType;
  description: string;
  amount: number;
  periodMonth: string;
}
interface ShiftRow {
  id: string;
  label: string | null;
  hours: number;
  sortOrder: number;
}
interface PositionRow {
  id: string;
  name: string;
  description?: string | null;
  shifts: ShiftRow[];
  totalExpenses: number;
  expenses: PositionExpense[];
}
interface LocationRow {
  id: string;
  name: string;
  description?: string | null;
  sortOrder: number;
  positions: PositionRow[];
}

const TYPE_LABELS: Record<ExpenseType, string> = {
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
const TYPE_COLOR: Record<ExpenseType, string> = {
  APERTURA: "bg-blue-100 text-blue-800",
  UNIFORMS: "bg-purple-100 text-purple-800",
  AUDIT: "bg-orange-100 text-orange-800",
  ADMIN: "bg-slate-100 text-slate-700",
  TRANSPORT: "bg-cyan-100 text-cyan-800",
  FUEL: "bg-yellow-100 text-yellow-800",
  PHONES: "bg-green-100 text-green-800",
  PLANILLA: "bg-emerald-100 text-emerald-800",
  OTHER: "bg-gray-100 text-gray-700",
};

function invalidatePositionQueries(qc: ReturnType<typeof useQueryClient>, contractId: string) {
  qc.invalidateQueries({ queryKey: ["contract-locations", contractId] });
  qc.invalidateQueries({ queryKey: ["positions", contractId] });
  qc.invalidateQueries({ queryKey: ["positions-for-expense", contractId] });
}

export function PositionsTab({
  contractId,
  readOnly,
}: {
  contractId: string;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [expandedLoc, setExpandedLoc] = useState<string | null>(null);
  const [expandedPos, setExpandedPos] = useState<string | null>(null);

  const [locModal, setLocModal] = useState(false);
  const [locForm, setLocForm] = useState({ name: "", description: "" });
  const [editLoc, setEditLoc] = useState<LocationRow | null>(null);
  const [editLocForm, setEditLocForm] = useState({ name: "", description: "" });

  const [posModal, setPosModal] = useState<string | null>(null);
  const [posForm, setPosForm] = useState({
    name: "",
    description: "",
    shifts: [] as { label: string; hours: string }[],
  });
  const [editPos, setEditPos] = useState<PositionRow | null>(null);
  const [editPosForm, setEditPosForm] = useState({ name: "", description: "" });

  const [shiftModal, setShiftModal] = useState<string | null>(null);
  const [shiftForm, setShiftForm] = useState({ label: "", hours: "8" });
  const [editShift, setEditShift] = useState<{ posId: string; shift: ShiftRow } | null>(null);
  const [editShiftForm, setEditShiftForm] = useState({ label: "", hours: "8" });

  const { data, isLoading } = useQuery<{ data: LocationRow[] }>({
    queryKey: ["contract-locations", contractId],
    queryFn: () => fetch(`/api/contracts/${contractId}/locations`).then((r) => r.json()),
  });

  const createLocMutation = useMutation({
    mutationFn: (body: object) =>
      fetch(`/api/contracts/${contractId}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) {
        toast.error(res.error.message ?? "Error");
        return;
      }
      toast.success("Ubicación creada");
      invalidatePositionQueries(qc, contractId);
      setLocModal(false);
      setLocForm({ name: "", description: "" });
    },
  });

  const updateLocMutation = useMutation({
    mutationFn: ({ locationId, body }: { locationId: string; body: object }) =>
      fetch(`/api/contracts/${contractId}/locations/${locationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) {
        toast.error(res.error.message ?? "Error");
        return;
      }
      toast.success("Ubicación actualizada");
      invalidatePositionQueries(qc, contractId);
      setEditLoc(null);
    },
  });

  const deleteLocMutation = useMutation({
    mutationFn: (locationId: string) =>
      fetch(`/api/contracts/${contractId}/locations/${locationId}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) {
        toast.error(res.error.message ?? "Error");
        return;
      }
      toast.success("Ubicación eliminada");
      invalidatePositionQueries(qc, contractId);
    },
  });

  const createPosMutation = useMutation({
    mutationFn: ({ locationId, body }: { locationId: string; body: object }) =>
      fetch(`/api/contracts/${contractId}/locations/${locationId}/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) {
        toast.error(res.error.message ?? "Error");
        return;
      }
      toast.success("Puesto creado");
      invalidatePositionQueries(qc, contractId);
      setPosModal(null);
      setPosForm({ name: "", description: "", shifts: [] });
    },
  });

  const updatePosMutation = useMutation({
    mutationFn: ({ posId, body }: { posId: string; body: object }) =>
      fetch(`/api/contracts/${contractId}/positions/${posId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) {
        toast.error(res.error.message ?? "Error");
        return;
      }
      toast.success("Puesto actualizado");
      invalidatePositionQueries(qc, contractId);
      setEditPos(null);
    },
  });

  const deletePosMutation = useMutation({
    mutationFn: (posId: string) =>
      fetch(`/api/contracts/${contractId}/positions/${posId}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) {
        toast.error(res.error.message ?? "Error");
        return;
      }
      toast.success("Puesto eliminado");
      invalidatePositionQueries(qc, contractId);
    },
  });

  const createShiftMutation = useMutation({
    mutationFn: ({ posId, body }: { posId: string; body: object }) =>
      fetch(`/api/contracts/${contractId}/positions/${posId}/shifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) {
        toast.error(res.error.message ?? "Error");
        return;
      }
      toast.success("Turno agregado");
      invalidatePositionQueries(qc, contractId);
      setShiftModal(null);
      setShiftForm({ label: "", hours: "8" });
    },
  });

  const updateShiftMutation = useMutation({
    mutationFn: ({ posId, shiftId, body }: { posId: string; shiftId: string; body: object }) =>
      fetch(`/api/contracts/${contractId}/positions/${posId}/shifts/${shiftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) {
        toast.error(res.error.message ?? "Error");
        return;
      }
      toast.success("Turno actualizado");
      invalidatePositionQueries(qc, contractId);
      setEditShift(null);
    },
  });

  const deleteShiftMutation = useMutation({
    mutationFn: ({ posId, shiftId }: { posId: string; shiftId: string }) =>
      fetch(`/api/contracts/${contractId}/positions/${posId}/shifts/${shiftId}`, { method: "DELETE" }).then((r) =>
        r.json()
      ),
    onSuccess: (res) => {
      if (res.error) {
        toast.error(res.error.message ?? "Error");
        return;
      }
      toast.success("Turno eliminado");
      invalidatePositionQueries(qc, contractId);
    },
  });

  const locations = data?.data ?? [];
  const totalPositions = locations.reduce((n, l) => n + l.positions.length, 0);
  const totalExpenses = locations.reduce(
    (s, l) => s + l.positions.reduce((t, p) => t + p.totalExpenses, 0),
    0
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-slate-800">Ubicaciones del contrato</h3>
          <p className="text-sm text-slate-500">
            {locations.length} ubicación{locations.length !== 1 ? "es" : ""} · {totalPositions} puesto
            {totalPositions !== 1 ? "s" : ""} · Gastos por puesto:{" "}
            <span className="font-medium">{formatCurrency(totalExpenses)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={locations.length === 0}
            onClick={() => {
              const exportRows: Array<Record<string, string | number>> = [];
              for (const loc of locations) {
                if (loc.positions.length === 0) {
                  exportRows.push({
                    Ubicación: loc.name,
                    "Descripción ubicación": loc.description ?? "",
                    Puesto: "",
                    "Descripción puesto": "",
                    Turnos: "(Sin puestos)",
                    "Total horas/día": "",
                    "Gastos del puesto": "",
                  });
                  continue;
                }
                for (const p of loc.positions) {
                  const turnos = p.shifts.length === 0
                    ? "Sin turnos"
                    : p.shifts
                        .map((s) => `${s.label ? s.label + " · " : ""}${s.hours}h`)
                        .join(" | ");
                  const totalHours = p.shifts.reduce((s, sh) => s + sh.hours, 0);
                  exportRows.push({
                    Ubicación: loc.name,
                    "Descripción ubicación": loc.description ?? "",
                    Puesto: p.name,
                    "Descripción puesto": p.description ?? "",
                    Turnos: turnos,
                    "Total horas/día": totalHours,
                    "Gastos del puesto": p.totalExpenses,
                  });
                }
              }
              const totalRow: Record<string, string | number> = {
                Ubicación: "TOTAL",
                "Descripción ubicación": "",
                Puesto: `${totalPositions} puesto(s)`,
                "Descripción puesto": "",
                Turnos: "",
                "Total horas/día": "",
                "Gastos del puesto": totalExpenses,
              };
              exportRowsToExcel({
                filename: `ubicaciones_contrato_${contractId}`,
                sheetName: "Ubicaciones",
                rows: exportRows,
                totalRow,
                columnWidths: [22, 32, 28, 32, 36, 14, 18],
              });
            }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Exportar a Excel ({locations.length})
          </Button>
          {!readOnly && (
            <Button size="sm" className="gap-2" onClick={() => setLocModal(true)}>
              <Plus className="h-4 w-4" /> Nueva ubicación
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-slate-400">Cargando ubicaciones…</div>
      ) : locations.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-slate-400">
            <Building2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No hay ubicaciones definidas.</p>
            <p className="text-sm mt-1">
              Cree una ubicación y luego agregue puestos y turnos (horas) en cada una.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {locations.map((loc) => (
            <Card key={loc.id} className="overflow-hidden">
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setExpandedLoc(expandedLoc === loc.id ? null : loc.id)}
              >
                <div className="text-slate-400">
                  {expandedLoc === loc.id ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </div>
                <MapPin className="h-4 w-4 text-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800">{loc.name}</div>
                  {loc.description && <p className="text-xs text-slate-400 mt-0.5">{loc.description}</p>}
                  <p className="text-xs text-slate-500 mt-0.5">{loc.positions.length} puesto(s)</p>
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setPosModal(loc.id)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Puesto
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-slate-600 hover:bg-blue-50 hover:text-blue-600"
                      title="Editar ubicación"
                      onClick={() => {
                        setEditLoc(loc);
                        setEditLocForm({ name: loc.name, description: loc.description ?? "" });
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:bg-red-50 h-8"
                      onClick={() => {
                        if (confirm(`¿Eliminar la ubicación «${loc.name}» y todos sus puestos sin gastos?`)) {
                          deleteLocMutation.mutate(loc.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {expandedLoc === loc.id && (
                <div className="border-t bg-slate-50/80 px-2 py-3 space-y-2">
                  {loc.positions.length === 0 ? (
                    <p className="text-sm text-slate-500 px-2">Sin puestos en esta ubicación.</p>
                  ) : (
                    loc.positions.map((pos) => (
                      <Card key={pos.id} className="bg-white shadow-sm">
                        <div
                          className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50"
                          onClick={() => setExpandedPos(expandedPos === pos.id ? null : pos.id)}
                        >
                          {expandedPos === pos.id ? (
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-400" />
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-slate-800">{pos.name}</span>
                            {pos.description && (
                              <p className="text-xs text-slate-400 mt-0.5">{pos.description}</p>
                            )}
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {pos.shifts.length === 0 ? (
                                <span className="text-xs text-amber-600">Sin turnos definidos</span>
                              ) : (
                                pos.shifts.map((sh) => (
                                  <span
                                    key={sh.id}
                                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                                  >
                                    <Clock className="h-3 w-3" />
                                    {!readOnly ? (
                                      <button
                                        type="button"
                                        className="hover:text-blue-600"
                                        title="Editar turno"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditShift({ posId: pos.id, shift: sh });
                                          setEditShiftForm({
                                            label: sh.label ?? "",
                                            hours: String(sh.hours),
                                          });
                                        }}
                                      >
                                        {sh.label ? `${sh.label} · ` : ""}
                                        {sh.hours}h
                                      </button>
                                    ) : (
                                      <span>
                                        {sh.label ? `${sh.label} · ` : ""}
                                        {sh.hours}h
                                      </span>
                                    )}
                                    {!readOnly && (
                                      <button
                                        type="button"
                                        className="ml-0.5 text-red-500 hover:text-red-700"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (confirm("¿Eliminar este turno?")) {
                                            deleteShiftMutation.mutate({ posId: pos.id, shiftId: sh.id });
                                          }
                                        }}
                                      >
                                        ×
                                      </button>
                                    )}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                          <div className="text-right text-sm shrink-0">
                            <div className="font-semibold text-slate-700">{formatCurrency(pos.totalExpenses)}</div>
                            <div className="text-xs text-slate-400">{pos.expenses.length} gasto(s)</div>
                          </div>
                          {!readOnly && (
                            <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShiftModal(pos.id)}>
                                + Turno
                              </Button>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-slate-600 hover:bg-blue-50 hover:text-blue-600"
                                  title="Editar puesto"
                                  onClick={() => {
                                    setEditPos(pos);
                                    setEditPosForm({ name: pos.name, description: pos.description ?? "" });
                                  }}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-red-500"
                                  onClick={() => {
                                    if (confirm(`¿Eliminar el puesto «${pos.name}»?`)) deletePosMutation.mutate(pos.id);
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                        {expandedPos === pos.id && (
                          <div className="border-t px-2 py-2">
                            {pos.expenses.length === 0 ? (
                              <div className="text-sm text-slate-400 flex items-center gap-2 px-2 py-2">
                                <Receipt className="h-4 w-4" />
                                Sin gastos.{" "}
                                <a href="/expenses" className="text-blue-600 hover:underline">
                                  Registrar en Gastos
                                </a>
                              </div>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left px-2 py-1.5 text-xs font-semibold text-slate-500">Tipo</th>
                                    <th className="text-left px-2 py-1.5 text-xs font-semibold text-slate-500">Descripción</th>
                                    <th className="text-left px-2 py-1.5 text-xs font-semibold text-slate-500">Período</th>
                                    <th className="text-right px-2 py-1.5 text-xs font-semibold text-slate-500">Monto</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {pos.expenses.map((e) => (
                                    <tr key={e.id} className="hover:bg-slate-50">
                                      <td className="px-2 py-1.5">
                                        <span
                                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLOR[e.type]}`}
                                        >
                                          {TYPE_LABELS[e.type]}
                                        </span>
                                      </td>
                                      <td className="px-2 py-1.5 text-slate-700">{e.description}</td>
                                      <td className="px-2 py-1.5 text-slate-500">{formatMonthYear(e.periodMonth)}</td>
                                      <td className="px-2 py-1.5 text-right font-semibold">{formatCurrency(e.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t">
                                    <td colSpan={3} className="px-2 py-1.5 text-sm font-semibold text-slate-600">
                                      Total puesto
                                    </td>
                                    <td className="px-2 py-1.5 text-right font-bold text-slate-800">
                                      {formatCurrency(pos.totalExpenses)}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            )}
                          </div>
                        )}
                      </Card>
                    ))
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={locModal && !readOnly} onOpenChange={(v) => !readOnly && setLocModal(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva ubicación</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-slate-700">Nombre *</label>
              <Input
                placeholder="Ej: Sede principal, Edificio norte…"
                value={locForm.name}
                onChange={(e) => setLocForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Descripción (opcional)</label>
              <Input
                value={locForm.description}
                onChange={(e) => setLocForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLocModal(false)}>
              Cancelar
            </Button>
            <Button
              disabled={createLocMutation.isPending}
              onClick={() => {
                if (!locForm.name.trim()) {
                  toast.error("Indique el nombre de la ubicación");
                  return;
                }
                createLocMutation.mutate({
                  name: locForm.name.trim(),
                  description: locForm.description.trim() || undefined,
                });
              }}
            >
              {createLocMutation.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!posModal && !readOnly} onOpenChange={(v) => !v && setPosModal(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo puesto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-slate-700">Nombre del puesto *</label>
              <Input
                value={posForm.name}
                onChange={(e) => setPosForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Control de acceso principal"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Descripción (opcional)</label>
              <Input
                value={posForm.description}
                onChange={(e) => setPosForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">Turnos (horas)</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setPosForm((f) => ({ ...f, shifts: [...f.shifts, { label: "", hours: "8" }] }))}
                >
                  + Turno
                </Button>
              </div>
              <p className="text-xs text-slate-500 mb-2">Opcional: puede agregar turnos ahora o después desde la lista.</p>
              <div className="space-y-2">
                {posForm.shifts.map((row, i) => (
                  <div key={i} className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="text-xs text-slate-500">Etiqueta</label>
                      <Input
                        placeholder="Diurno, nocturno…"
                        value={row.label}
                        onChange={(e) =>
                          setPosForm((f) => ({
                            ...f,
                            shifts: f.shifts.map((s, j) => (j === i ? { ...s, label: e.target.value } : s)),
                          }))
                        }
                      />
                    </div>
                    <div className="w-24">
                      <label className="text-xs text-slate-500">Horas</label>
                      <Input
                        type="number"
                        min={0.5}
                        max={24}
                        step={0.5}
                        value={row.hours}
                        onChange={(e) =>
                          setPosForm((f) => ({
                            ...f,
                            shifts: f.shifts.map((s, j) => (j === i ? { ...s, hours: e.target.value } : s)),
                          }))
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-red-500 shrink-0"
                      onClick={() =>
                        setPosForm((f) => ({ ...f, shifts: f.shifts.filter((_, j) => j !== i) }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPosModal(null)}>
              Cancelar
            </Button>
            <Button
              disabled={createPosMutation.isPending || !posModal}
              onClick={() => {
                if (!posForm.name.trim()) {
                  toast.error("Nombre del puesto requerido");
                  return;
                }
                const shifts = posForm.shifts
                  .map((s) => ({
                    label: s.label.trim() || undefined,
                    hours: parseFloat(s.hours),
                  }))
                  .filter((s) => Number.isFinite(s.hours) && s.hours > 0);
                createPosMutation.mutate({
                  locationId: posModal!,
                  body: {
                    name: posForm.name.trim(),
                    description: posForm.description.trim() || undefined,
                    shifts: shifts.length ? shifts : undefined,
                  },
                });
              }}
            >
              {createPosMutation.isPending ? "Guardando…" : "Guardar puesto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!shiftModal && !readOnly} onOpenChange={(v) => !v && setShiftModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Agregar turno</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-slate-700">Etiqueta (opcional)</label>
              <Input
                placeholder="Diurno, 12×36…"
                value={shiftForm.label}
                onChange={(e) => setShiftForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Horas *</label>
              <Input
                type="number"
                min={0.5}
                max={24}
                step={0.5}
                value={shiftForm.hours}
                onChange={(e) => setShiftForm((f) => ({ ...f, hours: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftModal(null)}>
              Cancelar
            </Button>
            <Button
              disabled={createShiftMutation.isPending}
              onClick={() => {
                const h = parseFloat(shiftForm.hours);
                if (!Number.isFinite(h) || h <= 0) {
                  toast.error("Indique horas válidas");
                  return;
                }
                createShiftMutation.mutate({
                  posId: shiftModal!,
                  body: {
                    label: shiftForm.label.trim() || undefined,
                    hours: h,
                  },
                });
              }}
            >
              {createShiftMutation.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editLoc && !readOnly} onOpenChange={(v) => !v && setEditLoc(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar ubicación</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-slate-700">Nombre *</label>
              <Input
                value={editLocForm.name}
                onChange={(e) => setEditLocForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Descripción (opcional)</label>
              <Input
                value={editLocForm.description}
                onChange={(e) => setEditLocForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLoc(null)}>
              Cancelar
            </Button>
            <Button
              disabled={updateLocMutation.isPending}
              onClick={() => {
                if (!editLocForm.name.trim()) {
                  toast.error("Indique el nombre de la ubicación");
                  return;
                }
                updateLocMutation.mutate({
                  locationId: editLoc!.id,
                  body: {
                    name: editLocForm.name.trim(),
                    description: editLocForm.description.trim() || null,
                  },
                });
              }}
            >
              {updateLocMutation.isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editPos && !readOnly} onOpenChange={(v) => !v && setEditPos(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar puesto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-slate-700">Nombre del puesto *</label>
              <Input
                value={editPosForm.name}
                onChange={(e) => setEditPosForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Descripción (opcional)</label>
              <Input
                value={editPosForm.description}
                onChange={(e) => setEditPosForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <p className="text-xs text-slate-500">
              Los turnos se gestionan con los botones «+ Turno» y haciendo clic sobre cada turno existente.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPos(null)}>
              Cancelar
            </Button>
            <Button
              disabled={updatePosMutation.isPending}
              onClick={() => {
                if (!editPosForm.name.trim()) {
                  toast.error("Nombre del puesto requerido");
                  return;
                }
                updatePosMutation.mutate({
                  posId: editPos!.id,
                  body: {
                    name: editPosForm.name.trim(),
                    description: editPosForm.description.trim() || null,
                  },
                });
              }}
            >
              {updatePosMutation.isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editShift && !readOnly} onOpenChange={(v) => !v && setEditShift(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar turno</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-slate-700">Etiqueta (opcional)</label>
              <Input
                value={editShiftForm.label}
                onChange={(e) => setEditShiftForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Horas *</label>
              <Input
                type="number"
                min={0.5}
                max={24}
                step={0.5}
                value={editShiftForm.hours}
                onChange={(e) => setEditShiftForm((f) => ({ ...f, hours: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditShift(null)}>
              Cancelar
            </Button>
            <Button
              disabled={updateShiftMutation.isPending}
              onClick={() => {
                const h = parseFloat(editShiftForm.hours);
                if (!Number.isFinite(h) || h <= 0) {
                  toast.error("Indique horas válidas");
                  return;
                }
                updateShiftMutation.mutate({
                  posId: editShift!.posId,
                  shiftId: editShift!.shift.id,
                  body: {
                    label: editShiftForm.label.trim() || null,
                    hours: h,
                  },
                });
              }}
            >
              {updateShiftMutation.isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
