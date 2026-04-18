"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Pencil, Undo2, AlertTriangle, Package, History, MapPin, Search, ArrowRightCircle, X, RotateCcw, FileSpreadsheet,
} from "lucide-react";
import { exportRowsToExcel } from "@/lib/utils/excel-export";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { formatDate } from "@/lib/utils/format";
import { canManageExpenses } from "@/lib/permissions";

type FieldType = "string" | "number" | "date" | "boolean";
interface ExtraField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
}
interface AssetType {
  id: string;
  code: string;
  name: string;
  fields: ExtraField[];
  isActive: boolean;
  sortOrder: number;
}
interface AssetPosition {
  id: string;
  name: string;
  phoneLine?: string | null;
  location: {
    id: string;
    name: string;
    contract: { id: string; licitacionNo: string; client: string };
    zone?: { id: string; name: string } | null;
  };
}
interface AssetRow {
  id: string;
  typeId: string;
  code: string;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  attributes: Record<string, unknown>;
  status: "IN_STOCK" | "ASSIGNED" | "PENDING_RETURN" | "RETIRED";
  currentPosition?: AssetPosition | null;
  acquisitionExpense?: { id: string; description: string; referenceNumber: string | null } | null;
  acquisitionDate?: string | null;
  notes?: string | null;
  type: AssetType;
  createdAt: string;
  updatedAt: string;
}
interface MovementRow {
  id: string;
  assetId: string;
  type: "INTAKE" | "ISSUE" | "ASSIGN" | "RETURN";
  intakeReason?: string | null;
  issueReason?: string | null;
  notes?: string | null;
  createdAt: string;
  asset: { id: string; code: string; name: string | null; type: { name: string; code: string } };
  fromPosition?: AssetPosition | null;
  toPosition?: AssetPosition | null;
  expense?: { id: string; description: string; referenceNumber: string | null } | null;
}

const STATUS_LABEL: Record<AssetRow["status"], string> = {
  IN_STOCK: "En stock",
  ASSIGNED: "Asignado",
  PENDING_RETURN: "Pendiente de devolución",
  RETIRED: "Baja",
};
const STATUS_VARIANT: Record<AssetRow["status"], "success" | "warning" | "secondary" | "danger"> = {
  IN_STOCK: "success",
  ASSIGNED: "warning",
  PENDING_RETURN: "danger",
  RETIRED: "secondary",
};
const MOVEMENT_LABEL: Record<MovementRow["type"], string> = {
  INTAKE: "Ingreso",
  ISSUE: "Baja",
  ASSIGN: "Asignación",
  RETURN: "Devolución",
};
const MOVEMENT_BADGE: Record<MovementRow["type"], string> = {
  INTAKE: "bg-emerald-100 text-emerald-800",
  ISSUE: "bg-red-100 text-red-700",
  ASSIGN: "bg-blue-100 text-blue-800",
  RETURN: "bg-amber-100 text-amber-800",
};
const INTAKE_REASON: Record<string, string> = {
  PURCHASE: "Compra",
  RETURN: "Devolución",
  INITIAL: "Inicial",
  OTHER: "Otro",
};
const ISSUE_REASON: Record<string, string> = {
  LOST: "Pérdida",
  DAMAGED: "Dañado",
  DISPOSED: "Desechado",
  OTHER: "Otro",
};

function describePosition(p?: AssetPosition | null) {
  if (!p) return "—";
  return `${p.location.contract.licitacionNo} · ${p.location.name} › ${p.name}`;
}

function zoneName(p?: AssetPosition | null): string | null {
  return p?.location?.zone?.name ?? null;
}

function matchesFilter(value: string | null | undefined, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  return (value ?? "").toString().toLowerCase().includes(f);
}

