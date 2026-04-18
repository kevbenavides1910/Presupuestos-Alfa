"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation"; // 👈 Nueva importación
import { Plus, Calendar, FileSpreadsheet } from "lucide-react";
import { exportRowsToExcel } from "@/lib/utils/excel-export";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { periodSchema, type PeriodInput } from "@/lib/validations/contract.schema";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { Loader2 } from "lucide-react";

interface Period {
  id: string; periodNumber: number; startDate: string;
  endDate: string; monthlyBilling: number; notes?: string;
}

interface Props {
  contractId: string;
  periods: Period[];
  /** Solo lectura: oculta agregar prórroga */
  readOnly?: boolean;
}

export function PeriodsTab({ contractId, periods, readOnly }: Props) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter(); // 👈 Inicializamos el router

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PeriodInput>({
    resolver: zodResolver(periodSchema),
  });

  const mutation = useMutation({
    mutationFn: (data: PeriodInput) =>
      fetch(`/api/contracts/${contractId}/periods`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      // 👇 Invalidamos TODO lo relacionado a contratos para obligar a leer de la BD
      queryClient.invalidateQueries({ queryKey: ["contract"] });
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
      
      // 👇 Forzamos la recarga de los componentes de servidor de Next.js
      router.refresh();

      toast.success("Prórroga registrada exitosamente");
      setOpen(false);
      reset();
    },
    onError: () => toast.error("Error al registrar prórroga"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">Historial de Prórrogas</h3>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={periods.length === 0}
            onClick={() => {
              const exportRows = periods.map((p) => ({
                "Prórroga #": p.periodNumber,
                "Inicio": formatDate(p.startDate),
                "Cierre": formatDate(p.endDate),
                "Facturación mensual": p.monthlyBilling,
                Notas: p.notes ?? "",
              }));
              exportRowsToExcel({
                filename: `prorrogas_contrato_${contractId}`,
                sheetName: "Prórrogas",
                rows: exportRows,
                columnWidths: [12, 14, 14, 22, 40],
              });
            }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Exportar a Excel ({periods.length})
          </Button>
          {!readOnly && (
            <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              Agregar Prórroga
            </Button>
          )}
        </div>
      </div>

      {periods.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-slate-400">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No hay prórrogas registradas
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {periods.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold">
                    {p.periodNumber}
                  </div>
                  <div>
                    <div className="text-sm font-medium">Prórroga #{p.periodNumber}</div>
                    <div className="text-xs text-slate-500">{formatDate(p.startDate)} — {formatDate(p.endDate)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">{formatCurrency(p.monthlyBilling)}</div>
                  <div className="text-xs text-slate-400">facturación mensual</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open && !readOnly} onOpenChange={(v) => { if (!readOnly) setOpen(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva Prórroga</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Fecha de Inicio</Label>
                <Input type="date" {...register("startDate")} />
                {errors.startDate && <p className="text-xs text-red-600">{errors.startDate.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Fecha de Cierre</Label>
                <Input type="date" {...register("endDate")} />
                {errors.endDate && <p className="text-xs text-red-600">{errors.endDate.message}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Facturación Mensual (₡)</Label>
              <Input type="number" min="0" {...register("monthlyBilling", { valueAsNumber: true })} />
              {errors.monthlyBilling && <p className="text-xs text-red-600">{errors.monthlyBilling.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Input {...register("notes")} placeholder="Observaciones..." />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Registrar Prórroga
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}