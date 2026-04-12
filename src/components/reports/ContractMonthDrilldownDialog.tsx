"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils/format";
import {
  REPORT_PARTIDA_OPTIONS,
  EXPENSE_CATEGORY_LABELS,
  type ReportPartidaFilter,
  type TrafficLight,
} from "@/lib/utils/constants";
import { TrafficLightBadge } from "@/components/shared/TrafficLightBadge";
import { ExternalLink, Loader2 } from "lucide-react";

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function typeLabel(type: string): string {
  if (type === "DEFERRED_LEGACY") return "Diferidos (dist. legacy)";
  if (type === "AUDIT") return "Auditoría";
  if (type === "APERTURA") return "Apertura";
  if (type === "PLANILLA") return "Planilla";
  return EXPENSE_CATEGORY_LABELS[type] ?? type.replace(/_/g, " ");
}

interface DrilldownPayload {
  monthlyBilling: number;
  laborBudget: number;
  suppliesBudget: number;
  adminBudget: number;
  profitBudget: number;
  grandTotal: number;
  budgetUsagePctFormatted: number;
  remaining: number;
  trafficLight: TrafficLight;
  expensesByTypeMerged: Record<string, number>;
  partida: ReportPartidaFilter;
}

export interface MonthDrilldownTarget {
  contractId: string;
  licitacionNo: string;
  client: string;
  year: number;
  month: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: MonthDrilldownTarget | null;
  partida: ReportPartidaFilter;
}

export function ContractMonthDrilldownDialog({ open, onOpenChange, target, partida }: Props) {
  const monthStr =
    target &&
    `${target.year}-${String(target.month).padStart(2, "0")}`;

  const params = new URLSearchParams();
  if (monthStr) params.set("month", monthStr);
  if (partida !== "ALL") params.set("partida", partida);

  const { data, isLoading, isError } = useQuery<{ data: DrilldownPayload }>({
    queryKey: ["contract-month-drilldown", target?.contractId, monthStr, partida],
    queryFn: () =>
      fetch(`/api/contracts/${target!.contractId}/profitability?${params}`).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
    enabled: open && !!target?.contractId && !!monthStr,
  });

  const payload = data?.data;
  const partidaLabel = REPORT_PARTIDA_OPTIONS.find((o) => o.value === partida)?.label ?? "Todas las partidas";

  const expenseRows = payload
    ? Object.entries(payload.expensesByTypeMerged)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
    : [];

  const titleMonth =
    target && `${MONTH_NAMES[target.month - 1]} ${target.year}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">
            {target ? (
              <>
                {target.licitacionNo}
                <span className="text-slate-500 font-normal"> · {titleMonth}</span>
              </>
            ) : (
              "Detalle mensual"
            )}
          </DialogTitle>
          <DialogDescription className="text-left text-slate-600">
            {target?.client}
            <span className="block text-xs text-slate-500 mt-1">
              Vista: {partidaLabel} · Ingresos y gastos del mes seleccionado
            </span>
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando detalle…
          </div>
        )}

        {isError && (
          <p className="text-sm text-red-600 py-4">No se pudo cargar el detalle del mes.</p>
        )}

        {payload && !isLoading && (
          <div className="space-y-4 text-sm">
            <section className="rounded-lg border bg-slate-50 p-3">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Ingresos</h4>
              <p className="text-base font-semibold text-slate-900">
                Facturación efectiva del mes: {formatCurrency(payload.monthlyBilling)}
              </p>
            </section>

            <section className="rounded-lg border p-3">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Presupuesto por partida (mes)</h4>
              <ul className="grid grid-cols-2 gap-2 text-xs">
                <li className="flex justify-between gap-2"><span className="text-slate-600">Mano de obra</span><span className="font-medium tabular-nums">{formatCurrency(payload.laborBudget)}</span></li>
                <li className="flex justify-between gap-2"><span className="text-slate-600">Insumos</span><span className="font-medium tabular-nums">{formatCurrency(payload.suppliesBudget)}</span></li>
                <li className="flex justify-between gap-2"><span className="text-slate-600">Administrativo</span><span className="font-medium tabular-nums">{formatCurrency(payload.adminBudget)}</span></li>
                <li className="flex justify-between gap-2"><span className="text-slate-600">Utilidad</span><span className="font-medium tabular-nums">{formatCurrency(payload.profitBudget)}</span></li>
              </ul>
            </section>

            <section>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Gastos por tipo</h4>
              {expenseRows.length === 0 ? (
                <p className="text-slate-500 text-xs">Sin movimientos con monto en este mes.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded border">
                  <table className="w-full text-xs">
                    <tbody>
                      {expenseRows.map(([type, amount]) => (
                        <tr key={type} className="border-b last:border-0">
                          <td className="px-2 py-1.5 text-slate-700">{typeLabel(type)}</td>
                          <td className="px-2 py-1.5 text-right font-medium tabular-nums">{formatCurrency(amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">Total gastos (mes)</p>
                <p className="text-lg font-bold text-slate-900">{formatCurrency(payload.grandTotal)}</p>
                <p className="text-xs text-slate-500 mt-1">
                  Disponible / variación: {formatCurrency(payload.remaining)}
                </p>
              </div>
              <TrafficLightBadge light={payload.trafficLight} pct={payload.budgetUsagePctFormatted} />
            </section>

            {target && (
              <Button variant="outline" className="w-full gap-2" asChild>
                <Link href={`/contracts/${target.contractId}`}>
                  Abrir ficha del contrato
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
