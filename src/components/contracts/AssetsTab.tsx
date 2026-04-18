"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Phone, Undo2, MapPin, Building2, Package, FileSpreadsheet } from "lucide-react";
import { exportRowsToExcel } from "@/lib/utils/excel-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";

type FieldType = "string" | "number" | "date" | "boolean";
interface ExtraField { key: string; label: string; type: FieldType; required: boolean }
interface AssetType { id: string; code: string; name: string; fields: ExtraField[]; isActive: boolean }
interface AssignedAsset {
  id: string;
  code: string;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  attributes: Record<string, unknown>;
  type: AssetType;
}
interface PositionRow {
  id: string;
  name: string;
  description?: string | null;
  phoneLine?: string | null;
  shifts: Array<{ id: string; label: string | null; hours: number }>;
  assets: AssignedAsset[];
}
interface LocationRow {
  id: string;
  name: string;
  description?: string | null;
  positions: PositionRow[];
}

function renderAttrs(a: AssignedAsset): string {
  const fields = Array.isArray(a.type.fields) ? a.type.fields : [];
  const attrs = a.attributes && typeof a.attributes === "object" ? a.attributes : {};
  const parts: string[] = [];
  for (const f of fields) {
    const v = (attrs as Record<string, unknown>)[f.key];
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${f.label}: ${v}`);
  }
  return parts.join(" · ");
}

export function AssetsTab({ contractId, readOnly }: { contractId: string; readOnly?: boolean }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ data: { locations: LocationRow[] } }>({
    queryKey: ["contract-assets", contractId],
    queryFn: () => fetch(`/api/contracts/${contractId}/assets`).then((r) => r.json()),
  });
  const locations = data?.data?.locations ?? [];

  const [assignFor, setAssignFor] = useState<PositionRow | null>(null);
  const [phoneEditing, setPhoneEditing] = useState<string | null>(null);
  const [phoneValue, setPhoneValue] = useState("");

  function refresh() {
    qc.invalidateQueries({ queryKey: ["contract-assets", contractId] });
    qc.invalidateQueries({ queryKey: ["contract-locations", contractId] });
    qc.invalidateQueries({ queryKey: ["assets"] });
    qc.invalidateQueries({ queryKey: ["asset-movements"] });
  }

  const phoneMutation = useMutation({
    mutationFn: async ({ positionId, phoneLine }: { positionId: string; phoneLine: string | null }) => {
      const r = await fetch(`/api/contracts/${contractId}/positions/${positionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneLine }),
      });
      const json = await r.json();
      if (json.error) throw new Error(json.error.message || "Error");
      return json;
    },
    onSuccess: () => {
      toast.success("Línea telefónica actualizada");
      setPhoneEditing(null);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const returnMutation = useMutation({
    mutationFn: async (assetId: string) => {
      const r = await fetch(`/api/assets/${assetId}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RETURN" }),
      });
      const json = await r.json();
      if (json.error) throw new Error(json.error.message || "Error");
      return json;
    },
    onSuccess: () => {
      toast.success("Activo devuelto al stock");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-8 text-center text-slate-400">Cargando...</div>;
  if (locations.length === 0) {
    return (
      <div className="p-10 text-center text-slate-400 border rounded-lg">
        Este contrato aún no tiene ubicaciones. Agregue ubicaciones y puestos en la pestaña «Ubicaciones» antes de asignar activos.
      </div>
    );
  }

  const totalAssigned = locations.reduce(
    (n, loc) => n + loc.positions.reduce((m, p) => m + p.assets.length, 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Activos por puesto</h3>
          <p className="text-xs text-slate-500">
            {totalAssigned} activo(s) asignado(s) · Asigne o devuelva activos desde el stock central.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={totalAssigned === 0 && locations.every((l) => l.positions.length === 0)}
          onClick={() => {
            const exportRows: Array<Record<string, string | number>> = [];
            for (const loc of locations) {
              if (loc.positions.length === 0) {
                exportRows.push({
                  Ubicación: loc.name,
                  Puesto: "",
                  "Línea telefónica": "",
                  "Tipo de activo": "",
                  Código: "",
                  Nombre: "",
                  Marca: "",
                  Modelo: "",
                  Atributos: "(Sin puestos)",
                });
                continue;
              }
              for (const p of loc.positions) {
                if (p.assets.length === 0) {
                  exportRows.push({
                    Ubicación: loc.name,
                    Puesto: p.name,
                    "Línea telefónica": p.phoneLine ?? "",
                    "Tipo de activo": "",
                    Código: "",
                    Nombre: "",
                    Marca: "",
                    Modelo: "",
                    Atributos: "Sin activos",
                  });
                  continue;
                }
                for (const a of p.assets) {
                  exportRows.push({
                    Ubicación: loc.name,
                    Puesto: p.name,
                    "Línea telefónica": p.phoneLine ?? "",
                    "Tipo de activo": a.type.name,
                    Código: a.code,
                    Nombre: a.name ?? "",
                    Marca: a.brand ?? "",
                    Modelo: a.model ?? "",
                    Atributos: renderAttrs(a),
                  });
                }
              }
            }
            exportRowsToExcel({
              filename: `activos_contrato_${contractId}`,
              sheetName: "Activos",
              rows: exportRows,
              columnWidths: [22, 28, 16, 18, 14, 22, 16, 18, 40],
            });
          }}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Exportar a Excel ({totalAssigned})
        </Button>
      </div>

      <div className="space-y-3">
        {locations.map((loc) => (
          <Card key={loc.id} className="overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b">
              <Building2 className="h-4 w-4 text-blue-500" />
              <div className="flex-1">
                <div className="font-medium text-slate-800">{loc.name}</div>
                {loc.description && <p className="text-xs text-slate-500">{loc.description}</p>}
              </div>
              <span className="text-xs text-slate-500">{loc.positions.length} puesto(s)</span>
            </div>
            <div className="divide-y">
              {loc.positions.length === 0 ? (
                <p className="p-4 text-sm text-slate-400 italic">Sin puestos en esta ubicación.</p>
              ) : (
                loc.positions.map((pos) => (
                  <div key={pos.id} className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <MapPin className="h-4 w-4 text-slate-400 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-slate-800">{pos.name}</span>
                          {pos.shifts.map((sh) => (
                            <span
                              key={sh.id}
                              className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded"
                            >
                              {sh.label ? `${sh.label} · ` : ""}
                              {sh.hours}h
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 text-sm">
                          <Phone className="h-3.5 w-3.5 text-slate-400" />
                          {phoneEditing === pos.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={phoneValue}
                                onChange={(e) => setPhoneValue(e.target.value)}
                                className="h-7 text-sm w-40"
                                placeholder="Ej: 2222-3333"
                                autoFocus
                              />
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() =>
                                  phoneMutation.mutate({ positionId: pos.id, phoneLine: phoneValue.trim() || null })
                                }
                                disabled={phoneMutation.isPending}
                              >
                                Guardar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => setPhoneEditing(null)}
                              >
                                Cancelar
                              </Button>
                            </div>
                          ) : (
                            <>
                              <span className="text-slate-600">
                                {pos.phoneLine ?? <span className="text-slate-400 italic">Sin línea</span>}
                              </span>
                              {!readOnly && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs text-blue-600"
                                  onClick={() => {
                                    setPhoneEditing(pos.id);
                                    setPhoneValue(pos.phoneLine ?? "");
                                  }}
                                >
                                  {pos.phoneLine ? "Editar" : "Asignar línea"}
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {!readOnly && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 shrink-0"
                          onClick={() => setAssignFor(pos)}
                        >
                          <Plus className="h-3.5 w-3.5" /> Asignar activo
                        </Button>
                      )}
                    </div>

                    {pos.assets.length === 0 ? (
                      <p className="ml-7 text-xs text-slate-400 italic">Sin activos asignados.</p>
                    ) : (
                      <div className="ml-7 space-y-1.5">
                        {pos.assets.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-start gap-3 p-2 bg-slate-50 rounded border text-sm"
                          >
                            <Package className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-slate-800">{a.type.name}</span>
                                <code className="text-xs bg-white text-slate-700 px-1 rounded border">{a.code}</code>
                                {(a.brand || a.model) && (
                                  <span className="text-xs text-slate-500">
                                    {[a.brand, a.model].filter(Boolean).join(" / ")}
                                  </span>
                                )}
                              </div>
                              {renderAttrs(a) && (
                                <p className="text-xs text-slate-500 mt-0.5">{renderAttrs(a)}</p>
                              )}
                            </div>
                            {!readOnly && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs gap-1 text-amber-700"
                                onClick={() => {
                                  if (confirm(`¿Devolver "${a.code}" al stock?`)) {
                                    returnMutation.mutate(a.id);
                                  }
                                }}
                              >
                                <Undo2 className="h-3.5 w-3.5" /> Devolver
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>
        ))}
      </div>

      <AssignFromStockDialog
        position={assignFor}
        onOpenChange={(v) => { if (!v) setAssignFor(null); }}
        onSuccess={refresh}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────

function AssignFromStockDialog({
  position, onOpenChange, onSuccess,
}: {
  position: PositionRow | null;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [typeFilter, setTypeFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const { data: typesRes } = useQuery<{ data: AssetType[] }>({
    queryKey: ["asset-types"],
    queryFn: () => fetch("/api/admin/catalogs/asset-types").then((r) => r.json()),
  });
  const types = typesRes?.data ?? [];

  interface StockAsset {
    id: string;
    code: string;
    name?: string | null;
    brand?: string | null;
    model?: string | null;
    attributes: Record<string, unknown>;
    type: AssetType;
  }
  const { data: stockRes, isLoading } = useQuery<{ data: StockAsset[] }>({
    queryKey: ["assets", { status: "IN_STOCK", typeId: typeFilter, q: searchQ, forAssign: true }],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("status", "IN_STOCK");
      if (typeFilter) params.set("typeId", typeFilter);
      if (searchQ) params.set("q", searchQ);
      return fetch(`/api/assets?${params}`).then((r) => r.json());
    },
    enabled: !!position,
  });
  const stock = stockRes?.data ?? [];

  const selectedAsset = useMemo(() => stock.find((s) => s.id === selected) || null, [stock, selected]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!position || !selected) return;
      const r = await fetch(`/api/assets/${selected}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ASSIGN", toPositionId: position.id }),
      });
      const json = await r.json();
      if (json.error) throw new Error(json.error.message || "Error");
      return json;
    },
    onSuccess: () => {
      toast.success(`Activo asignado a ${position?.name}`);
      setSelected(null);
      setSearchQ("");
      setTypeFilter("");
      onSuccess();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={!!position}
      onOpenChange={(v) => {
        if (!v) {
          setSelected(null);
          setSearchQ("");
          setTypeFilter("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Asignar activo a {position?.name ?? ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1">
              <label className="text-xs text-slate-500">Tipo</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full h-9 text-sm border rounded-md px-2 bg-white"
              >
                <option value="">Todos</option>
                {types.filter((t) => t.isActive).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500">Buscar en stock</label>
              <Input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Código, marca, modelo…"
              />
            </div>
          </div>

          <div className="border rounded max-h-72 overflow-y-auto">
            {isLoading ? (
              <div className="p-6 text-center text-slate-400 text-sm">Cargando stock…</div>
            ) : stock.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-sm">
                No hay activos disponibles en stock con esos filtros. Agréguelos desde Inventario.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-2 w-8" />
                    <th className="text-left px-2 py-2 font-medium text-slate-600">Tipo</th>
                    <th className="text-left px-2 py-2 font-medium text-slate-600">Código</th>
                    <th className="text-left px-2 py-2 font-medium text-slate-600">Marca / modelo</th>
                    <th className="text-left px-2 py-2 font-medium text-slate-600">Atributos</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {stock.map((s) => (
                    <tr
                      key={s.id}
                      className={`cursor-pointer hover:bg-slate-50 ${selected === s.id ? "bg-blue-50" : ""}`}
                      onClick={() => setSelected(s.id)}
                    >
                      <td className="px-2 py-2 text-center">
                        <input
                          type="radio"
                          checked={selected === s.id}
                          onChange={() => setSelected(s.id)}
                        />
                      </td>
                      <td className="px-2 py-2">{s.type.name}</td>
                      <td className="px-2 py-2">
                        <code className="text-xs bg-slate-100 px-1 rounded">{s.code}</code>
                      </td>
                      <td className="px-2 py-2 text-slate-600">
                        {[s.brand, s.model].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-500">{renderAttrs(s) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {selectedAsset && (
            <p className="text-xs text-blue-700 bg-blue-50 p-2 rounded">
              Seleccionado: {selectedAsset.type.name} · {selectedAsset.code}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={!selected || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Asignando…" : "Asignar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
