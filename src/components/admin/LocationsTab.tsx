"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, FileSpreadsheet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { useCompanies } from "@/lib/hooks/use-companies";
import { companyDisplayName } from "@/lib/utils/constants";
import { exportRowsToExcel } from "@/lib/utils/excel-export";

interface ZoneLite {
  id: string;
  name: string;
  isActive: boolean;
}

interface LocationRow {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  positionsCount: number;
  contract: { id: string; licitacionNo: string; client: string; company: string };
  zone: { id: string; name: string } | null;
  zoneId: string | null;
}

export function LocationsTab({ readOnly }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const { data: companiesRes } = useCompanies();
  const companyRows = companiesRes?.data ?? [];

  const { data: zonesRes } = useQuery<{ data: Array<{ id: string; name: string; isActive: boolean }> }>({
    queryKey: ["admin-zones"],
    queryFn: () => fetch("/api/admin/catalogs/zones").then((r) => r.json()),
  });
  const zones: ZoneLite[] = zonesRes?.data ?? [];
  const activeZones = zones.filter((z) => z.isActive);

  const { data, isLoading } = useQuery<{ data: LocationRow[] }>({
    queryKey: ["admin-locations"],
    queryFn: () => fetch("/api/admin/catalogs/locations").then((r) => r.json()),
  });

  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState<string>("ALL"); // ALL | NONE | <id>
  const [companyFilter, setCompanyFilter] = useState<string>("ALL");

  const rows = data?.data ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (companyFilter !== "ALL" && r.contract.company !== companyFilter) return false;
      if (zoneFilter === "NONE" && r.zoneId) return false;
      if (zoneFilter !== "ALL" && zoneFilter !== "NONE" && r.zoneId !== zoneFilter) return false;
      if (q) {
        const comp = companyDisplayName(r.contract.company, companyRows) ?? "";
        const haystack = [
          r.name,
          r.contract.client,
          r.contract.licitacionNo,
          r.zone?.name ?? "",
          comp,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, zoneFilter, companyFilter, companyRows]);

  const setZoneMutation = useMutation({
    mutationFn: async ({ id, zoneId }: { id: string; zoneId: string | null }) => {
      const r = await fetch(`/api/admin/catalogs/locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId }),
      });
      const json = (await r.json()) as { data?: unknown; error?: { message?: string } };
      if (!r.ok || json.error) throw new Error(json.error?.message ?? `Error ${r.status}`);
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-locations"] });
      qc.invalidateQueries({ queryKey: ["admin-zones"] });
    },
    onError: (e: Error) => toast.error(e.message || "Error al guardar"),
  });

  const distinctCompanies = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of rows) {
      if (!set.has(r.contract.company)) {
        set.set(r.contract.company, companyDisplayName(r.contract.company, companyRows) ?? r.contract.company);
      }
    }
    return Array.from(set.entries())
      .map(([code, label]) => ({ code, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, companyRows]);

  const totalUnassigned = rows.filter((r) => !r.zoneId).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-slate-500 max-w-3xl">
          Listado global de ubicaciones de todos los contratos. Asigne o cambie la zona usando el selector
          de la columna <strong className="text-slate-700">Zona</strong>. Las zonas se administran en la pestaña{" "}
          <strong className="text-slate-700">Zonas</strong>.
        </p>
        {totalUnassigned > 0 && (
          <p className="text-xs text-amber-700">
            Hay <strong>{totalUnassigned}</strong> ubicación(es) sin zona asignada.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            className="pl-8 h-9"
            placeholder="Buscar por ubicación, contrato, licitación o zona…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="h-9 text-sm border rounded-md px-2 bg-white"
          value={zoneFilter}
          onChange={(e) => setZoneFilter(e.target.value)}
        >
          <option value="ALL">Todas las zonas</option>
          <option value="NONE">Sin zona asignada</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
              {!z.isActive ? " (inactiva)" : ""}
            </option>
          ))}
        </select>
        <select
          className="h-9 text-sm border rounded-md px-2 bg-white"
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
        >
          <option value="ALL">Todas las empresas</option>
          {distinctCompanies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        {(query || zoneFilter !== "ALL" || companyFilter !== "ALL") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQuery("");
              setZoneFilter("ALL");
              setCompanyFilter("ALL");
            }}
          >
            Limpiar
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 ml-auto"
          disabled={filtered.length === 0}
          onClick={() => {
            const exportRows = filtered.map((loc) => ({
              Ubicación: loc.name,
              Descripción: loc.description ?? "",
              Contrato: loc.contract.licitacionNo,
              Cliente: loc.contract.client,
              Empresa: companyDisplayName(loc.contract.company, companyRows) ?? loc.contract.company,
              Puestos: loc.positionsCount,
              Zona: loc.zone?.name ?? "",
              Orden: loc.sortOrder,
            }));
            exportRowsToExcel({
              filename: "ubicaciones",
              sheetName: "Ubicaciones",
              rows: exportRows,
              columnWidths: [28, 36, 18, 28, 16, 10, 18, 8],
            });
          }}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Exportar a Excel ({filtered.length})
        </Button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-slate-400">Cargando...</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-slate-400 border rounded-lg">
          No hay ubicaciones registradas. Cree ubicaciones desde la pantalla de cada contrato.
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-slate-400 border rounded-lg">
          Ningún resultado para los filtros aplicados.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Ubicación</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Contrato</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 w-32">Empresa</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 w-20">Puestos</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 w-56">Zona</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((loc) => (
                <tr key={loc.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{loc.name}</div>
                    {loc.description && (
                      <div className="text-xs text-slate-500 truncate max-w-md" title={loc.description}>
                        {loc.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-800">{loc.contract.client}</div>
                    <div className="text-xs text-slate-500">{loc.contract.licitacionNo}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {companyDisplayName(loc.contract.company, companyRows) ?? loc.contract.company}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-600">{loc.positionsCount}</td>
                  <td className="px-4 py-3">
                    {readOnly ? (
                      loc.zone ? (
                        <Badge variant="success">{loc.zone.name}</Badge>
                      ) : (
                        <Badge variant="secondary">Sin asignar</Badge>
                      )
                    ) : (
                      <select
                        className="w-full h-8 text-sm border rounded-md px-2 bg-white disabled:bg-slate-50"
                        value={loc.zoneId ?? ""}
                        disabled={setZoneMutation.isPending}
                        onChange={(e) => {
                          const next = e.target.value || null;
                          if (next === loc.zoneId) return;
                          setZoneMutation.mutate(
                            { id: loc.id, zoneId: next },
                            {
                              onSuccess: () => {
                                if (next) {
                                  const zoneName = zones.find((z) => z.id === next)?.name ?? "Zona";
                                  toast.success(`"${loc.name}" asignada a ${zoneName}`);
                                } else {
                                  toast.success(`Zona quitada de "${loc.name}"`);
                                }
                              },
                            }
                          );
                        }}
                      >
                        <option value="">— Sin asignar —</option>
                        {activeZones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name}
                          </option>
                        ))}
                        {loc.zone && !activeZones.find((z) => z.id === loc.zone!.id) && (
                          <option value={loc.zone.id}>{loc.zone.name} (inactiva)</option>
                        )}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