/** Input pequeño para colocar en una fila de filtros bajo el header de una tabla. */
function ColumnFilterInput({
  value,
  onChange,
  placeholder = "Filtrar…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-7 text-xs border border-slate-200 rounded px-2 pr-6 bg-white focus:outline-none focus:border-blue-400"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
          title="Limpiar"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function ensureAttrs(a: unknown): Record<string, unknown> {
  if (a && typeof a === "object" && !Array.isArray(a)) return a as Record<string, unknown>;
  return {};
}

function renderAttributes(asset: AssetRow): string {
  const fields = Array.isArray(asset.type.fields) ? asset.type.fields : [];
  const attrs = ensureAttrs(asset.attributes);
  const parts = fields
    .map((f) => {
      const v = attrs[f.key];
      if (v === undefined || v === null || v === "") return null;
      return `${f.label}: ${v}`;
    })
    .filter(Boolean) as string[];
  return parts.join(" · ");
}

export default function InventoryPage() {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canManage = role ? canManageExpenses(role) : false;

  const [tab, setTab] = useState<"stock" | "assigned" | "pending" | "movements">("stock");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [searchQ, setSearchQ] = useState("");

  const qc = useQueryClient();

  const { data: typesRes } = useQuery<{ data: AssetType[] }>({
    queryKey: ["asset-types"],
    queryFn: () => fetch("/api/admin/catalogs/asset-types").then((r) => r.json()),
  });
  const types = typesRes?.data ?? [];
  const activeTypes = types.filter((t) => t.isActive);

  // Conteo de "Pendientes de devolución" para mostrar el badge en la pestaña.
  const { data: pendingCountRes } = useQuery<{ data: AssetRow[] }>({
    queryKey: ["assets", { status: "PENDING_RETURN", forBadge: true }],
    queryFn: () => fetch("/api/assets?status=PENDING_RETURN").then((r) => r.json()),
    refetchInterval: 60000,
  });
  const pendingCount = pendingCountRes?.data?.length ?? 0;

  const statusForTab =
    tab === "stock" ? "IN_STOCK"
    : tab === "assigned" ? "ASSIGNED"
    : tab === "pending" ? "PENDING_RETURN"
    : null;

  const assetsQueryKey = ["assets", { status: statusForTab, typeId: typeFilter, q: searchQ }];
  const { data: assetsRes, isLoading: assetsLoading } = useQuery<{ data: AssetRow[] }>({
    queryKey: assetsQueryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusForTab) params.set("status", statusForTab);
      if (typeFilter) params.set("typeId", typeFilter);
      if (searchQ) params.set("q", searchQ);
      return fetch(`/api/assets?${params}`).then((r) => r.json());
    },
    enabled: tab !== "movements",
  });
  const assets = assetsRes?.data ?? [];

  const { data: movementsRes, isLoading: movementsLoading } = useQuery<{ data: MovementRow[] }>({
    queryKey: ["asset-movements", { typeId: typeFilter }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (typeFilter) params.set("typeId", typeFilter);
      return fetch(`/api/asset-movements?${params}`).then((r) => r.json());
    },
    enabled: tab === "movements",
  });
  const movements = movementsRes?.data ?? [];

  const [intakeOpen, setIntakeOpen] = useState(false);
  const [issueFor, setIssueFor] = useState<AssetRow | null>(null);
  const [returnFor, setReturnFor] = useState<AssetRow | null>(null);
  const [editFor, setEditFor] = useState<AssetRow | null>(null);
  const [assignFor, setAssignFor] = useState<AssetRow | null>(null);

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ["assets"] });
    qc.invalidateQueries({ queryKey: ["asset-movements"] });
    qc.invalidateQueries({ queryKey: ["contract-assets"] });
  }

  return (
    <>
      <Topbar title="Inventario" />
      <div className="p-6 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-slate-500">Control del stock central de activos (celulares, radios, armas…) y su asignación a puestos.</p>
          </div>
          {canManage && (
            <Button className="gap-2" onClick={() => setIntakeOpen(true)}>
              <Plus className="h-4 w-4" /> Ingreso a stock
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-1 border-b">
          {[
            { key: "stock", label: "Stock disponible", icon: Package, badge: 0 },
            { key: "assigned", label: "Asignados", icon: MapPin, badge: 0 },
            { key: "pending", label: "Pendientes de devolución", icon: RotateCcw, badge: pendingCount },
            { key: "movements", label: "Movimientos", icon: History, badge: 0 },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key as "stock" | "assigned" | "pending" | "movements")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-2 ${
                tab === t.key
                  ? "border-[color:var(--app-primary)] text-[color:var(--app-primary)]"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
              {t.badge > 0 && (
                <span className="ml-1 inline-flex min-w-[20px] justify-center items-center rounded-full bg-red-100 text-red-700 text-[11px] font-semibold px-1.5">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <label className="text-xs text-slate-500">Tipo</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full h-9 text-sm border rounded-md px-2 bg-white"
            >
              <option value="">Todos los tipos</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          {tab !== "movements" && (
            <div className="flex-1 min-w-[240px]">
              <label className="text-xs text-slate-500">Buscar</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Código, nombre, marca, modelo…"
                  className="pl-8"
                />
              </div>
            </div>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            {tab === "movements" ? (
              <MovementsTable movements={movements} loading={movementsLoading} />
            ) : (
              <AssetsTable
                assets={assets}
                loading={assetsLoading}
                tab={tab}
                canManage={canManage}
                onEdit={setEditFor}
                onAssign={(a) => setAssignFor(a)}
                onIssue={(a) => setIssueFor(a)}
                onReturn={(a) => setReturnFor(a)}
                onDelete={(a) => {
                  if (!confirm(`¿Eliminar el activo "${a.code}"? Esta acción es irreversible.`)) return;
                  fetch(`/api/assets/${a.id}`, { method: "DELETE" })
                    .then((r) => r.json())
                    .then((res) => {
                      if (res.error) {
                        toast.error(res.error.message ?? "Error");
                        return;
                      }
                      toast.success("Activo eliminado");
                      refreshAll();
                    });
                }}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <IntakeDialog
        open={intakeOpen && canManage}
        onOpenChange={setIntakeOpen}
        types={activeTypes}
        onSuccess={refreshAll}
      />

      <IssueDialog
        asset={issueFor}
        onOpenChange={(v) => { if (!v) setIssueFor(null); }}
        onSuccess={refreshAll}
      />

      <ReturnDialog
        asset={returnFor}
        onOpenChange={(v) => { if (!v) setReturnFor(null); }}
        onSuccess={refreshAll}
      />

      <EditAssetDialog
        asset={editFor}
        onOpenChange={(v) => { if (!v) setEditFor(null); }}
        onSuccess={refreshAll}
      />

      <AssignFromStockDialog
        asset={assignFor}
        onOpenChange={(v) => { if (!v) setAssignFor(null); }}
        onSuccess={refreshAll}
      />
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Assets Table

function AssetsTable({
  assets, loading, tab, canManage, onEdit, onAssign, onIssue, onReturn, onDelete,
}: {
  assets: AssetRow[];
  loading: boolean;
  tab: "stock" | "assigned" | "pending";
  canManage: boolean;
  onEdit: (a: AssetRow) => void;
  onAssign: (a: AssetRow) => void;
  onIssue: (a: AssetRow) => void;
  onReturn: (a: AssetRow) => void;
  onDelete: (a: AssetRow) => void;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFilters((prev) => ({ ...prev, [k]: v }));
  const hasActiveFilters = Object.values(filters).some((v) => v.trim());
  const showLocationCol = tab === "assigned" || tab === "pending";

  // Reset filters when switching tabs (some columns differ)
  useEffect(() => {
    setFilters({});
  }, [tab]);

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (!matchesFilter(`${a.type.name} ${a.type.code}`, filters.tipo ?? "")) return false;
      if (!matchesFilter(`${a.code} ${a.name ?? ""}`, filters.codigo ?? "")) return false;
      if (!matchesFilter(`${a.brand ?? ""} ${a.model ?? ""}`, filters.marca ?? "")) return false;
      if (!matchesFilter(renderAttributes(a), filters.attrs ?? "")) return false;
      if (showLocationCol) {
        if (!matchesFilter(describePosition(a.currentPosition), filters.ubic ?? "")) return false;
        if (!matchesFilter(zoneName(a.currentPosition) ?? "", filters.zona ?? "")) return false;
      }
      if (tab === "stock") {
        const oc = a.acquisitionExpense
          ? `${a.acquisitionExpense.referenceNumber ?? ""} ${a.acquisitionExpense.description}`
          : "";
        if (!matchesFilter(oc, filters.oc ?? "")) return false;
      }
      return true;
    });
  }, [assets, filters, tab, showLocationCol]);

  if (loading) return <div className="p-8 text-center text-slate-400">Cargando...</div>;
  if (assets.length === 0) {
    const emptyText =
      tab === "stock"
        ? "No hay activos en stock."
        : tab === "assigned"
        ? "No hay activos asignados."
        : "No hay activos pendientes de devolución.";
    return <div className="p-10 text-center text-slate-400">{emptyText}</div>;
  }
  // Total columns (used for empty colSpan): base 4 + location + zone (if applicable) + oc (if stock) + actions
  const totalCols = 4 + (showLocationCol ? 2 : 0) + (tab === "stock" ? 1 : 0) + 1;

  function handleExport() {
    const rows = filtered.map((a) => {
      const base: Record<string, string | number> = {
        Tipo: a.type.name,
        "Código tipo": a.type.code,
        "Código / Serial": a.code,
        Nombre: a.name ?? "",
        Marca: a.brand ?? "",
        Modelo: a.model ?? "",
        Atributos: renderAttributes(a),
        Estado: STATUS_LABEL[a.status],
      };
      if (showLocationCol) {
        base["Contrato"] = a.currentPosition?.location.contract.licitacionNo ?? "";
        base["Cliente"] = a.currentPosition?.location.contract.client ?? "";
        base["Ubicación"] = a.currentPosition?.location.name ?? "";
        base["Puesto"] = a.currentPosition?.name ?? "";
        base["Zona"] = zoneName(a.currentPosition) ?? "";
      }
      if (tab === "stock") {
        base["OC / Gasto Ref."] = a.acquisitionExpense?.referenceNumber ?? "";
        base["OC / Gasto Descripción"] = a.acquisitionExpense?.description ?? "";
      }
      base["Notas"] = a.notes ?? "";
      base["Registrado"] = new Date(a.createdAt).toLocaleString("es-CR");
      base["Actualizado"] = new Date(a.updatedAt).toLocaleString("es-CR");
      return base;
    });
    const sheetByTab: Record<typeof tab, string> = {
      stock: "Stock disponible",
      assigned: "Asignados",
      pending: "Pendientes devolución",
    };
    const fileByTab: Record<typeof tab, string> = {
      stock: "inventario_stock",
      assigned: "inventario_asignados",
      pending: "inventario_pendientes_devolucion",
    };
    exportRowsToExcel({
      filename: fileByTab[tab],
      sheetName: sheetByTab[tab],
      rows,
      columnWidths: showLocationCol
        ? tab === "stock"
          ? [16, 12, 18, 18, 14, 14, 28, 14, 22, 24, 22, 22, 16, 18, 32, 24, 18, 18]
          : [16, 12, 18, 18, 14, 14, 28, 14, 22, 24, 22, 22, 16, 24, 18, 18]
        : [16, 12, 18, 18, 14, 14, 28, 14, 18, 32, 24, 18, 18],
    });
  }

  return (
    <div className="overflow-x-auto">
      {tab === "pending" && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
          Estos activos quedaron pendientes porque otro activo del mismo tipo fue asignado a su puesto.
          Devuélvalos al stock central cuando los reciba físicamente.
        </div>
      )}
      <div className="px-4 py-2 bg-slate-50/50 border-b flex items-center justify-end">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1"
          onClick={handleExport}
          disabled={filtered.length === 0}
          title="Descargar lo mostrado a Excel"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Exportar a Excel ({filtered.length})
        </Button>
      </div>
      {hasActiveFilters && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-800 flex items-center justify-between">
          <span>
            Mostrando <strong>{filtered.length}</strong> de <strong>{assets.length}</strong> activo(s) tras filtros por columna.
          </span>
          <button
            type="button"
            onClick={() => setFilters({})}
            className="text-blue-700 hover:underline font-medium"
          >
            Limpiar filtros
          </button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b">
            <th className="text-left px-4 py-3 font-semibold text-slate-600">Tipo</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-600">Código</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-600">Marca / modelo</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-600">Atributos</th>
            {showLocationCol && (
              <>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Ubicación</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Zona</th>
              </>
            )}
            {tab === "stock" && (
              <th className="text-left px-4 py-3 font-semibold text-slate-600">OC / Gasto</th>
            )}
            <th className="px-4 py-3 w-64" />
          </tr>
          <tr className="bg-slate-50/60 border-b">
            <th className="px-3 py-1.5">
              <ColumnFilterInput value={filters.tipo ?? ""} onChange={(v) => setF("tipo", v)} placeholder="Tipo…" />
            </th>
            <th className="px-3 py-1.5">
              <ColumnFilterInput value={filters.codigo ?? ""} onChange={(v) => setF("codigo", v)} placeholder="Código / nombre…" />
            </th>
            <th className="px-3 py-1.5">
              <ColumnFilterInput value={filters.marca ?? ""} onChange={(v) => setF("marca", v)} placeholder="Marca / modelo…" />
            </th>
            <th className="px-3 py-1.5">
              <ColumnFilterInput value={filters.attrs ?? ""} onChange={(v) => setF("attrs", v)} placeholder="Atributos…" />
            </th>
            {showLocationCol && (
              <>
                <th className="px-3 py-1.5">
                  <ColumnFilterInput value={filters.ubic ?? ""} onChange={(v) => setF("ubic", v)} placeholder="Ubicación…" />
                </th>
                <th className="px-3 py-1.5">
                  <ColumnFilterInput value={filters.zona ?? ""} onChange={(v) => setF("zona", v)} placeholder="Zona…" />
                </th>
              </>
            )}
            {tab === "stock" && (
              <th className="px-3 py-1.5">
                <ColumnFilterInput value={filters.oc ?? ""} onChange={(v) => setF("oc", v)} placeholder="OC / Gasto…" />
              </th>
            )}
            <th />
          </tr>
        </thead>
        <tbody className="divide-y">
          {filtered.length === 0 && (
            <tr>
              <td colSpan={totalCols} className="p-8 text-center text-slate-400 text-xs">
                Ningún activo coincide con los filtros aplicados.
              </td>
            </tr>
          )}
          {filtered.map((a) => (
            <tr key={a.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-800">{a.type.name}</div>
                <div className="text-xs text-slate-400">{a.type.code}</div>
              </td>
              <td className="px-4 py-3">
                <code className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{a.code}</code>
                {a.name && <div className="text-xs text-slate-500 mt-0.5">{a.name}</div>}
              </td>
              <td className="px-4 py-3 text-slate-600">
                {[a.brand, a.model].filter(Boolean).join(" / ") || <span className="text-slate-300">—</span>}
              </td>
              <td className="px-4 py-3 text-xs text-slate-500 max-w-[260px]">
                {renderAttributes(a) || <span className="text-slate-300">—</span>}
              </td>
              {showLocationCol && (
                <>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {describePosition(a.currentPosition)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {zoneName(a.currentPosition) ? (
                      <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                        {zoneName(a.currentPosition)}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </>
              )}
              {tab === "stock" && (
                <td className="px-4 py-3 text-xs text-slate-600">
                  {a.acquisitionExpense ? (
                    <span title={a.acquisitionExpense.description}>
                      {a.acquisitionExpense.referenceNumber ?? a.acquisitionExpense.description}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              )}
              <td className="px-4 py-3">
                {canManage && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onEdit(a)} title="Editar">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {tab === "assigned" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs gap-1"
                        onClick={() => onReturn(a)}
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Devolver
                      </Button>
                    )}
                    {tab === "pending" && (
                      <Button
                        size="sm"
                        className="h-8 text-xs gap-1 bg-amber-600 hover:bg-amber-700"
                        onClick={() => onReturn(a)}
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Devolver al stock
                      </Button>
                    )}
                    {tab === "stock" && (
                      <>
                        <Button
                          size="sm"
                          className="h-8 text-xs gap-1"
                          onClick={() => onAssign(a)}
                          title="Asignar a un puesto"
                        >
                          <ArrowRightCircle className="h-3.5 w-3.5" /> Asignar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1 text-amber-700 border-amber-300 hover:bg-amber-50"
                          onClick={() => onIssue(a)}
                          title="Dar de baja"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" /> Baja
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:bg-red-50"
                          onClick={() => onDelete(a)}
                          title="Eliminar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Movements Table

function MovementsTable({ movements, loading }: { movements: MovementRow[]; loading: boolean }) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFilters((prev) => ({ ...prev, [k]: v }));
  const hasActiveFilters = Object.values(filters).some((v) => v.trim());

  const filtered = useMemo(() => {
    return movements.filter((m) => {
      if (!matchesFilter(formatDate(m.createdAt), filters.fecha ?? "")) return false;
      if (!matchesFilter(MOVEMENT_LABEL[m.type], filters.accion ?? "")) return false;
      if (!matchesFilter(`${m.asset.type.name} ${m.asset.code} ${m.asset.name ?? ""}`, filters.activo ?? "")) return false;
      const desdeText = `${describePosition(m.fromPosition)} ${zoneName(m.fromPosition) ?? ""}`;
      const haciaText = `${describePosition(m.toPosition)} ${zoneName(m.toPosition) ?? ""}`;
      if (!matchesFilter(desdeText, filters.desde ?? "")) return false;
      if (!matchesFilter(haciaText, filters.hacia ?? "")) return false;
      const motivoText = [
        m.intakeReason ? INTAKE_REASON[m.intakeReason] : "",
        m.issueReason ? ISSUE_REASON[m.issueReason] : "",
        m.expense ? `${m.expense.referenceNumber ?? ""} ${m.expense.description}` : "",
      ]
        .join(" ")
        .trim();
      if (!matchesFilter(motivoText, filters.motivo ?? "")) return false;
      if (!matchesFilter(m.notes ?? "", filters.notas ?? "")) return false;
      return true;
    });
  }, [movements, filters]);

  if (loading) return <div className="p-8 text-center text-slate-400">Cargando...</div>;
  if (movements.length === 0) {
    return <div className="p-10 text-center text-slate-400">Sin movimientos registrados.</div>;
  }

  function handleExport() {
    const rows = filtered.map((m) => ({
      Fecha: new Date(m.createdAt).toLocaleString("es-CR"),
      Acción: MOVEMENT_LABEL[m.type],
      "Tipo activo": m.asset.type.name,
      "Código activo": m.asset.code,
      "Nombre activo": m.asset.name ?? "",
      "Desde - Contrato": m.fromPosition?.location.contract.licitacionNo ?? "",
      "Desde - Ubicación": m.fromPosition?.location.name ?? "",
      "Desde - Puesto": m.fromPosition?.name ?? "",
      "Desde - Zona": zoneName(m.fromPosition) ?? "",
      "Hacia - Contrato": m.toPosition?.location.contract.licitacionNo ?? "",
      "Hacia - Ubicación": m.toPosition?.location.name ?? "",
      "Hacia - Puesto": m.toPosition?.name ?? "",
      "Hacia - Zona": zoneName(m.toPosition) ?? "",
      "Motivo ingreso": m.intakeReason ? INTAKE_REASON[m.intakeReason] : "",
      "Motivo salida": m.issueReason ? ISSUE_REASON[m.issueReason] : "",
      "OC / Gasto Ref.": m.expense?.referenceNumber ?? "",
      "OC / Gasto Descripción": m.expense?.description ?? "",
      Notas: m.notes ?? "",
    }));
    exportRowsToExcel({
      filename: "inventario_movimientos",
      sheetName: "Movimientos",
      rows,
      columnWidths: [18, 14, 16, 18, 22, 22, 22, 22, 16, 22, 22, 22, 16, 16, 16, 18, 28, 28],
    });
  }

  return (
    <div className="overflow-x-auto">
      <div className="px-4 py-2 bg-slate-50/50 border-b flex items-center justify-end">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1"
          onClick={handleExport}
          disabled={filtered.length === 0}
          title="Descargar lo mostrado a Excel"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Exportar a Excel ({filtered.length})
        </Button>
      </div>
      {hasActiveFilters && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-800 flex items-center justify-between">
          <span>
            Mostrando <strong>{filtered.length}</strong> de <strong>{movements.length}</strong> movimiento(s) tras filtros por columna.
          </span>
          <button
            type="button"
            onClick={() => setFilters({})}
            className="text-blue-700 hover:underline font-medium"
          >
            Limpiar filtros
          </button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b">
            <th className="text-left px-4 py-3 font-semibold text-slate-600">Fecha</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-600">Acción</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-600">Activo</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-600">Desde</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-600">Hacia</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-600">Motivo / OC</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-600">Notas</th>
          </tr>
          <tr className="bg-slate-50/60 border-b">
            <th className="px-3 py-1.5">
              <ColumnFilterInput value={filters.fecha ?? ""} onChange={(v) => setF("fecha", v)} placeholder="Fecha…" />
            </th>
            <th className="px-3 py-1.5">
              <ColumnFilterInput value={filters.accion ?? ""} onChange={(v) => setF("accion", v)} placeholder="Acción…" />
            </th>
            <th className="px-3 py-1.5">
              <ColumnFilterInput value={filters.activo ?? ""} onChange={(v) => setF("activo", v)} placeholder="Activo…" />
            </th>
            <th className="px-3 py-1.5">
              <ColumnFilterInput value={filters.desde ?? ""} onChange={(v) => setF("desde", v)} placeholder="Desde…" />
            </th>
            <th className="px-3 py-1.5">
              <ColumnFilterInput value={filters.hacia ?? ""} onChange={(v) => setF("hacia", v)} placeholder="Hacia…" />
            </th>
            <th className="px-3 py-1.5">
              <ColumnFilterInput value={filters.motivo ?? ""} onChange={(v) => setF("motivo", v)} placeholder="Motivo / OC…" />
            </th>
            <th className="px-3 py-1.5">
              <ColumnFilterInput value={filters.notas ?? ""} onChange={(v) => setF("notas", v)} placeholder="Notas…" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {filtered.length === 0 && (
            <tr>
              <td colSpan={7} className="p-8 text-center text-slate-400 text-xs">
                Ningún movimiento coincide con los filtros aplicados.
              </td>
            </tr>
          )}
          {filtered.map((m) => (
            <tr key={m.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-xs text-slate-600">{formatDate(m.createdAt)}</td>
              <td className="px-4 py-3">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MOVEMENT_BADGE[m.type]}`}>
                  {MOVEMENT_LABEL[m.type]}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-slate-800">{m.asset.type.name}</div>
                <code className="text-xs bg-slate-100 text-slate-600 px-1 rounded">{m.asset.code}</code>
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">
                {describePosition(m.fromPosition)}
                {zoneName(m.fromPosition) && (
                  <div className="mt-0.5">
                    <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                      Zona: {zoneName(m.fromPosition)}
                    </span>
                  </div>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">
                {describePosition(m.toPosition)}
                {zoneName(m.toPosition) && (
                  <div className="mt-0.5">
                    <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[11px] font-medium">
                      Zona: {zoneName(m.toPosition)}
                    </span>
                  </div>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">
                {m.intakeReason && INTAKE_REASON[m.intakeReason]}
                {m.issueReason && ISSUE_REASON[m.issueReason]}
                {m.expense && (
                  <span className="block text-slate-500">
                    {m.expense.referenceNumber ?? m.expense.description}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">{m.notes || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Intake Dialog (ingreso a stock)

type IntakeItem = { code: string; name: string; brand: string; model: string; attributes: Record<string, unknown> };

function IntakeDialog({
  open, onOpenChange, types, onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  types: AssetType[];
  onSuccess: () => void;
}) {
  const [typeId, setTypeId] = useState("");
  const [intakeReason, setIntakeReason] = useState<"PURCHASE" | "RETURN" | "INITIAL" | "OTHER">("PURCHASE");
  const [expenseRef, setExpenseRef] = useState("");
  const [expenseId, setExpenseId] = useState<string | null>(null);
  const [acquisitionDate, setAcquisitionDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<IntakeItem[]>([{ code: "", name: "", brand: "", model: "", attributes: {} }]);

  const type = useMemo(() => types.find((t) => t.id === typeId), [types, typeId]);
  const fields = useMemo(
    () => (Array.isArray(type?.fields) ? (type!.fields as ExtraField[]) : []),
    [type]
  );

  const { data: expenseSearch } = useQuery<{ data: Array<{ id: string; description: string; referenceNumber: string | null; amount: number; periodMonth: string }> }>({
    queryKey: ["expense-search", expenseRef],
    queryFn: () => {
      if (!expenseRef.trim()) return Promise.resolve({ data: [] });
      return fetch(`/api/expenses?q=${encodeURIComponent(expenseRef)}&limit=10`).then((r) => r.json());
    },
    enabled: expenseRef.length >= 2 && !expenseId,
  });

  function reset() {
    setTypeId("");
    setIntakeReason("PURCHASE");
    setExpenseRef("");
    setExpenseId(null);
    setAcquisitionDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setItems([{ code: "", name: "", brand: "", model: "", attributes: {} }]);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          typeId,
          intakeReason,
          expenseId: expenseId || null,
          acquisitionDate,
          notes: notes.trim() || null,
          items: items.map((it) => ({
            code: it.code.trim(),
            name: it.name.trim() || null,
            brand: it.brand.trim() || null,
            model: it.model.trim() || null,
            attributes: it.attributes,
          })),
        }),
      });
      const json = await r.json();
      if (json.error) throw new Error(json.error.message || "Error");
      return json;
    },
    onSuccess: (res) => {
      toast.success(`${res.data?.count ?? items.length} activo(s) ingresado(s) al stock`);
      reset();
      onSuccess();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); } onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ingreso a stock</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700">Tipo de activo *</label>
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="w-full h-9 text-sm border rounded-md px-2 bg-white"
              >
                <option value="">Seleccione…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Motivo</label>
              <select
                value={intakeReason}
                onChange={(e) => setIntakeReason(e.target.value as typeof intakeReason)}
                className="w-full h-9 text-sm border rounded-md px-2 bg-white"
              >
                <option value="PURCHASE">Compra</option>
                <option value="RETURN">Devolución</option>
                <option value="INITIAL">Inicial</option>
                <option value="OTHER">Otro</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Fecha</label>
              <Input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">
              Gasto / OC asociado {intakeReason === "PURCHASE" ? "*" : "(opcional)"}
            </label>
            {expenseId ? (
              <div className="flex items-center gap-2 p-2 rounded border bg-slate-50 text-sm">
                <span className="flex-1">{expenseRef}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setExpenseId(null); setExpenseRef(""); }}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Busque por descripción o número de referencia"
                  value={expenseRef}
                  onChange={(e) => setExpenseRef(e.target.value)}
                />
                {expenseSearch?.data && expenseSearch.data.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto z-10">
                    {expenseSearch.data.map((exp) => (
                      <button
                        key={exp.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm border-b last:border-0"
                        onClick={() => {
                          setExpenseId(exp.id);
                          setExpenseRef(`${exp.referenceNumber ?? ""} ${exp.description}`.trim());
                        }}
                      >
                        <div className="font-medium text-slate-800">
                          {exp.referenceNumber ?? "(sin ref.)"} — {exp.description}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">Notas</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones del ingreso" />
          </div>

          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-700">Activos a ingresar</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setItems((p) => [...p, { code: "", name: "", brand: "", model: "", attributes: {} }])}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Agregar
              </Button>
            </div>
            <div className="space-y-3">
              {items.map((it, i) => (
                <div key={i} className="border rounded p-3 space-y-2 bg-slate-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500">Activo {i + 1}</span>
                    {items.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-red-500"
                        onClick={() => setItems((p) => p.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>
                      <label className="text-xs text-slate-500">Código / serial *</label>
                      <Input
                        value={it.code}
                        onChange={(e) => {
                          const v = e.target.value;
                          setItems((p) => p.map((x, j) => (j === i ? { ...x, code: v } : x)));
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Nombre</label>
                      <Input
                        value={it.name}
                        onChange={(e) => {
                          const v = e.target.value;
                          setItems((p) => p.map((x, j) => (j === i ? { ...x, name: v } : x)));
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Marca</label>
                      <Input
                        value={it.brand}
                        onChange={(e) => {
                          const v = e.target.value;
                          setItems((p) => p.map((x, j) => (j === i ? { ...x, brand: v } : x)));
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Modelo</label>
                      <Input
                        value={it.model}
                        onChange={(e) => {
                          const v = e.target.value;
                          setItems((p) => p.map((x, j) => (j === i ? { ...x, model: v } : x)));
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  {fields.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-1 border-t">
                      {fields.map((f) => (
                        <div key={f.key}>
                          <label className="text-xs text-slate-500">
                            {f.label}
                            {f.required && " *"}
                          </label>
                          {f.type === "boolean" ? (
                            <input
                              type="checkbox"
                              checked={Boolean(it.attributes[f.key])}
                              onChange={(e) => {
                                const v = e.target.checked;
                                setItems((p) =>
                                  p.map((x, j) =>
                                    j === i ? { ...x, attributes: { ...x.attributes, [f.key]: v } } : x
                                  )
                                );
                              }}
                              className="w-4 h-4 rounded mt-2"
                            />
                          ) : (
                            <Input
                              type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                              value={(it.attributes[f.key] as string | number | undefined) ?? ""}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const v = f.type === "number" && raw !== "" ? parseFloat(raw) : raw;
                                setItems((p) =>
                                  p.map((x, j) =>
                                    j === i ? { ...x, attributes: { ...x.attributes, [f.key]: v } } : x
                                  )
                                );
                              }}
                              className="h-8 text-sm"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
            Cancelar
          </Button>
          <Button
            disabled={mutation.isPending}
            onClick={() => {
              if (!typeId) return toast.error("Seleccione un tipo");
              if (intakeReason === "PURCHASE" && !expenseId) {
                return toast.error("Seleccione el gasto / OC asociado a la compra");
              }
              if (items.some((it) => !it.code.trim())) {
                return toast.error("Todos los activos deben tener código / serial");
              }
              mutation.mutate();
            }}
          >
            {mutation.isPending ? "Guardando…" : "Ingresar al stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Issue / Return / Edit dialogs

function IssueDialog({
  asset, onOpenChange, onSuccess,
}: {
  asset: AssetRow | null;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState<"LOST" | "DAMAGED" | "DISPOSED" | "OTHER">("DISPOSED");
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!asset) return;
      const r = await fetch(`/api/assets/${asset.id}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ISSUE", reason, notes: notes.trim() || null }),
      });
      const json = await r.json();
      if (json.error) throw new Error(json.error.message || "Error");
      return json;
    },
    onSuccess: () => {
      toast.success("Activo dado de baja");
      onSuccess();
      onOpenChange(false);
      setReason("DISPOSED");
      setNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Dar de baja</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {asset && (
            <p className="text-sm text-slate-600">
              {asset.type.name} · <code className="text-xs bg-slate-100 px-1 rounded">{asset.code}</code>
            </p>
          )}
          <div>
            <label className="text-sm font-medium text-slate-700">Motivo</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
              className="w-full h-9 text-sm border rounded-md px-2 bg-white"
            >
              <option value="DISPOSED">Desechado</option>
              <option value="LOST">Pérdida</option>
              <option value="DAMAGED">Dañado</option>
              <option value="OTHER">Otro</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Notas</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            className="bg-red-600 hover:bg-red-700"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Dando de baja…" : "Dar de baja"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnDialog({
  asset, onOpenChange, onSuccess,
}: {
  asset: AssetRow | null;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!asset) return;
      const r = await fetch(`/api/assets/${asset.id}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RETURN", notes: notes.trim() || null }),
      });
      const json = await r.json();
      if (json.error) throw new Error(json.error.message || "Error");
      return json;
    },
    onSuccess: () => {
      toast.success("Activo devuelto al stock");
      onSuccess();
      onOpenChange(false);
      setNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Devolver al stock</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {asset && (
            <>
              <p className="text-sm text-slate-600">
                {asset.type.name} · <code className="text-xs bg-slate-100 px-1 rounded">{asset.code}</code>
              </p>
              <p className="text-xs text-slate-500">
                Desde: {describePosition(asset.currentPosition)}
              </p>
            </>
          )}
          <div>
            <label className="text-sm font-medium text-slate-700">Notas</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Guardando…" : "Devolver"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAssetDialog({
  asset, onOpenChange, onSuccess,
}: {
  asset: AssetRow | null;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<{ code: string; name: string; brand: string; model: string; attributes: Record<string, unknown>; notes: string }>({
    code: "", name: "", brand: "", model: "", attributes: {}, notes: "",
  });

  useEffect(() => {
    if (asset) {
      setForm({
        code: asset.code,
        name: asset.name ?? "",
        brand: asset.brand ?? "",
        model: asset.model ?? "",
        attributes: ensureAttrs(asset.attributes),
        notes: asset.notes ?? "",
      });
    }
  }, [asset]);

  const fields = useMemo(
    () => (asset && Array.isArray(asset.type.fields) ? (asset.type.fields as ExtraField[]) : []),
    [asset]
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!asset) return;
      const r = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim(),
          name: form.name.trim() || null,
          brand: form.brand.trim() || null,
          model: form.model.trim() || null,
          attributes: form.attributes,
          notes: form.notes.trim() || null,
        }),
      });
      const json = await r.json();
      if (json.error) throw new Error(json.error.message || "Error");
      return json;
    },
    onSuccess: () => {
      toast.success("Activo actualizado");
      onSuccess();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar activo</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {asset && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              {asset.type.name}
              <Badge variant={STATUS_VARIANT[asset.status]}>{STATUS_LABEL[asset.status]}</Badge>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500">Código / serial *</label>
              <Input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Nombre</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Marca</label>
              <Input
                value={form.brand}
                onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Modelo</label>
              <Input
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
          </div>
          {fields.length > 0 && (
            <div className="grid grid-cols-2 gap-2 border-t pt-2">
              {fields.map((f) => (
                <div key={f.key}>
                  <label className="text-xs text-slate-500">
                    {f.label}
                    {f.required && " *"}
                  </label>
                  {f.type === "boolean" ? (
                    <input
                      type="checkbox"
                      checked={Boolean(form.attributes[f.key])}
                      onChange={(e) =>
                        setForm((s) => ({ ...s, attributes: { ...s.attributes, [f.key]: e.target.checked } }))
                      }
                      className="w-4 h-4 rounded mt-2"
                    />
                  ) : (
                    <Input
                      type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                      value={(form.attributes[f.key] as string | number | undefined) ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const v = f.type === "number" && raw !== "" ? parseFloat(raw) : raw;
                        setForm((s) => ({ ...s, attributes: { ...s.attributes, [f.key]: v } }));
                      }}
                      className="h-8 text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <div>
            <label className="text-xs text-slate-500">Notas</label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Assign from stock to a contract position (autocompletar por número/nombre)

interface PositionSearchShift { id: string; label: string | null; hours: number }
interface PositionSearchResult {
  id: string;
  name: string;
  description?: string | null;
  phoneLine?: string | null;
  shifts: PositionSearchShift[];
  location: {
    id: string;
    name: string;
    contract: { id: string; licitacionNo: string; client: string; status: string };
  };
}

function AssignFromStockDialog({
  asset, onOpenChange, onSuccess,
}: {
  asset: AssetRow | null;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PositionSearchResult | null>(null);
  const [showList, setShowList] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!asset) {
      setQuery("");
      setSelected(null);
      setNotes("");
      setShowList(false);
    }
  }, [asset]);

  const { data: resultsRes, isLoading } = useQuery<{ data: PositionSearchResult[] }>({
    queryKey: ["positions-search", query],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      params.set("limit", "25");
      return fetch(`/api/positions/search?${params}`).then((r) => r.json());
    },
    enabled: !!asset && showList,
  });
  const results = resultsRes?.data ?? [];

  const mutation = useMutation({
    mutationFn: async () => {
      if (!asset || !selected) return;
      const r = await fetch(`/api/assets/${asset.id}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ASSIGN", toPositionId: selected.id, notes: notes.trim() || null }),
      });
      const json = await r.json();
      if (json.error) throw new Error(json.error.message || "Error");
      return json;
    },
    onSuccess: (json: { data?: { displaced?: number } } | undefined) => {
      const displaced = json?.data?.displaced ?? 0;
      if (displaced > 0) {
        toast.success(
          `Activo asignado. ${displaced} activo(s) del mismo tipo en el puesto pasaron a "Pendientes de devolución".`
        );
      } else {
        toast.success("Activo asignado al puesto");
      }
      onSuccess();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Asignar activo a un puesto</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {asset && (
            <p className="text-sm text-slate-600">
              {asset.type.name} · <code className="text-xs bg-slate-100 px-1 rounded">{asset.code}</code>
              {(asset.brand || asset.model) && (
                <span className="text-slate-500"> — {[asset.brand, asset.model].filter(Boolean).join(" / ")}</span>
              )}
            </p>
          )}

          <div>
            <label className="text-sm font-medium text-slate-700">
              Buscar puesto por número o nombre *
            </label>
            <p className="text-xs text-slate-500 mb-1">
              Escriba el número del puesto, el nombre de la ubicación o la licitación del contrato.
            </p>
            {selected ? (
              <div className="flex items-start gap-2 p-3 rounded border bg-blue-50">
                <div className="flex-1 min-w-0 text-sm">
                  <div className="font-medium text-slate-800">{selected.name}</div>
                  {selected.description && (
                    <div className="text-xs text-slate-500">{selected.description}</div>
                  )}
                  <div className="text-xs text-slate-600 mt-1">
                    <span className="font-medium">Ubicación:</span> {selected.location.name}
                  </div>
                  <div className="text-xs text-slate-600">
                    <span className="font-medium">Contrato:</span> {selected.location.contract.licitacionNo} — {selected.location.contract.client}
                  </div>
                  {selected.shifts.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selected.shifts.map((s) => (
                        <span
                          key={s.id}
                          className="text-xs bg-white text-slate-700 px-1.5 py-0.5 rounded border"
                        >
                          {s.label ? `${s.label} · ` : ""}
                          {s.hours}h
                        </span>
                      ))}
                    </div>
                  )}
                  {selected.phoneLine && (
                    <div className="text-xs text-slate-500 mt-1">Línea: {selected.phoneLine}</div>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelected(null);
                    setQuery("");
                    setShowList(true);
                  }}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setShowList(true);
                    }}
                    onFocus={() => setShowList(true)}
                    placeholder="Ej: 101, Portón Principal, LP-2024-015…"
                    className="pl-8"
                  />
                </div>
                {showList && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg max-h-64 overflow-y-auto z-10">
                    {isLoading ? (
                      <div className="p-3 text-center text-xs text-slate-400">Buscando…</div>
                    ) : results.length === 0 ? (
                      <div className="p-3 text-center text-xs text-slate-400">
                        {query.trim()
                          ? "No se encontraron puestos."
                          : "Escriba el número del puesto o parte del nombre."}
                      </div>
                    ) : (
                      results.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b last:border-0"
                          onClick={() => {
                            setSelected(p);
                            setShowList(false);
                          }}
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="font-medium text-slate-800 text-sm">{p.name}</span>
                            <span className="text-xs text-slate-400">
                              {p.location.contract.licitacionNo}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500">
                            {p.location.contract.client} · {p.location.name}
                          </div>
                          {p.shifts.length > 0 && (
                            <div className="text-xs text-slate-400 mt-0.5">
                              {p.shifts.map((s) => `${s.label ? s.label + " " : ""}${s.hours}h`).join(" · ")}
                            </div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">Notas</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones (opcional)" />
          </div>
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
