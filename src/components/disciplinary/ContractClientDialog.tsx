"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

export interface ContractClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apercibimiento: {
    id: string;
    numero: string;
    contrato: string | null;
    cliente: string | null;
    clienteSetManual: boolean;
  } | null;
}

/**
 * Edita el contrato (N° de licitación) y/o el cliente de un apercibimiento.
 *
 * Comportamiento:
 * - Si tildás "Resolver cliente desde el contrato", se manda cliente=null y el server
 *   re-aplica el matching contra Contract.licitacionNo. Si no encuentra, queda en blanco.
 * - Si dejás un cliente escrito, queda como override manual (clienteSetManual=true) y
 *   futuras importaciones inicial/respaldo NO lo van a sobrescribir.
 */
export function ContractClientDialog({ open, onOpenChange, apercibimiento }: ContractClientDialogProps) {
  const [contrato, setContrato] = useState("");
  const [cliente, setCliente] = useState("");
  const [autoResolveCliente, setAutoResolveCliente] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open && apercibimiento) {
      setContrato(apercibimiento.contrato ?? "");
      setCliente(apercibimiento.cliente ?? "");
      setAutoResolveCliente(false);
    }
  }, [open, apercibimiento]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!apercibimiento) throw new Error("Sin apercibimiento");
      const body: Record<string, unknown> = {
        contrato: contrato.trim() || null,
      };
      if (autoResolveCliente) {
        body.cliente = null; // server vuelve a calcular automáticamente desde contrato
      } else {
        body.cliente = cliente.trim() || null;
      }
      const res = await fetch(`/api/disciplinary/apercibimientos/${apercibimiento.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Error al guardar");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Contrato/cliente actualizado");
      queryClient.invalidateQueries({ queryKey: ["disciplinary-list"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-detail"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-resumen"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!apercibimiento) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contrato / Cliente · {apercibimiento.numero}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1">Contrato (N° Licitación)</label>
            <Input
              value={contrato}
              onChange={(e) => setContrato(e.target.value)}
              placeholder="Ej. 2024LE-000123-000XX"
            />
            <div className="text-[11px] text-slate-500 mt-1">
              Debe coincidir con el N° de licitación registrado en Contratos para resolver el cliente automáticamente.
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoResolveCliente}
              onChange={(e) => setAutoResolveCliente(e.target.checked)}
            />
            Resolver cliente desde el contrato (sobrescribe override manual)
          </label>

          <div>
            <label className="text-sm font-medium block mb-1">Cliente</label>
            <Input
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="Cliente"
              disabled={autoResolveCliente}
            />
            {apercibimiento.clienteSetManual && !autoResolveCliente && (
              <div className="text-[11px] text-amber-700 mt-1">
                Este cliente fue editado manualmente. No se va a sobrescribir en futuras importaciones.
              </div>
            )}
            {!apercibimiento.clienteSetManual && !autoResolveCliente && (
              <div className="text-[11px] text-slate-500 mt-1">
                Si lo dejás vacío y guardás, queda en blanco hasta que cargues un contrato válido.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
