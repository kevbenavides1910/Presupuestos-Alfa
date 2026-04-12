"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShirtIcon, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { uniformExpenseSchema, type UniformExpenseInput } from "@/lib/validations/expense.schema";
import { formatCurrency, formatMonthYear, toMonthString, getFirstDayOfMonth } from "@/lib/utils/format";
import { UNIFORM_ITEMS } from "@/lib/utils/constants";
import { format, subMonths, addMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  contractId: string;
  suppliesBudget: number;
}

export function UniformExpensesTab({ contractId, suppliesBudget }: Props) {
  const [selectedMonth, setSelectedMonth] = useState(getFirstDayOfMonth());
  const queryClient = useQueryClient();

  const monthStr = toMonthString(selectedMonth);

  const { data: expensesData } = useQuery({
    queryKey: ["uniforms", contractId, monthStr],
    queryFn: () => fetch(`/api/contracts/${contractId}/uniforms`).then((r) => r.json()),
  });

  const expenses = expensesData?.data ?? [];
  const currentMonthExpense = expenses.find((e: { periodMonth: string }) =>
    e.periodMonth.startsWith(monthStr)
  );

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<UniformExpenseInput>({
    resolver: zodResolver(uniformExpenseSchema),
    defaultValues: {
      contractId,
      periodMonth: monthStr,
      ...currentMonthExpense,
    },
  });

  // Compute live total
  const values = watch();
  let liveTotal = 0;
  for (const item of UNIFORM_ITEMS) {
    const qty = Number(values[item.qtyKey as keyof typeof values] ?? 0);
    const cost = Number(values[item.costKey as keyof typeof values] ?? 0);
    liveTotal += qty * cost;
  }

  const mutation = useMutation({
    mutationFn: (data: UniformExpenseInput) =>
      fetch(`/api/contracts/${contractId}/uniforms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uniforms", contractId] });
      queryClient.invalidateQueries({ queryKey: ["profitability", contractId] });
      toast.success("Gastos de uniformes guardados");
    },
    onError: () => toast.error("Error al guardar gastos"),
  });

  return (
    <div className="space-y-4">
      {/* Month selector */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => setSelectedMonth(subMonths(selectedMonth, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium w-32 text-center capitalize">
          {formatMonthYear(selectedMonth)}
        </span>
        <Button variant="outline" size="icon" onClick={() => setSelectedMonth(addMonths(selectedMonth, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* All months summary */}
      {expenses.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Historial de Gastos de Uniformes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="text-left px-4 py-2">Período</th>
                    <th className="text-right px-4 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e: { periodMonth: string; totalCost: number }) => (
                    <tr key={e.periodMonth} className="border-b">
                      <td className="px-4 py-2 capitalize">{formatMonthYear(e.periodMonth)}</td>
                      <td className="px-4 py-2 text-right font-medium">{formatCurrency(e.totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entry form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShirtIcon className="h-4 w-4" />
            Registro de Uniformes — {formatMonthYear(selectedMonth)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((data) => mutation.mutate({ ...data, periodMonth: monthStr }))}
            className="space-y-4"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 w-32">Artículo</th>
                    <th className="text-right py-2 px-2 w-24">Cantidad</th>
                    <th className="text-right py-2 px-2 w-36">Costo Unitario (₡)</th>
                    <th className="text-right py-2 pl-2 w-36">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {UNIFORM_ITEMS.map((item) => {
                    const qty = Number(watch(item.qtyKey as keyof UniformExpenseInput) ?? 0);
                    const cost = Number(watch(item.costKey as keyof UniformExpenseInput) ?? 0);
                    const subtotal = qty * cost;
                    return (
                      <tr key={item.key} className="border-b">
                        <td className="py-2 pr-4 font-medium">{item.label}</td>
                        <td className="py-2 px-2">
                          <Input
                            type="number"
                            min="0"
                            className="text-right h-8"
                            {...register(item.qtyKey as keyof UniformExpenseInput, { valueAsNumber: true })}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <Input
                            type="number"
                            min="0"
                            className="text-right h-8"
                            {...register(item.costKey as keyof UniformExpenseInput, { valueAsNumber: true })}
                          />
                        </td>
                        <td className="py-2 pl-2 text-right font-medium">
                          {subtotal > 0 ? formatCurrency(subtotal) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="py-2 pr-4">Otros descripción</td>
                    <td colSpan={2} className="py-2 px-2">
                      <Input {...register("otherDesc")} placeholder="Descripción de otros..." className="h-8" />
                    </td>
                    <td />
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="border-t-2">
                    <td colSpan={3} className="py-3 pr-4 text-right font-bold">Total:</td>
                    <td className="py-3 pl-2 text-right font-bold text-lg">{formatCurrency(liveTotal)}</td>
                  </tr>
                  {suppliesBudget > 0 && (
                    <tr>
                      <td colSpan={3} className="text-right text-xs text-slate-500 pb-3">
                        % del presupuesto de insumos:
                      </td>
                      <td className="text-right text-xs font-medium pb-3">
                        {((liveTotal / suppliesBudget) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={mutation.isPending} className="gap-2">
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar Registro
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
