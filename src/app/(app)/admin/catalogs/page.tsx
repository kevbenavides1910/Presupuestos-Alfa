"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Save, GripVertical, Info, FileSpreadsheet } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { exportRowsToExcel } from "@/lib/utils/excel-export";
import { isAdmin } from "@/lib/permissions";
import { ExpenseApprovalChainsTab } from "@/components/admin/ExpenseApprovalChainsTab";
import { BrandingAppearanceTab } from "@/components/admin/BrandingAppearanceTab";
import { AssetTypesTab } from "@/components/admin/AssetTypesTab";
import { ZonesTab } from "@/components/admin/ZonesTab";
import { LocationsTab } from "@/components/admin/LocationsTab";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ExpenseTypeConfig {
  id: string;
  type: string;
  label: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
}

interface ExpenseOrigin {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

interface CompanyCatalogRow {
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

// Predefined color options for expense types
const COLOR_OPTIONS = [
  { label: "Azul",      value: "bg-blue-100 text-blue-800" },
  { label: "Morado",    value: "bg-purple-100 text-purple-800" },
  { label: "Naranja",   value: "bg-orange-100 text-orange-800" },
  { label: "Gris azul", value: "bg-slate-100 text-slate-700" },
  { label: "Cian",      value: "bg-cyan-100 text-cyan-800" },
  { label: "Amarillo",  value: "bg-yellow-100 text-yellow-800" },
  { label: "Verde",     value: "bg-green-100 text-green-800" },
  { label: "Esmeralda", value: "bg-emerald-100 text-emerald-800" },
  { label: "Gris",      value: "bg-gray-100 text-gray-700" },
  { label: "Rojo",      value: "bg-red-100 text-red-800" },
  { label: "Rosa",      value: "bg-pink-100 text-pink-800" },
  { label: "Índigo",    value: "bg-indigo-100 text-indigo-800" },
  { label: "Lima",      value: "bg-lime-100 text-lime-800" },
];

// ── Expense Types Tab ─────────────────────────────────────────────────────────
function ExpenseTypesTab({ readOnly }: { readOnly?: boolean }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ data: ExpenseTypeConfig[] }>({
    queryKey: ["expense-type-configs"],
    queryFn: () => fetch("/api/admin/catalogs/expense-types").then(r => r.json()),
  });

  const [configs, setConfigs] = useState<ExpenseTypeConfig[] | null>(null);
  const [showTypeInfo, setShowTypeInfo] = useState(false);
  const rows = configs ?? data?.data ?? [];

  useEffect(() => {
    if (data?.data) {
      setConfigs(data.data.map((r) => ({ ...r })));
    }
  }, [data]);

