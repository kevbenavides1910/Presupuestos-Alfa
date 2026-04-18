"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Save, FileSpreadsheet } from "lucide-react";
import { exportRowsToExcel } from "@/lib/utils/excel-export";

type UserOpt = { id: string; name: string; email: string; isActive: boolean };

type ChainRow = {
  expenseType: string;
  steps: { id: string; stepOrder: number; approverUserId: string; approver?: { name: string; email: string } }[];
};

/** Misma lista que en la API; sirve de respaldo si la respuesta viene mal formada. */
const EXPENSE_TYPES_ORDER: string[] = [
  "APERTURA",
  "UNIFORMS",
  "AUDIT",
  "ADMIN",
  "TRANSPORT",
  "FUEL",
  "PHONES",
  "PLANILLA",
  "OTHER",
];

function emptyChainsFallback(): ChainRow[] {
  return EXPENSE_TYPES_ORDER.map((expenseType) => ({ expenseType, steps: [] }));
}

export function ExpenseApprovalChainsTab({ readOnly }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string[]>>({});

  const {
    data: chainsRes,
    isLoading: chainsLoading,
    isError: chainsError,
    error: chainsErr,
    refetch: refetchChains,
  } = useQuery<{ data: ChainRow[] }>({
    queryKey: ["expense-approval-chains"],
    queryFn: async () => {
      const r = await fetch("/api/admin/catalogs/expense-type-approval-steps", { credentials: "same-origin" });
      const j = (await r.json()) as { data?: ChainRow[]; error?: { message?: string; detail?: string } };
      if (!r.ok) {
        const parts = [j.error?.message, j.error?.detail].filter(Boolean);
        throw new Error(parts.length ? parts.join(" — ") : `No se pudo cargar la configuración (${r.status})`);
      }
      if (!Array.isArray(j.data)) {
        throw new Error("Respuesta inválida del servidor (falta data). ¿Ejecutó prisma migrate deploy?");
      }
      return { data: j.data };
    },
    enabled: !readOnly,
  });

  const {
    data: usersRes,
    isLoading: usersLoading,
    isError: usersError,
    error: usersErr,
    refetch: refetchUsers,
  } = useQuery<{ data: UserOpt[] }>({
    queryKey: ["users-admin-approval"],
    queryFn: async () => {
      const r = await fetch("/api/users", { credentials: "same-origin" });
      const j = (await r.json()) as { data?: UserOpt[]; error?: { message?: string; detail?: string } };
      if (!r.ok) {
        const parts = [j.error?.message, j.error?.detail].filter(Boolean);
        throw new Error(parts.length ? parts.join(" — ") : `Error al cargar usuarios (${r.status})`);
      }
      if (!Array.isArray(j.data)) throw new Error("Respuesta inválida al cargar usuarios");
      return { data: j.data };
    },
    enabled: !readOnly,
  });

  const users = (usersRes?.data ?? []).filter((u) => u.isActive);

  useEffect(() => {
    const rows = chainsRes?.data;
    if (!rows) return;
    const next: Record<string, string[]> = {};
    if (rows.length === 0) {
      for (const t of EXPENSE_TYPES_ORDER) next[t] = [];
      setDraft(next);
      return;
    }
    type Step = ChainRow["steps"][number];
    for (const r of rows) {
      next[r.expenseType] = r.steps.length
        ? [...r.steps].sort((a: Step, b: Step) => a.stepOrder - b.stepOrder).map((s: Step) => s.approverUserId)
        : [];
    }
    setDraft(next);
  }, [chainsRes]);

  const saveMutation = useMutation({
    mutationFn: async (payload: { expenseType: string; steps: { approverUserId: string }[] }) => {
      const r = await fetch("/api/admin/catalogs/expense-type-approval-steps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "same-origin",
      });
      const j = (await r.json()) as { error?: { message?: string; detail?: string } };
      if (!r.ok) {
        const parts = [j.error?.message, j.error?.detail].filter(Boolean);
        throw new Error(parts.length ? parts.join(" — ") : "Error al guardar");
      }
      return j;
    },
    onSuccess: () => {
      toast.success("Cadena de aprobación guardada");
      qc.invalidateQueries({ queryKey: ["expense-approval-chains"] });
    },
    onError: (e: Error) => toast.error(e.message || "Error al guardar"),
  });

  if (readOnly) {
    return <p className="text-sm text-slate-500">Solo administradores configuran las aprobaciones por tipo de gasto.</p>;
  }

  if (chainsLoading) return <div className="p-8 text-center text-slate-400">Cargando…</div>;

  if (chainsError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 space-y-2">
        <p className="font-semibold">No se pudo cargar la configuración de aprobaciones</p>
        <p>{chainsErr instanceof Error ? chainsErr.message : "Error desconocido"}</p>
        <p className="text-xs text-red-800">
          Si acaba de actualizar la aplicación, en el servidor ejecute{" "}
          <code className="rounded bg-white px-1 py-0.5 border border-red-200">npx prisma migrate deploy</code> y reinicie
          el contenedor o el proceso Node.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => refetchChains()}>
          Reintentar
        </Button>
      </div>
    );
  }

  const groups = chainsRes?.data?.length ? chainsRes.data : emptyChainsFallback();

  function setApproversForType(type: string, approverIds: string[]) {
    setDraft((d) => ({ ...d, [type]: approverIds }));
  }

  function addStep(type: string) {
    const cur = draft[type] ?? [];
    const firstUserId = users[0]?.id ?? "";
    setApproversForType(type, [...cur, firstUserId]);
  }

  function removeStep(type: string, index: number) {
    const cur = draft[type] ?? [];
    setApproversForType(
      type,
      cur.filter((_, i) => i !== index)
    );
  }

  function setStepUser(type: string, index: number, userId: string) {
    const cur = [...(draft[type] ?? [])];
    cur[index] = userId;
    setApproversForType(type, cur);
  }

  function handleExport() {
    const userMap = new Map(users.map((u) => [u.id, u]));
    const exportRows: Array<Record<string, string | number>> = [];
    for (const g of groups) {
      const steps = draft[g.expenseType] ?? [];
      if (steps.length === 0) {
        exportRows.push({
          "Tipo de gasto": g.expenseType,
          "Paso": "",
          Aprobador: "(Sin aprobaciones)",
          Email: "",
        });
      } else {
        steps.forEach((uid, i) => {
          const u = userMap.get(uid);
          exportRows.push({
            "Tipo de gasto": g.expenseType,
            "Paso": i + 1,
            Aprobador: u?.name ?? uid,
            Email: u?.email ?? "",
          });
        });
      }
    }
    exportRowsToExcel({
      filename: "cadenas_de_aprobacion",
      sheetName: "Aprobaciones",
      rows: exportRows,
      columnWidths: [16, 8, 28, 32],
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-slate-600 max-w-2xl">
          Defina el orden de aprobación por tipo de gasto. El paso 1 aprueba primero, luego el 2, etc. Si no hay pasos, el gasto queda{" "}
          <strong>aprobado</strong> al registrarlo. Los usuarios deben existir y estar activos.
        </p>
        <Button
          type="button"
          variant="outline"
          className="gap-2 shrink-0"
          onClick={handleExport}
          disabled={groups.length === 0}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Exportar a Excel
        </Button>
      </div>

      {usersError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 space-y-2">
          <p className="font-medium">No se pudo cargar la lista de usuarios</p>
          <p>{usersErr instanceof Error ? usersErr.message : "Error desconocido"}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => refetchUsers()}>
            Reintentar usuarios
          </Button>
        </div>
      )}

      {usersLoading && !usersError && (
        <p className="text-xs text-slate-500">Cargando usuarios para los selectores…</p>
      )}

      <div className="space-y-4">
        {groups.map((g) => {
          const steps = draft[g.expenseType] ?? [];
          return (
            <div key={g.expenseType} className="border rounded-lg p-4 space-y-3 bg-slate-50/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-sm font-semibold text-slate-800">{g.expenseType}</div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={usersLoading || usersError || users.length === 0}
                    onClick={() => addStep(g.expenseType)}
                  >
                    <Plus className="h-3.5 w-3.5" /> Paso
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1"
                    onClick={() =>
                      saveMutation.mutate({
                        expenseType: g.expenseType,
                        steps: steps.map((approverUserId) => ({ approverUserId })),
                      })
                    }
                    disabled={saveMutation.isPending || usersLoading || usersError || users.length === 0}
                  >
                    <Save className="h-3.5 w-3.5" /> Guardar
                  </Button>
                </div>
              </div>

              {usersError ? (
                <p className="text-xs text-amber-800">Corrija la carga de usuarios arriba para poder asignar aprobadores.</p>
              ) : !usersLoading && users.length === 0 ? (
                <p className="text-xs text-amber-700">No hay usuarios activos en el sistema.</p>
              ) : steps.length === 0 ? (
                <p className="text-xs text-slate-500">Sin aprobaciones: el gasto quedará confirmado al crearse.</p>
              ) : (
                <ol className="list-decimal list-inside space-y-2">
                  {steps.map((uid, idx) => (
                    <li key={`${g.expenseType}-${idx}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-500 w-16">Paso {idx + 1}</span>
                      <Select value={uid} onValueChange={(v) => setStepUser(g.expenseType, idx, v)}>
                        <SelectTrigger className="h-9 w-64">
                          <SelectValue placeholder="Usuario" />
                        </SelectTrigger>
                        <SelectContent>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} ({u.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-red-600"
                        onClick={() => removeStep(g.expenseType, idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
