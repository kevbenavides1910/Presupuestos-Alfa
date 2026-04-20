"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

const ACCION_OPTIONS = ["Cobrado", "Dado de baja", "Otro"] as const;

export interface CloseCycleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codigo: string;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CloseCycleDialog({ open, onOpenChange, codigo }: CloseCycleDialogProps) {
  const [accion, setAccion] = useState<string>("Cobrado");
  const [accionLibre, setAccionLibre] = useState<string>("");
  const [monto, setMonto] = useState<string>("");
  const [cerradoEl, setCerradoEl] = useState<string>(todayIso());
  const [notas, setNotas] = useState<string>("");
  const [resetTreatment, setResetTreatment] = useState<boolean>(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setAccion("Cobrado");
      setAccionLibre("");
      setMonto("");
      setCerradoEl(todayIso());
      setNotas("");
      setResetTreatment(true);
    }
  }, [open]);

  const accionFinal = accion === "Otro" ? accionLibre.trim() : accion;
  const isCobrado = accion === "Cobrado";
  const montoNumber = monto.trim() ? Number(monto.replace(",", ".")) : null;
  const montoInvalid = isCobrado && (monto.trim() === "" || montoNumber === null || Number.isNaN(montoNumber));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/disciplinary/empleados/${encodeURIComponent(codigo)}/treatment/close-cycle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accion: accionFinal,
            monto: isCobrado ? montoNumber : null,
            cerradoEl,
            notas: notas.trim() || null,
            resetTreatment,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Error al cerrar ciclo");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Ciclo cerrado");
      queryClient.invalidateQueries({ queryKey: ["disciplinary-detail", codigo] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-dashboard"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSave =
    accionFinal.length > 0 && cerradoEl.length > 0 && !montoInvalid && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cerrar ciclo</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1">Acción *</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm"
                value={accion}
                onChange={(e) => setAccion(e.target.value)}
              >
                {ACCION_OPTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              {accion === "Otro" && (
                <Input
                  className="mt-2"
                  value={accionLibre}
                  onChange={(e) => setAccionLibre(e.target.value)}
                  placeholder="Describa la acción…"
                />
              )}
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Cerrado el *</label>
              <Input
                type="date"
                value={cerradoEl}
                onChange={(e) => setCerradoEl(e.target.value)}
              />
            </div>
          </div>

          {isCobrado && (
            <div>
              <label className="text-sm font-medium block mb-1">Monto cobrado *</label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0.00"
              />
              {montoInvalid && (
                <div className="text-xs text-rose-600 mt-1">Indique un monto numérico</div>
              )}
            </div>
          )}

          <div>
            <label className="text-sm font-medium block mb-1">Notas</label>
            <textarea
              className="w-full min-h-[60px] rounded-md border border-input bg-white px-3 py-2 text-sm"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Comentario interno (opcional)…"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={resetTreatment}
              onChange={(e) => setResetTreatment(e.target.checked)}
            />
            Reiniciar el tratamiento vigente al cerrar el ciclo
          </label>

          <div className="text-xs text-slate-500">
            Se archivará la cantidad de apercibimientos no anulados y el total de omisiones
            del empleado al momento del cierre. Los KPIs del dashboard se calculan sobre estos
            ciclos cerrados.
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave}>
            {mutation.isPending ? "Cerrando…" : "Cerrar ciclo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
