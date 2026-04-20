"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

/**
 * Acciones canónicas para el tratamiento del empleado:
 *  - PENDIENTE: convocatoria definida, aún sin resolver. Solo guarda el tratamiento.
 *  - COBRADO: resuelve con cobro y monto. Guarda tratamiento + cierra el ciclo automáticamente.
 *  - BAJA: resuelve con dado de baja. Guarda tratamiento + cierra el ciclo automáticamente.
 *  - OTRO: texto libre. Solo guarda el tratamiento.
 */
type AccionKey = "PENDIENTE" | "COBRADO" | "BAJA" | "OTRO";

const ACCION_OPTIONS: { value: AccionKey; label: string; treatmentLabel: string }[] = [
  { value: "PENDIENTE", label: "Pendiente", treatmentLabel: "Pendiente" },
  { value: "COBRADO", label: "Cobrado", treatmentLabel: "Cobrado" },
  { value: "BAJA", label: "Dado de baja", treatmentLabel: "Dado de baja" },
  { value: "OTRO", label: "Otro", treatmentLabel: "" },
];

interface TreatmentInitial {
  fechaConvocatoria: string | null;
  accion: string | null;
  cobradoDate: string | null;
}

export interface TreatmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codigo: string;
  initial: TreatmentInitial | null;
}

function toDateInputValue(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayIso(): string {
  return toDateInputValue(new Date());
}

function inferAccionKey(raw: string | null | undefined, hasCobrado: boolean): AccionKey {
  if (hasCobrado) return "COBRADO";
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return "PENDIENTE";
  if (t.includes("cobr")) return "COBRADO";
  if (t.includes("baja")) return "BAJA";
  if (t.includes("pendi")) return "PENDIENTE";
  return "OTRO";
}

export function TreatmentDialog({ open, onOpenChange, codigo, initial }: TreatmentDialogProps) {
  const [fechaConvocatoria, setFechaConvocatoria] = useState("");
  const [accionKey, setAccionKey] = useState<AccionKey>("PENDIENTE");
  const [accionLibre, setAccionLibre] = useState("");
  const [cobradoDate, setCobradoDate] = useState("");
  const [monto, setMonto] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) return;
    setFechaConvocatoria(toDateInputValue(initial?.fechaConvocatoria ?? null));
    setCobradoDate(toDateInputValue(initial?.cobradoDate ?? null));
    const inferred = inferAccionKey(initial?.accion, !!initial?.cobradoDate);
    setAccionKey(inferred);
    setAccionLibre(inferred === "OTRO" ? (initial?.accion ?? "") : "");
    setMonto("");
  }, [open, initial]);

  const isCobrado = accionKey === "COBRADO";
  const isBaja = accionKey === "BAJA";
  const closesCycle = isCobrado || isBaja;
  const accionTexto =
    accionKey === "OTRO"
      ? accionLibre.trim()
      : ACCION_OPTIONS.find((o) => o.value === accionKey)?.treatmentLabel ?? "";

  const montoNumber = monto.trim() ? Number(monto.replace(",", ".")) : null;
  const montoInvalid =
    isCobrado && (monto.trim() === "" || montoNumber === null || Number.isNaN(montoNumber));
  const accionLibreInvalid = accionKey === "OTRO" && !accionLibre.trim();

  const mutation = useMutation({
    mutationFn: async () => {
      // 1) Guardar tratamiento vigente.
      const treatmentBody = {
        fechaConvocatoria: fechaConvocatoria || null,
        accion: accionTexto || null,
        cobradoDate: isCobrado ? cobradoDate || todayIso() : null,
      };
      const t = await fetch(
        `/api/disciplinary/empleados/${encodeURIComponent(codigo)}/treatment`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(treatmentBody),
        },
      );
      const tJson = await t.json();
      if (!t.ok) throw new Error(tJson.error?.message ?? "Error al guardar tratamiento");

      // 2) Si la acción cierra ciclo (Cobrado / Baja), cerramos automáticamente.
      if (closesCycle) {
        const closeBody = {
          accion: isCobrado ? "Cobrado" : "Dado de baja",
          monto: isCobrado ? montoNumber : null,
          cerradoEl: (isCobrado ? cobradoDate : "") || todayIso(),
          notas: null,
          resetTreatment: true,
        };
        const c = await fetch(
          `/api/disciplinary/empleados/${encodeURIComponent(codigo)}/treatment/close-cycle`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(closeBody),
          },
        );
        const cJson = await c.json();
        if (!c.ok) throw new Error(cJson.error?.message ?? "Error al cerrar ciclo");
      }

      return tJson.data;
    },
    onSuccess: () => {
      toast.success(closesCycle ? "Ciclo cerrado y contador reiniciado" : "Tratamiento actualizado");
      queryClient.invalidateQueries({ queryKey: ["disciplinary-detail", codigo] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-detail"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-resumen"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-list"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSave = !mutation.isPending && !montoInvalid && !accionLibreInvalid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tratamiento del empleado</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1">Fecha convocatoria</label>
            <Input
              type="date"
              value={fechaConvocatoria}
              onChange={(e) => setFechaConvocatoria(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Acción *</label>
            <select
              className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm"
              value={accionKey}
              onChange={(e) => setAccionKey(e.target.value as AccionKey)}
            >
              {ACCION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {accionKey === "OTRO" && (
              <Input
                className="mt-2"
                value={accionLibre}
                onChange={(e) => setAccionLibre(e.target.value)}
                placeholder="Describa la acción…"
              />
            )}
          </div>

          {isCobrado && (
            <div className="grid grid-cols-2 gap-3">
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
              <div>
                <label className="text-sm font-medium block mb-1">Fecha de cobrado</label>
                <Input
                  type="date"
                  value={cobradoDate}
                  onChange={(e) => setCobradoDate(e.target.value)}
                />
                <div className="text-[11px] text-slate-500 mt-1">
                  Si lo deja vacío se usa la fecha de hoy.
                </div>
              </div>
            </div>
          )}

          {closesCycle ? (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
              Al guardar con acción «{isCobrado ? "Cobrado" : "Dado de baja"}» se cerrará el ciclo
              automáticamente y el contador de apercibimientos vigentes del empleado quedará en
              cero. El próximo apercibimiento iniciará un ciclo nuevo.
            </div>
          ) : (
            <div className="text-xs text-slate-500">
              Estos campos describen el ciclo <strong>vigente</strong>. Cuando el caso quede
              resuelto como Cobrado o Dado de baja, esa selección cerrará el ciclo aquí mismo.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave}>
            {mutation.isPending
              ? "Guardando…"
              : closesCycle
                ? "Guardar y cerrar ciclo"
                : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
