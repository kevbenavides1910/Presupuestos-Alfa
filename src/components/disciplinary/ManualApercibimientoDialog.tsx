"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { Plus, Trash2 } from "lucide-react";

type OmRow = { fecha: string; hora: string };

const emptyOm = (): OmRow => ({ fecha: "", hora: "" });

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ManualApercibimientoDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [fechaEmision, setFechaEmision] = useState(() => new Date().toISOString().slice(0, 10));
  const [zona, setZona] = useState("");
  const [sucursal, setSucursal] = useState("");
  const [admin, setAdmin] = useState("");
  const [contrato, setContrato] = useState("");
  const [estado, setEstado] = useState("EMITIDO");
  const [motivo, setMotivo] = useState("");
  const [omisiones, setOmisiones] = useState<OmRow[]>(() => [emptyOm()]);

  function reset() {
    setCodigo("");
    setNombre("");
    setFechaEmision(new Date().toISOString().slice(0, 10));
    setZona("");
    setSucursal("");
    setAdmin("");
    setContrato("");
    setEstado("EMITIDO");
    setMotivo("");
    setOmisiones([emptyOm()]);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const om = omisiones
        .map((o) => ({ fecha: o.fecha.trim(), hora: o.hora.trim() || null }))
        .filter((o) => o.fecha.length > 0);
      if (om.length === 0) throw new Error("Indique al menos una fecha de omisión");

      const res = await fetch("/api/disciplinary/apercibimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          codigoEmpleado: codigo.trim(),
          nombreEmpleado: nombre.trim(),
          fechaEmision,
          zona: zona.trim() || null,
          sucursal: sucursal.trim() || null,
          administrador: admin.trim() || null,
          contrato: contrato.trim() || null,
          estado,
          motivoAnulacion: estado === "ANULADO" ? motivo.trim() || null : null,
          omisiones: om,
        }),
      });
      const j = (await res.json()) as { data?: { numero?: string }; error?: { message?: string } };
      if (!res.ok) throw new Error(j.error?.message ?? "No se pudo crear el apercibimiento");
      return j.data;
    },
    onSuccess: (data) => {
      toast.success(`Apercibimiento ${data?.numero ?? ""} registrado`);
      qc.invalidateQueries({ queryKey: ["disciplinary-list"] });
      qc.invalidateQueries({ queryKey: ["disciplinary-resumen"] });
      qc.invalidateQueries({ queryKey: ["disciplinary-detail"] });
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Alta manual de apercibimiento</DialogTitle>
          <DialogDescription>
            Se asigna el número consecutivo del sistema (OM-AAAA-NNNNNN). El cliente se resuelve por
            licitación si existe contrato coincidente.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">Código empleado *</label>
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej. 150202" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">Fecha de emisión *</label>
            <Input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-medium text-slate-700">Nombre completo *</label>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Como en RRHH" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">Zona</label>
            <Input value={zona} onChange={(e) => setZona(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">Sucursal</label>
            <Input value={sucursal} onChange={(e) => setSucursal(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">Administrador</label>
            <Input value={admin} onChange={(e) => setAdmin(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">Contrato (licitación)</label>
            <Input value={contrato} onChange={(e) => setContrato(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700">Estado inicial</label>
            <select
              className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
            >
              <option value="EMITIDO">Emitido</option>
              <option value="ENTREGADO">Entregado</option>
              <option value="FIRMADO">Firmado</option>
              <option value="ANULADO">Anulado</option>
            </select>
          </div>
          {estado === "ANULADO" && (
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium text-slate-700">Motivo de anulación *</label>
              <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700">Omisiones de marca *</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={() => setOmisiones((rows) => [...rows, emptyOm()])}
            >
              <Plus className="h-3.5 w-3.5" /> Añadir fecha
            </Button>
          </div>
          <p className="text-[11px] text-slate-500">Una fila por omisión. Hora opcional (HH:mm).</p>
          <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
            {omisiones.map((row, i) => (
              <div key={i} className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] text-slate-500">Fecha</label>
                  <Input type="date" value={row.fecha} onChange={(e) => {
                    const v = e.target.value;
                    setOmisiones((rows) => rows.map((r, j) => (j === i ? { ...r, fecha: v } : r)));
                  }} />
                </div>
                <div className="w-28 space-y-1">
                  <label className="text-[10px] text-slate-500">Hora</label>
                  <Input
                    placeholder="18:30"
                    value={row.hora}
                    onChange={(e) => {
                      const v = e.target.value;
                      setOmisiones((rows) => rows.map((r, j) => (j === i ? { ...r, hora: v } : r)));
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2 text-rose-600 shrink-0"
                  disabled={omisiones.length <= 1}
                  onClick={() => setOmisiones((rows) => rows.filter((_, j) => j !== i))}
                  title="Quitar fila"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Guardando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
