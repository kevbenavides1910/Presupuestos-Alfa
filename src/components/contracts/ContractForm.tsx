"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Loader2, Plus, Trash2, MapPin, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { contractCreateSchema, type ContractCreateInput } from "@/lib/validations/contract.schema";
import { COMPANIES, COMPANY_LABELS, CLIENT_TYPE_LABELS, CONTRACT_STATUS_LABELS } from "@/lib/utils/constants";
import { canModifyContracts } from "@/lib/permissions";
import { format } from "date-fns";

interface PositionDraft {
  name: string;
  shift: string;
  location: string;
}

interface Props {
  /** En edición puede incluir `suppliesBudgetPct` (API) para migrar a `suppliesPct` si hace falta */
  defaultValues?: Partial<ContractCreateInput> & { id?: string; suppliesBudgetPct?: number };
  mode?: "create" | "edit";
}

export function ContractForm({ defaultValues, mode = "create" }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, status } = useSession();
  const canEdit =
    session?.user?.role !== undefined && canModifyContracts(session.user.role);

  // Inline positions (only for create mode)
  const [positions, setPositions] = useState<PositionDraft[]>([]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ContractCreateInput>({
    resolver: zodResolver(contractCreateSchema),
    defaultValues: (() => {
      const dv = { ...(defaultValues ?? {}) } as Record<string, unknown>;
      delete dv.suppliesBudgetPct;
      delete dv.id;
      const suppliesPct =
        typeof dv.suppliesPct === "number" && dv.suppliesPct > 0
          ? dv.suppliesPct
          : typeof defaultValues?.suppliesBudgetPct === "number"
            ? defaultValues.suppliesBudgetPct
            : 0;
      return {
        status: "ACTIVE",
        clientType: "PUBLIC",
        ...dv,
        suppliesPct,
        startDate: defaultValues?.startDate
          ? format(new Date(defaultValues.startDate as string), "yyyy-MM-dd")
          : "",
        endDate: defaultValues?.endDate
          ? format(new Date(defaultValues.endDate as string), "yyyy-MM-dd")
          : "",
      };
    })(),
  });

  const billing = watch("monthlyBilling") || 0;
  const laborPct    = watch("laborPct") || 0;
  const suppliesPctW = watch("suppliesPct") || 0;
  const adminPct    = watch("adminPct") || 0;
  const profitPct   = watch("profitPct") || 0;

  // Create contract then positions
  const mutation = useMutation({
    mutationFn: async (data: ContractCreateInput) => {
      const url = mode === "edit" ? `/api/contracts/${defaultValues?.id}` : "/api/contracts";
      const method = mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? "Error desconocido");
      }
      const result = await res.json();
      const contractId = result.data.id;

      // Create positions if any were defined
      if (mode === "create" && positions.length > 0) {
        await Promise.all(
          positions
            .filter(p => p.name.trim())
            .map(p =>
              fetch(`/api/contracts/${contractId}/positions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: p.name.trim(),
                  shift: p.shift.trim() || undefined,
                  location: p.location.trim() || undefined,
                }),
              })
            )
        );
      }

      return result;
    },
    onSuccess: (data) => {
      const contractId = data.data.id as string;
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
      queryClient.invalidateQueries({ queryKey: ["contract", contractId] });
      queryClient.invalidateQueries({ queryKey: ["profitability", contractId] });
      toast.success(mode === "edit" ? "Contrato actualizado" : "Contrato creado exitosamente");
      router.push(`/contracts/${contractId}`);
    },
    onError: (e: Error) => toast.error("Error", e.message),
  });

  const onSubmit = (data: ContractCreateInput) => mutation.mutate(data);

  if (status === "loading") {
    return (
      <div className="p-8 text-center text-slate-400 text-sm">Cargando permisos…</div>
    );
  }

  if (!canEdit) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-4">
          <p className="text-slate-600">No tenés permiso para crear o modificar contratos (perfiles Comercial, Supervisor o Administrador).</p>
          <Button asChild variant="outline">
            <Link href="/contracts">Volver a contratos</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  function addPosition() {
    setPositions(prev => [...prev, { name: "", shift: "", location: "" }]);
  }

  function removePosition(i: number) {
    setPositions(prev => prev.filter((_, idx) => idx !== i));
  }

  function updatePosition(i: number, field: keyof PositionDraft, value: string) {
    setPositions(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p));
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* ── Información General ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Información General</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="licitacionNo">N° de Licitación *</Label>
            <Input
              id="licitacionNo"
              {...register("licitacionNo")}
              placeholder="LIC-CCSS-001-2024"
              disabled={mode === "edit"}
            />
            {errors.licitacionNo && <p className="text-xs text-red-600">{errors.licitacionNo.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Empresa *</Label>
            <Select
              defaultValue={defaultValues?.company}
              onValueChange={(v) => setValue("company", v as never)}
            >
              <SelectTrigger><SelectValue placeholder="Seleccionar empresa" /></SelectTrigger>
              <SelectContent>
                {COMPANIES.map((c) => (
                  <SelectItem key={c} value={c}>{COMPANY_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.company && <p className="text-xs text-red-600">{errors.company.message}</p>}
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <Label htmlFor="client">Cliente / Institución *</Label>
            <Input id="client" {...register("client")} placeholder="CCSS - Hospital México" />
            {errors.client && <p className="text-xs text-red-600">{errors.client.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Tipo de Cliente *</Label>
            <Select
              defaultValue={defaultValues?.clientType ?? "PUBLIC"}
              onValueChange={(v) => setValue("clientType", v as never)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CLIENT_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Estado *</Label>
            <Select
              defaultValue={defaultValues?.status ?? "ACTIVE"}
              onValueChange={(v) => setValue("status", v as never)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CONTRACT_STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Personal y Puestos ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal y Puestos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="officersCount">Cantidad de Oficiales *</Label>
              <Input
                id="officersCount"
                type="number"
                min="1"
                {...register("officersCount", { valueAsNumber: true })}
              />
              {errors.officersCount && <p className="text-xs text-red-600">{errors.officersCount.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="positionsCount">Cantidad de Puestos *</Label>
              <Input
                id="positionsCount"
                type="number"
                min="1"
                {...register("positionsCount", { valueAsNumber: true })}
              />
              {errors.positionsCount && <p className="text-xs text-red-600">{errors.positionsCount.message}</p>}
            </div>
          </div>

          {/* Inline position definition — only on create */}
          {mode === "create" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-700">Definir puestos</p>
                  <p className="text-xs text-slate-400">Opcional — también puedes agregarlos después desde el detalle del contrato.</p>
                </div>
                <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={addPosition}>
                  <Plus className="h-3.5 w-3.5" /> Agregar puesto
                </Button>
              </div>

              {positions.length > 0 && (
                <div className="space-y-2">
                  {positions.map((pos, i) => (
                    <div key={i} className="flex gap-2 items-start p-3 bg-slate-50 rounded-lg border">
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-500">Nombre del puesto *</Label>
                          <Input
                            size={1}
                            className="h-8 text-sm"
                            placeholder="Ej: Control de Acceso Norte"
                            value={pos.name}
                            onChange={e => updatePosition(i, "name", e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-500 flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Turno
                          </Label>
                          <Input
                            size={1}
                            className="h-8 text-sm"
                            placeholder="Ej: Diurno, Nocturno, 24h"
                            value={pos.shift}
                            onChange={e => updatePosition(i, "shift", e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-500 flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> Ubicación
                          </Label>
                          <Input
                            size={1}
                            className="h-8 text-sm"
                            placeholder="Ej: Edificio A, Entrada Principal"
                            value={pos.location}
                            onChange={e => updatePosition(i, "location", e.target.value)}
                          />
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:bg-red-50 mt-5 shrink-0"
                        onClick={() => removePosition(i)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Facturación y Presupuesto ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Facturación y Presupuesto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="monthlyBilling">Facturación Mensual (₡) *</Label>
              <Input
                id="monthlyBilling"
                type="number"
                min="0"
                {...register("monthlyBilling", { valueAsNumber: true })}
                placeholder="18500000"
              />
              {errors.monthlyBilling && <p className="text-xs text-red-600">{errors.monthlyBilling.message}</p>}
            </div>
            <div className="text-sm text-slate-500 flex items-end pb-1">
              El <strong className="font-medium text-slate-700">presupuesto de insumos</strong> (rentabilidad, equivalencias y reportes) se calcula con el porcentaje de la tarjeta <strong className="font-medium text-purple-800">Insumos</strong> abajo, no con un campo aparte.
            </div>
          </div>

          {/* Budget distribution */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700">Distribución del contrato</p>
                <p className="text-xs text-slate-400">
                  Ingrese el % de cada rubro sobre la facturación mensual. La suma debe ser 100%.
                  El rubro <span className="font-medium text-purple-800">Insumos</span> define el % destinado al presupuesto de insumos del contrato.
                </p>
              </div>
              <div className={`text-sm font-bold px-3 py-1 rounded-full ${
                Math.abs((laborPct + suppliesPctW + adminPct + profitPct) - 1) < 0.001
                  ? "bg-green-100 text-green-700"
                  : (laborPct + suppliesPctW + adminPct + profitPct) > 0
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-slate-100 text-slate-500"
              }`}>
                {(((laborPct || 0) + (suppliesPctW || 0) + (adminPct || 0) + (profitPct || 0)) * 100).toFixed(1)}%
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { id: "laborPct",    label: "Mano de obra",          color: "text-blue-700",   bg: "bg-blue-50",   field: "laborPct" as const },
                { id: "suppliesPct", label: "Insumos (presupuesto)", color: "text-purple-700", bg: "bg-purple-50", field: "suppliesPct" as const },
                { id: "adminPct",    label: "Gasto administrativo",  color: "text-orange-700", bg: "bg-orange-50", field: "adminPct" as const },
                { id: "profitPct",   label: "Utilidad",              color: "text-green-700",  bg: "bg-green-50",  field: "profitPct" as const },
              ].map(item => {
                const watchedVal = watch(item.field) || 0;
                const amount = billing * watchedVal;
                return (
                  <div key={item.id} className={`space-y-1.5 p-3 rounded-lg border ${item.bg}`}>
                    <Label htmlFor={item.id} className={`text-xs font-semibold ${item.color}`}>{item.label}</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        id={item.id}
                        type="number"
                        step="0.001"
                        min="0"
                        max="1"
                        className="h-8 text-sm bg-white"
                        {...register(item.field, { valueAsNumber: true })}
                        placeholder="0.00"
                      />
                      <span className="text-xs text-slate-500 shrink-0">
                        {((watchedVal || 0) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className={`text-xs font-medium ${item.color}`}>
                      ₡{amount.toLocaleString("es-CR", { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                );
              })}
            </div>
            {errors.suppliesPct && (
              <p className="text-xs text-red-600">{errors.suppliesPct.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Vigencia ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vigencia</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="startDate">Fecha de Inicio *</Label>
            <Input id="startDate" type="date" {...register("startDate")} />
            {errors.startDate && <p className="text-xs text-red-600">{errors.startDate.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endDate">Fecha de Cierre *</Label>
            <Input id="endDate" type="date" {...register("endDate")} />
            {errors.endDate && <p className="text-xs text-red-600">{errors.endDate.message}</p>}
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <textarea
              id="notes"
              {...register("notes")}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              placeholder="Observaciones adicionales..."
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-end">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {mode === "edit" ? "Guardar Cambios" : "Crear Contrato"}
        </Button>
      </div>
    </form>
  );
}
