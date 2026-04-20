"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

const STATUS_LABEL: Record<string, string> = {
  EMITIDO: "Emitido",
  ENTREGADO: "Entregado",
  FIRMADO: "Firmado",
  ANULADO: "Anulado",
};

export interface StatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apercibimiento: {
    id: string;
    numero: string;
    estado: string;
    motivoAnulacion: string | null;
  } | null;
  onSaved?: () => void;
}

export function ApercibimientoStatusDialog({
  open,
  onOpenChange,
  apercibimiento,
  onSaved,
}: StatusDialogProps) {
  const [estado, setEstado] = useState<string>("EMITIDO");
  const [motivo, setMotivo] = useState<string>("");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (apercibimiento) {
      setEstado(apercibimiento.estado);
      setMotivo(apercibimiento.motivoAnulacion ?? "");
    }
  }, [apercibimiento]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!apercibimiento) throw new Error("Sin apercibimiento");
      const res = await fetch(`/api/disciplinary/apercibimientos/${apercibimiento.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado,
          motivoAnulacion: estado === "ANULADO" ? motivo : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Error al guardar");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Estado actualizado");
      queryClient.invalidateQueries({ queryKey: ["disciplinary-detail"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-list"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-dashboard"] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!apercibimiento) return null;
  const requiresMotivo = estado === "ANULADO";
  const canSave = !requiresMotivo || motivo.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar estado · {apercibimiento.numero}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1">Estado</label>
            <select
              className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
            >
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {requiresMotivo && (
            <div>
              <label className="text-sm font-medium block mb-1">Motivo de anulación *</label>
              <textarea
                className="w-full min-h-[80px] rounded-md border border-input bg-white px-3 py-2 text-sm"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Describa el motivo (obligatorio para anular)…"
              />
            </div>
          )}

          <div className="text-xs text-slate-500">
            La vigencia se recalcula automáticamente: «Firmado» → Finalizado; «Anulado» → Anulado;
            otros estados según los días desde la emisión.
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending}>
            {mutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
