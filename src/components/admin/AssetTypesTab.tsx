"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, X, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { exportRowsToExcel } from "@/lib/utils/excel-export";

type FieldType = "string" | "number" | "date" | "boolean";
interface ExtraField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
}
interface AssetTypeRow {
  id: string;
  code: string;
  name: string;
  fields: ExtraField[];
  isActive: boolean;
  sortOrder: number;
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  string: "Texto",
  number: "Número",
  date: "Fecha",
  boolean: "Sí / No",
};

function emptyForm(): { code: string; name: string; fields: ExtraField[]; isActive: boolean; sortOrder: number } {
  return { code: "", name: "", fields: [], isActive: true, sortOrder: 0 };
}

export function AssetTypesTab({ readOnly }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ data: AssetTypeRow[] }>({
    queryKey: ["asset-types-admin"],
    queryFn: () => fetch("/api/admin/catalogs/asset-types").then((r) => r.json()),
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<AssetTypeRow | null>(null);
  const [form, setForm] = useState(emptyForm());

  function openAdd() {
    const rows = data?.data ?? [];
    setForm({ ...emptyForm(), sortOrder: rows.length });
    setEditItem(null);
    setModalOpen(true);
  }
  function openEdit(row: AssetTypeRow) {
    setEditItem(row);
    setForm({
      code: row.code,
      name: row.name,
      fields: Array.isArray(row.fields) ? row.fields : [],
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    });
    setModalOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = editItem
        ? `/api/admin/catalogs/asset-types/${editItem.id}`
        : "/api/admin/catalogs/asset-types";
      const method = editItem ? "PATCH" : "POST";
      const body = editItem
        ? { name: form.name, fields: form.fields, isActive: form.isActive, sortOrder: form.sortOrder }
        : { code: form.code, name: form.name, fields: form.fields, isActive: form.isActive, sortOrder: form.sortOrder };
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (json.error) throw new Error(json.error.message || "Error");
      return json;
    },
    onSuccess: () => {
      toast.success(editItem ? "Tipo actualizado" : "Tipo creado");
      qc.invalidateQueries({ queryKey: ["asset-types-admin"] });
      qc.invalidateQueries({ queryKey: ["asset-types"] });
      setModalOpen(false);
      setEditItem(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/admin/catalogs/asset-types/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.error) {
        toast.error(res.error.message ?? "Error al eliminar");
        return;
      }
      toast.success("Tipo eliminado");
      qc.invalidateQueries({ queryKey: ["asset-types-admin"] });
      qc.invalidateQueries({ queryKey: ["asset-types"] });
    },
  });

  const rows = data?.data ?? [];

  function addField() {
    setForm((f) => ({
      ...f,
      fields: [...f.fields, { key: "", label: "", type: "string", required: false }],
    }));
  }
  function updateField(i: number, patch: Partial<ExtraField>) {
    setForm((f) => ({
      ...f,
      fields: f.fields.map((fld, j) => (j === i ? { ...fld, ...patch } : fld)),
    }));
  }
  function removeField(i: number) {
    setForm((f) => ({ ...f, fields: f.fields.filter((_, j) => j !== i) }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1 max-w-2xl">
          <p className="text-sm text-slate-500">
            Defina los tipos de activos del inventario (celular, arma, radio, etc.) y qué campos extra guardar para cada uno.
          </p>
          <p className="text-xs text-slate-400">
            El <strong className="font-medium text-slate-600">código</strong> se usa internamente (ej. PHONE, RADIO, WEAPON). Los campos extra se piden
            al registrar activos de ese tipo. Tipos con activos asociados no se pueden eliminar.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={rows.length === 0}
            onClick={() => {
              const exportRows = rows.map((r) => {
                const fields: ExtraField[] = Array.isArray(r.fields) ? r.fields : [];
                return {
                  Código: r.code,
                  Nombre: r.name,
                  "Campos extra": fields
                    .map((f) => `${f.label}${f.required ? "*" : ""} (${FIELD_TYPE_LABELS[f.type]})`)
                    .join(", "),
                  Estado: r.isActive ? "Activo" : "Inactivo",
                  Orden: r.sortOrder,
                };
              });
              exportRowsToExcel({
                filename: "tipos_de_activos",
                sheetName: "Tipos de activos",
                rows: exportRows,
                columnWidths: [14, 22, 60, 10, 8],
              });
            }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Exportar a Excel ({rows.length})
          </Button>
          {!readOnly && (
            <Button className="gap-2" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Nuevo tipo
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-slate-400">Cargando...</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-slate-400 border rounded-lg">Sin tipos definidos.</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-slate-600 w-32">Código</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Nombre</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Campos extra</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 w-24">Estado</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 w-20">Orden</th>
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const fields: ExtraField[] = Array.isArray(r.fields) ? r.fields : [];
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <code className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{r.code}</code>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {fields.length === 0 ? (
                        <span className="italic text-slate-400">Sin campos extra</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {fields.map((f) => (
                            <span
                              key={f.key}
                              className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5"
                            >
                              {f.label}
                              <span className="text-slate-400">({FIELD_TYPE_LABELS[f.type]})</span>
                              {f.required && <span className="text-red-500">*</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={r.isActive ? "success" : "secondary"}>
                        {r.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-500">{r.sortOrder}</td>
                    <td className="px-4 py-3">
                      {!readOnly && (
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 hover:bg-red-50"
                            onClick={() => {
                              if (confirm(`¿Eliminar el tipo "${r.name}"?`)) {
                                deleteMutation.mutate(r.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={modalOpen && !readOnly} onOpenChange={(v) => { if (!v) { setModalOpen(false); setEditItem(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editItem ? "Editar tipo de activo" : "Nuevo tipo de activo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Código *</label>
                {editItem ? (
                  <code className="block text-sm bg-slate-100 px-2 py-1.5 rounded">{editItem.code}</code>
                ) : (
                  <Input
                    placeholder="PHONE"
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") }))}
                  />
                )}
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-sm font-medium text-slate-700">Nombre *</label>
                <Input
                  placeholder="Ej: Celular, Radio, Arma"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
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
                  <span className="text-sm text-slate-600">Activo</span>
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">Campos extra</label>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addField}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Agregar campo
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                Se piden al registrar activos de este tipo. Ejemplos: IMEI, Número, Calibre, Frecuencia.
              </p>
              {form.fields.length === 0 ? (
                <div className="text-xs text-slate-400 border rounded p-3 text-center italic">Sin campos extra</div>
              ) : (
                <div className="space-y-2">
                  {form.fields.map((fld, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 border rounded bg-slate-50/50">
                      <div className="col-span-3">
                        <label className="text-xs text-slate-500">Clave</label>
                        <Input
                          placeholder="imei"
                          value={fld.key}
                          onChange={(e) => updateField(i, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="col-span-4">
                        <label className="text-xs text-slate-500">Etiqueta</label>
                        <Input
                          placeholder="IMEI"
                          value={fld.label}
                          onChange={(e) => updateField(i, { label: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="col-span-3">
                        <label className="text-xs text-slate-500">Tipo</label>
                        <select
                          value={fld.type}
                          onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                          className="h-8 text-sm border rounded-md px-2 w-full bg-white"
                        >
                          {Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-1 flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={fld.required}
                          onChange={(e) => updateField(i, { required: e.target.checked })}
                          className="w-4 h-4 rounded"
                          title="Requerido"
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-red-500"
                          onClick={() => removeField(i)}
                          title="Eliminar campo"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setModalOpen(false); setEditItem(null); }}>
              Cancelar
            </Button>
            <Button
              disabled={saveMutation.isPending}
              onClick={() => {
                if (!editItem && !form.code.trim()) {
                  toast.error("Ingrese el código");
                  return;
                }
                if (!form.name.trim()) {
                  toast.error("Ingrese el nombre");
                  return;
                }
                const seen = new Set<string>();
                for (const f of form.fields) {
                  if (!f.key.trim() || !f.label.trim()) {
                    toast.error("Todos los campos extra deben tener clave y etiqueta");
                    return;
                  }
                  if (seen.has(f.key)) {
                    toast.error(`Clave duplicada: ${f.key}`);
                    return;
                  }
                  seen.add(f.key);
                }
                saveMutation.mutate();
              }}
            >
              {saveMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
