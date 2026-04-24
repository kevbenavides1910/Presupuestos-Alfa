"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { exportRowsToExcel } from "@/lib/utils/excel-export";

interface ZoneRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  disciplinaryAdministrator: string | null;
  disciplinaryAdministratorEmail: string | null;
  locationsCount: number;
}

export function ZonesTab({ readOnly }: { readOnly?: boolean }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ data: ZoneRow[] }>({
    queryKey: ["admin-zones"],
    queryFn: () => fetch("/api/admin/catalogs/zones").then((r) => r.json()),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<ZoneRow | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    isActive: true,
    sortOrder: 0,
    disciplinaryAdministrator: "",
    disciplinaryAdministratorEmail: "",
  });

  function openAdd() {
    const rows = data?.data ?? [];
    setForm({
      name: "",
      description: "",
      isActive: true,
      sortOrder: rows.length ? Math.max(...rows.map((r) => r.sortOrder)) + 1 : 1,
      disciplinaryAdministrator: "",
      disciplinaryAdministratorEmail: "",
    });
    setEditItem(null);
    setShowAdd(true);
  }

  function openEdit(item: ZoneRow) {
    setForm({
      name: item.name,
      description: item.description ?? "",
      isActive: item.isActive,
      sortOrder: item.sortOrder,
      disciplinaryAdministrator: item.disciplinaryAdministrator ?? "",
      disciplinaryAdministratorEmail: item.disciplinaryAdministratorEmail ?? "",
    });
    setEditItem(item);
    setShowAdd(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      id?: string;
      name: string;
      description: string;
      isActive: boolean;
      sortOrder: number;
      disciplinaryAdministrator: string;
      disciplinaryAdministratorEmail: string;
    }) => {
      const body = {
        name: payload.name,
        description: payload.description.trim() ? payload.description.trim() : null,
        isActive: payload.isActive,
        sortOrder: payload.sortOrder,
        disciplinaryAdministrator: payload.disciplinaryAdministrator.trim()
          ? payload.disciplinaryAdministrator.trim()
          : null,
        disciplinaryAdministratorEmail: payload.disciplinaryAdministratorEmail.trim()
          ? payload.disciplinaryAdministratorEmail.trim()
          : null,
      };
      const url = payload.id ? `/api/admin/catalogs/zones/${payload.id}` : "/api/admin/catalogs/zones";
      const method = payload.id ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await r.json()) as { data?: unknown; error?: { message?: string } };
      if (!r.ok || json.error) throw new Error(json.error?.message ?? `Error ${r.status}`);
      return json;
    },
    onSuccess: () => {
      toast.success(editItem ? "Zona actualizada" : "Zona creada");
      qc.invalidateQueries({ queryKey: ["admin-zones"] });
      qc.invalidateQueries({ queryKey: ["admin-locations"] });
      qc.invalidateQueries({ queryKey: ["zones-active"] });
      setShowAdd(false);
      setEditItem(null);
    },
    onError: (e: Error) => toast.error(e.message || "Error al guardar"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/catalogs/zones/${id}`, { method: "DELETE" });
      const json = (await r.json()) as {
        data?: { warning?: string; deleted?: boolean };
        error?: { message?: string };
      };
      if (!r.ok || json.error) throw new Error(json.error?.message ?? `Error ${r.status}`);
      return json;
    },
    onSuccess: (res) => {
      const warning = res.data && "warning" in res.data ? res.data.warning : undefined;
      if (warning) toast.error(warning);
      else toast.success("Zona eliminada");
      qc.invalidateQueries({ queryKey: ["admin-zones"] });
      qc.invalidateQueries({ queryKey: ["admin-locations"] });
      qc.invalidateQueries({ queryKey: ["zones-active"] });
    },
    onError: (e: Error) => toast.error(e.message || "Error al eliminar"),
  });

  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-slate-500 max-w-2xl">
          Cree zonas geográficas u operativas (ej. <em>GAM</em>, <em>Pacífico</em>, <em>Caribe</em>) para agrupar
          ubicaciones de los contratos. Use la pestaña <strong className="text-slate-700">Ubicaciones</strong> para
          asignar la zona a cada ubicación. El <strong>administrador disciplinario</strong> y su correo se usan al
          importar apercibimientos cuando la columna «Zona» coincide con el <strong>nombre</strong> de la zona (y en
          copia de correo al enviar marcas por SMTP).
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={rows.length === 0}
            onClick={() => {
              const exportRows = rows.map((z) => ({
                Nombre: z.name,
                Descripción: z.description ?? "",
                "Administrador disciplinario": z.disciplinaryAdministrator ?? "",
                "Correo administrador": z.disciplinaryAdministratorEmail ?? "",
                Ubicaciones: z.locationsCount,
                Estado: z.isActive ? "Activa" : "Inactiva",
                Orden: z.sortOrder,
              }));
              exportRowsToExcel({
                filename: "zonas",
                sheetName: "Zonas",
                rows: exportRows,
                columnWidths: [24, 28, 26, 28, 14, 12, 10],
              });
            }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Exportar a Excel ({rows.length})
          </Button>
          {!readOnly && (
            <Button className="gap-2" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Nueva zona
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-slate-400">Cargando...</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-slate-400 border rounded-lg">
          No hay zonas configuradas. Cree la primera con el botón de arriba.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Nombre</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Descripción</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 min-w-[9rem]">Adm. disciplinario</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 min-w-[9rem]">Correo adm.</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 w-32">Ubicaciones</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 w-24">Estado</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 w-20">Orden</th>
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((z) => (
                <tr key={z.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{z.name}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{z.description ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700 text-xs">{z.disciplinaryAdministrator ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs break-all max-w-[12rem]">
                    {z.disciplinaryAdministratorEmail ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">
                      {z.locationsCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={z.isActive ? "success" : "secondary"}>
                      {z.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center text-slate-500">{z.sortOrder}</td>
                  <td className="px-4 py-3">
                    {!readOnly && (
                      <div className="flex items-center gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(z)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:bg-red-50"
                          onClick={() => {
                            if (confirm(`¿Eliminar la zona "${z.name}"?`)) deleteMutation.mutate(z.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showAdd && !readOnly} onOpenChange={(v) => { if (!v) { setShowAdd(false); setEditItem(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editItem ? "Editar zona" : "Nueva zona"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Nombre *</label>
              <Input
                placeholder="Ej: GAM, Pacífico, Caribe..."
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Descripción</label>
              <Input
                placeholder="Opcional"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Administrador disciplinario</label>
              <Input
                placeholder="Nombre del administrador de zona (disciplinario)"
                value={form.disciplinaryAdministrator}
                onChange={(e) => setForm((f) => ({ ...f, disciplinaryAdministrator: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Correo del administrador</label>
              <Input
                type="email"
                placeholder="correo@empresa.com (CC en envío de marcas)"
                value={form.disciplinaryAdministratorEmail}
                onChange={(e) => setForm((f) => ({ ...f, disciplinaryAdministratorEmail: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Orden</label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                  className="text-center"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Estado</label>
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-sm text-slate-600">Activa</span>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAdd(false); setEditItem(null); }}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                const name = form.name.trim();
                if (!name) {
                  toast.error("Ingrese un nombre");
                  return;
                }
                saveMutation.mutate({ id: editItem?.id, ...form, name });
              }}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