  const deleteMutation = useMutation({
    mutationFn: (type: string) =>
      fetch(`/api/admin/catalogs/expense-types/${encodeURIComponent(type)}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) {
        toast.error(res.error?.message ?? "Error al restablecer");
        return;
      }
      toast.success(res.data?.message ?? "Tipo restablecido a valores por defecto");
      qc.invalidateQueries({ queryKey: ["expense-type-configs"] });
    },
    onError: () => toast.error("Error al restablecer"),
  });

  const saveMutation = useMutation({
    mutationFn: (items: ExpenseTypeConfig[]) =>
      fetch("/api/admin/catalogs/expense-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items.map(({ id: _id, ...rest }) => rest as unknown)),
      }).then(r => r.json()),
    onSuccess: (res) => {
      if (res.error) { toast.error(res.error.message ?? "Error al guardar"); return; }
      toast.success("Tipos de gasto guardados");
      qc.invalidateQueries({ queryKey: ["expense-type-configs"] });
      setConfigs(null);
    },
    onError: () => toast.error("Error al guardar"),
  });

  function updateRow(type: string, field: keyof ExpenseTypeConfig, value: unknown) {
    setConfigs(prev => (prev ?? data?.data ?? []).map(r => r.type === type ? { ...r, [field]: value } : r));
  }

  if (isLoading) return <div className="p-8 text-center text-slate-400">Cargando...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-slate-500">
            Configure las etiquetas y colores de los tipos de gasto del sistema.
          </p>
          <p className="text-xs text-slate-400 flex items-start gap-1.5 max-w-xl">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Los tipos de gasto son <strong className="font-medium text-slate-600">9 categorías fijas</strong> (definidas en la base de datos).
            No se pueden crear categorías nuevas desde aquí; use <strong className="font-medium text-slate-600">Otros</strong> para gastos que no encajen.
            Desmarque <strong className="font-medium text-slate-600">Activo</strong> para ocultar un tipo en los formularios.
            Use <strong className="font-medium text-slate-600">Restablecer</strong> para volver a etiqueta y color por defecto.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={rows.length === 0}
            onClick={() => {
              const exportRows = rows.map((r) => ({
                Tipo: r.type,
                Etiqueta: r.label,
                Color: r.color,
                Activo: r.isActive ? "Sí" : "No",
                Orden: r.sortOrder,
              }));
              exportRowsToExcel({
                filename: "tipos_de_gasto",
                sheetName: "Tipos de gasto",
                rows: exportRows,
                columnWidths: [16, 22, 32, 8, 8],
              });
            }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Exportar a Excel ({rows.length})
          </Button>
          {!readOnly && (
            <>
              <Button variant="outline" className="gap-2" onClick={() => setShowTypeInfo(true)}>
                <Plus className="h-4 w-4" />
                ¿Agregar tipo?
              </Button>
              <Button
                className="gap-2"
                onClick={() => saveMutation.mutate(rows)}
                disabled={saveMutation.isPending}
              >
                <Save className="h-4 w-4" />
                {saveMutation.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </>
          )}
        </div>
      </div>

      <Dialog open={showTypeInfo} onOpenChange={setShowTypeInfo}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar tipos de gasto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-slate-600 py-1">
            <p>
              El sistema solo admite las ocho categorías listadas en la tabla (Apertura, Uniformes, Auditoría, etc.).
              No es posible añadir una novena categoría desde esta pantalla.
            </p>
            <p>
              Para gastos varios use el tipo <strong>Otros</strong>. Para dejar de usar una categoría, desactívela con la casilla <strong>Activo</strong>.
            </p>
            <p className="text-xs text-slate-500">
              Si en el futuro necesita más categorías, eso requiere cambios en la aplicación y en la base de datos (enum de tipos).
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowTypeInfo(false)}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b">
              <th className="text-left px-4 py-3 font-semibold text-slate-600 w-8">#</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600 w-28">Tipo</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Etiqueta</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600 w-52">Color</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600 w-20">Vista previa</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600 w-20">Activo</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600 w-20">Orden</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600 w-24">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.type} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-slate-400">
                  <GripVertical className="h-4 w-4" />
                </td>
                <td className="px-4 py-3">
                  <code className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{row.type}</code>
                </td>
                <td className="px-4 py-3">
                  <Input
                    value={row.label}
                    onChange={e => updateRow(row.type, "label", e.target.value)}
                    className="h-8 text-sm"
                    disabled={readOnly}
                  />
                </td>
                <td className="px-4 py-3">
                  <select
                    value={row.color}
                    onChange={e => updateRow(row.type, "color", e.target.value)}
                    className="w-full h-8 text-xs border rounded-md px-2 bg-white"
                    disabled={readOnly}
                  >
                    {COLOR_OPTIONS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                    {/* Allow keeping custom values not in predefined list */}
                    {!COLOR_OPTIONS.find(c => c.value === row.color) && (
                      <option value={row.color}>{row.color}</option>
                    )}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${row.color}`}>
                    {row.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={row.isActive}
                    onChange={e => updateRow(row.type, "isActive", e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    disabled={readOnly}
                  />
                </td>
                <td className="px-4 py-3">
                  <Input
                    type="number"
                    value={row.sortOrder}
                    onChange={e => updateRow(row.type, "sortOrder", parseInt(e.target.value) || 0)}
                    className="h-8 text-sm w-16 text-center"
                    disabled={readOnly}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                      title="Quitar personalización y volver a etiqueta y color por defecto"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (
                          confirm(
                            `¿Restablecer "${row.type}" a la etiqueta y color por defecto? Se eliminará la personalización guardada en base de datos.`
                          )
                        ) {
                          deleteMutation.mutate(row.type);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Origins Tab ───────────────────────────────────────────────────────────────
function OriginsTab({ readOnly }: { readOnly?: boolean }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ data: ExpenseOrigin[] }>({
    queryKey: ["expense-origins-admin"],
    queryFn: () => fetch("/api/admin/catalogs/origins").then(r => r.json()),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<ExpenseOrigin | null>(null);
  const [form, setForm] = useState({ name: "", isActive: true, sortOrder: 0 });

  function openAdd() {
    setForm({ name: "", isActive: true, sortOrder: (data?.data?.length ?? 0) + 1 });
    setShowAdd(true);
    setEditItem(null);
  }

  function openEdit(item: ExpenseOrigin) {
    setForm({ name: item.name, isActive: item.isActive, sortOrder: item.sortOrder });
    setEditItem(item);
    setShowAdd(true);
  }

  const saveMutation = useMutation({
    mutationFn: (payload: { id?: string; name: string; isActive: boolean; sortOrder: number }) => {
      if (payload.id) {
        return fetch(`/api/admin/catalogs/origins/${payload.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: payload.name, isActive: payload.isActive, sortOrder: payload.sortOrder }),
        }).then(r => r.json());
      }
      return fetch("/api/admin/catalogs/origins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: payload.name, isActive: payload.isActive, sortOrder: payload.sortOrder }),
      }).then(r => r.json());
    },
    onSuccess: (res) => {
      if (res.error) { toast.error(res.error.message ?? "Error al guardar"); return; }
      toast.success(editItem ? "Origen actualizado" : "Origen creado");
      qc.invalidateQueries({ queryKey: ["expense-origins-admin"] });
      qc.invalidateQueries({ queryKey: ["expense-origins"] });
      setShowAdd(false);
      setEditItem(null);
    },
    onError: () => toast.error("Error al guardar"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/admin/catalogs/origins/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: (res) => {
      if (res.error) { toast.error(res.error.message ?? "Error al eliminar"); return; }
      if (res.data?.warning) {
        toast.error(res.data.warning);
      } else {
        toast.success("Origen eliminado");
      }
      qc.invalidateQueries({ queryKey: ["expense-origins-admin"] });
      qc.invalidateQueries({ queryKey: ["expense-origins"] });
    },
    onError: () => toast.error("Error al eliminar"),
  });

  const origins = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Configure los orígenes disponibles al registrar gastos (Orden de compra, Transferencia, etc.).</p>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={origins.length === 0}
            onClick={() => {
              const exportRows = origins.map((o) => ({
                Nombre: o.name,
                Estado: o.isActive ? "Activo" : "Inactivo",
                Orden: o.sortOrder,
              }));
              exportRowsToExcel({
                filename: "origenes_de_gasto",
                sheetName: "Orígenes",
                rows: exportRows,
                columnWidths: [32, 12, 8],
              });
            }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Exportar a Excel ({origins.length})
          </Button>
          {!readOnly && (
            <Button className="gap-2" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Agregar Origen
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-slate-400">Cargando...</div>
      ) : origins.length === 0 ? (
        <div className="p-8 text-center text-slate-400 border rounded-lg">
          No hay orígenes configurados. Agregue el primero con el botón de arriba.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Nombre</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 w-24">Estado</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 w-20">Orden</th>
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {origins.map(o => (
                <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{o.name}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={o.isActive ? "success" : "secondary"}>
                      {o.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center text-slate-500">{o.sortOrder}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {!readOnly && (
                        <>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(o)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="text-red-500 hover:bg-red-50"
                        onClick={() => {
                          if (confirm(`¿Eliminar el origen "${o.name}"?`)) deleteMutation.mutate(o.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit modal */}
      <Dialog open={showAdd && !readOnly} onOpenChange={v => { if (!v) { setShowAdd(false); setEditItem(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editItem ? "Editar Origen" : "Agregar Origen"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Nombre *</label>
              <Input
                placeholder="Ej: Orden de compra, Transferencia..."
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Orden</label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                  className="text-center"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Estado</label>
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-sm text-slate-600">Activo</span>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAdd(false); setEditItem(null); }}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!form.name.trim()) { toast.error("Ingrese un nombre"); return; }
                saveMutation.mutate({ id: editItem?.id, ...form });
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

// ── Companies Tab ─────────────────────────────────────────────────────────────
function CompaniesTab({ readOnly }: { readOnly?: boolean }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ data: CompanyCatalogRow[] }>({
    queryKey: ["admin-companies-catalog"],
    queryFn: () => fetch("/api/admin/catalogs/companies").then((r) => r.json()),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<CompanyCatalogRow | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    isActive: true,
    sortOrder: 0,
  });

  function openAdd() {
    const rows = data?.data ?? [];
    setForm({
      code: "",
      name: "",
      isActive: true,
      sortOrder: rows.length ? Math.max(...rows.map((r) => r.sortOrder)) + 1 : 1,
    });
    setShowAdd(true);
    setEditItem(null);
  }

  function openEdit(item: CompanyCatalogRow) {
    setForm({
      code: item.code,
      name: item.name,
      isActive: item.isActive,
      sortOrder: item.sortOrder,
    });
    setEditItem(item);
    setShowAdd(true);
  }

  type SaveCompanyPayload = {
    name: string;
    isActive: boolean;
    sortOrder: number;
    /** Alta */
    newCode?: string;
    /** Edición: código existente */
    existingCode?: string;
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: SaveCompanyPayload) => {
      const isEdit = Boolean(payload.existingCode);
      const url = isEdit
        ? `/api/admin/catalogs/companies/${encodeURIComponent(payload.existingCode!)}`
        : "/api/admin/catalogs/companies";
      const init: RequestInit = isEdit
        ? {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: payload.name,
              isActive: payload.isActive,
              sortOrder: payload.sortOrder,
            }),
          }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: payload.newCode ?? "",
              name: payload.name,
              isActive: payload.isActive,
              sortOrder: payload.sortOrder,
            }),
          };
      const r = await fetch(url, init);
      const json = (await r.json().catch(() => ({}))) as { data?: unknown; error?: { message?: string } };
      if (!r.ok || json.error) {
        throw new Error(json.error?.message ?? `Error ${r.status}`);
      }
      return { json, isEdit };
    },
    onSuccess: ({ isEdit }) => {
      toast.success(isEdit ? "Empresa actualizada" : "Empresa creada");
      qc.invalidateQueries({ queryKey: ["admin-companies-catalog"] });
      qc.invalidateQueries({ queryKey: ["companies-catalog"] });
      setShowAdd(false);
      setEditItem(null);
    },
    onError: (e: Error) => toast.error(e.message || "Error al guardar"),
  });

  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-slate-500">
            Administre el catálogo de empresas del grupo. El código es estable (mayúsculas); se usa en contratos y reportes.
          </p>
          <p className="text-xs text-slate-400 max-w-2xl">
            Las empresas <strong className="font-medium text-slate-600">inactivas</strong> no aparecen al crear contratos, gastos o usuarios,
            pero los registros existentes siguen mostrando el nombre correcto.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={rows.length === 0}
            onClick={() => {
              const exportRows = rows.map((r) => ({
                Código: r.code,
                Nombre: r.name,
                Estado: r.isActive ? "Activa" : "Inactiva",
                Orden: r.sortOrder,
              }));
              exportRowsToExcel({
                filename: "empresas",
                sheetName: "Empresas",
                rows: exportRows,
                columnWidths: [16, 32, 12, 8],
              });
            }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Exportar a Excel ({rows.length})
          </Button>
          {!readOnly && (
            <Button className="gap-2" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Nueva empresa
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-slate-400">Cargando...</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-slate-400 border rounded-lg">No hay empresas en el catálogo.</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-slate-600 w-36">Código</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Nombre</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 w-28">Estado</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 w-20">Orden</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.code} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <code className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{row.code}</code>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">{row.name}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={row.isActive ? "success" : "secondary"}>
                      {row.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center text-slate-500">{row.sortOrder}</td>
                  <td className="px-4 py-3">
                    {!readOnly && (
                      <div className="flex justify-end">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                          <Pencil className="h-3.5 w-3.5" />
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
            <DialogTitle>{editItem ? "Editar empresa" : "Nueva empresa"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editItem && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Código *</label>
                <Input
                  placeholder="Ej: NUEVA_EMPRESA"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") }))}
                />
                <p className="text-xs text-slate-400">Solo mayúsculas, números y guión bajo. No se puede cambiar después.</p>
              </div>
            )}
            {editItem && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Código</label>
                <code className="block text-sm bg-slate-100 px-2 py-1.5 rounded">{editItem.code}</code>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Nombre para mostrar *</label>
              <Input
                placeholder="Nombre comercial o razón social corta"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
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
            <Button variant="outline" onClick={() => { setShowAdd(false); setEditItem(null); }}>Cancelar</Button>
            <Button
              onClick={() => {
                if (!form.name.trim()) {
                  toast.error("Ingrese el nombre");
                  return;
                }
                if (!editItem && !form.code.trim()) {
                  toast.error("Ingrese el código");
                  return;
                }
                const newCode = form.code.trim().toUpperCase();
                if (!editItem && rows.some((r) => r.code === newCode)) {
                  toast.error(
                    "Ya existe una empresa con ese código. Use «Editar» en la fila correspondiente o elija otro código (p. ej. ALFA ya está en el catálogo inicial)."
                  );
                  return;
                }
                saveMutation.mutate(
                  editItem
                    ? {
                        existingCode: editItem.code,
                        name: form.name.trim(),
                        isActive: form.isActive,
                        sortOrder: form.sortOrder,
                      }
                    : {
                        newCode,
                        name: form.name.trim(),
                        isActive: form.isActive,
                        sortOrder: form.sortOrder,
                      }
                );
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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CatalogsPage() {
  const { data: session } = useSession();
  const readOnly = !session?.user?.role || !isAdmin(session.user.role);
  type TabKey =
    | "types"
    | "approvals"
    | "origins"
    | "companies"
    | "asset-types"
    | "zones"
    | "locations"
    | "branding";
  const [tab, setTab] = useState<TabKey>("types");

  return (
    <>
      <Topbar title="Mantenimientos" />
      <div className="p-6 space-y-4">
        {readOnly && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-3 text-sm text-amber-950">
              Vista de solo lectura. Solo un administrador puede modificar mantenimientos.
            </CardContent>
          </Card>
        )}
        {/* Tab switcher */}
        <div className="flex flex-wrap gap-1 border-b">
          {[
            { key: "types", label: "Tipos de Gasto" },
            { key: "approvals", label: "Aprobaciones" },
            { key: "origins", label: "Orígenes" },
            { key: "companies", label: "Empresas" },
            { key: "asset-types", label: "Tipos de Activos" },
            { key: "zones", label: "Zonas" },
            { key: "locations", label: "Ubicaciones" },
            { key: "branding", label: "Marca y colores" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key as TabKey)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.key
                  ? "border-[color:var(--app-primary)] text-[color:var(--app-primary)]"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {tab === "types"
                ? "Tipos de Gasto"
                : tab === "approvals"
                  ? "Aprobaciones por tipo de gasto"
                  : tab === "origins"
                    ? "Orígenes de Gasto"
                    : tab === "companies"
                      ? "Empresas"
                      : tab === "asset-types"
                        ? "Tipos de Activos (inventario)"
                        : tab === "zones"
                          ? "Zonas"
                          : tab === "locations"
                            ? "Ubicaciones"
                            : "Marca y colores"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tab === "types" ? (
              <ExpenseTypesTab readOnly={readOnly} />
            ) : tab === "approvals" ? (
              <ExpenseApprovalChainsTab readOnly={readOnly} />
            ) : tab === "origins" ? (
              <OriginsTab readOnly={readOnly} />
            ) : tab === "companies" ? (
              <CompaniesTab readOnly={readOnly} />
            ) : tab === "asset-types" ? (
              <AssetTypesTab readOnly={readOnly} />
            ) : tab === "zones" ? (
              <ZonesTab readOnly={readOnly} />
            ) : tab === "locations" ? (
              <LocationsTab readOnly={readOnly} />
            ) : (
              <BrandingAppearanceTab readOnly={readOnly} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
