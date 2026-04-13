"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Plus, Search, Upload, Download, FileSpreadsheet } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrafficLightBadge } from "@/components/shared/TrafficLightBadge";
import { formatCurrency, formatDate, daysUntilExpiry } from "@/lib/utils/format";
import { companyDisplayName, CONTRACT_STATUS_LABELS, CLIENT_TYPE_LABELS } from "@/lib/utils/constants";
import { useCompanies } from "@/lib/hooks/use-companies";
import { calcTrafficLight } from "@/lib/utils/constants";
import { canModifyContracts } from "@/lib/permissions";
import type { ContractStatus, ClientType } from "@prisma/client";

interface Contract {
  id: string; licitacionNo: string; company: string; client: string;
  clientType: ClientType; officersCount: number; positionsCount: number;
  status: ContractStatus; startDate: string; endDate: string;
  monthlyBilling: number;
  /** % efectivo insumos (distribución o presupuesto insumos) */
  suppliesBudgetPct: number;
  suppliesBudget: number;
  laborPct: number; adminPct: number; profitPct: number;
  laborBudget: number; adminBudget: number; profitBudget: number;
  equivalencePct: number;
  /** Participación respecto al total activo global (contratos ACTIVO + PRÓRROGA) */
  billingSharePct: number; laborSharePct: number; suppliesSharePct: number;
  adminSharePct: number; profitSharePct: number;
}

function BudgetPartidaCell({ amount, pct }: { amount: number; pct: number }) {
  return (
    <td className="px-2 py-3 text-right align-top whitespace-nowrap">
      <div className="font-medium text-slate-800">{formatCurrency(amount)}</div>
      <div className="text-xs text-slate-400">{(pct * 100).toFixed(1)}%</div>
    </td>
  );
}

function GlobalPartidaCell({ sharePct, active }: { sharePct: number; active: boolean }) {
  if (!active) {
    return (
      <td className="px-2 py-3 text-right text-slate-300">—</td>
    );
  }
  return (
    <td className="px-2 py-3 text-right whitespace-nowrap">
      <span className="font-semibold text-indigo-600">{(sharePct * 100).toFixed(2)}%</span>
    </td>
  );
}

export default function ContractsPage() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const { data: companiesRes } = useCompanies();
  const companyRows = companiesRes?.data ?? [];
  const canCreate = session?.user?.role ? canModifyContracts(session.user.role) : false;
  const contractFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("all");
  const [clientType, setClientType] = useState<string>("all");

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  companies.forEach((c) => params.append("company", c));
  if (status !== "all") params.set("status", status);
  if (clientType !== "all") params.set("clientType", clientType);
  params.set("pageSize", "100");

  const { data, isLoading } = useQuery<{ data: Contract[]; meta: { total: number } }>({
    queryKey: ["contracts", search, companies, status, clientType],
    queryFn: () => fetch(`/api/contracts?${params}`).then((r) => r.json()),
    staleTime: 30000,
  });

  const contracts = data?.data ?? [];

  async function downloadContractsExport() {
    const sp = new URLSearchParams();
    if (search) sp.set("search", search);
    companies.forEach((c) => sp.append("company", c));
    if (status !== "all") sp.set("status", status);
    if (clientType !== "all") sp.set("clientType", clientType);
    const res = await fetch(`/api/contracts/export?${sp.toString()}`, { credentials: "same-origin" });
    if (!res.ok) {
      toast.error("No se pudo exportar a Excel");
      return;
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition");
    const m = cd?.match(/filename="([^"]+)"/);
    const filename = m?.[1] ?? "contratos.xlsx";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Descarga de contratos lista");
  }

  async function downloadContractTemplate() {
    const res = await fetch("/api/import/contracts", { credentials: "same-origin" });
    if (!res.ok) {
      toast.error("No se pudo descargar la plantilla");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "plantilla_importar_contratos.xlsx";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function onContractFileSelected(f: File | null) {
    if (!f) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch("/api/import/contracts", { method: "POST", body: fd, credentials: "same-origin" });
      const json = (await res.json()) as {
        data?: {
          created?: number;
          skipped?: number;
          skippedExistingRows?: { sheetRow: number; licitacionNo: string }[];
          errors?: { sheetRow: number; message: string }[];
          message?: string;
        };
        error?: { message?: string };
      };
      if (!res.ok) {
        toast.error(json.error?.message ?? "Error al importar");
        return;
      }
      const d = json.data;
      const createdN = d?.created ?? 0;
      const blockingErrors = d?.errors ?? [];
      const skippedRows = d?.skippedExistingRows ?? [];

      const errLines =
        blockingErrors.length > 0
          ? blockingErrors
              .slice(0, 100)
              .map((e) => `Fila ${e.sheetRow}: ${e.message}`)
              .join("\n") + (blockingErrors.length > 100 ? `\n… y ${blockingErrors.length - 100} más.` : "")
          : "";

      const skippedLines =
        skippedRows.length > 0
          ? skippedRows.length <= 40
            ? skippedRows.map((s) => `Fila ${s.sheetRow}: ${s.licitacionNo}`).join("\n")
            : `${skippedRows
                .slice(0, 35)
                .map((s) => `Fila ${s.sheetRow}: ${s.licitacionNo}`)
                .join("\n")}\n… y ${skippedRows.length - 35} más (total ${skippedRows.length} omitidas).`
          : "";

      const errHint =
        errLines !== "" || skippedLines !== ""
          ? `\n\n— «Fila N» = fila en Excel (fila 1 = títulos). «Omitidas» no son fallo: esa licitación ya está guardada.`
          : "";

      const detailParts: string[] = [];
      if (errLines) detailParts.push(`ERRORES — corrija en el archivo:\n${errLines}`);
      if (skippedLines) detailParts.push(`OMITIDAS — ya existen en el sistema:\n${skippedLines}`);
      const detailBody = detailParts.length > 0 ? `${detailParts.join("\n\n")}${errHint}` : "";

      const longDetail = detailBody.length > 200;
      const toastOpts = longDetail ? { durationMs: 90_000, copyable: true as const } : undefined;

      if (createdN > 0) {
        toast.success(d?.message ?? `Se importaron ${createdN} contrato(s).`, detailBody || undefined, toastOpts);
      } else if (errLines) {
        toast.error("No se importaron contratos nuevos", detailBody || d?.message, toastOpts);
      } else if (skippedLines) {
        toast.info("Importación", detailBody || d?.message || "Sin contratos nuevos.", toastOpts);
      } else {
        toast.info("Importación", d?.message ?? "Sin filas nuevas.");
      }
      qc.invalidateQueries({ queryKey: ["contracts"] });
    } finally {
      setImporting(false);
      if (contractFileRef.current) contractFileRef.current.value = "";
    }
  }

  const statusColors: Record<ContractStatus, string> = {
    ACTIVE: "success", PROLONGATION: "warning", SUSPENDED: "warning",
    FINISHED: "secondary", CANCELLED: "destructive",
  };

  return (
    <>
      <Topbar title="Gestión de Contratos" />
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Contratos</h2>
            <p className="text-sm text-slate-500">{data?.meta.total ?? 0} contratos encontrados</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {session && (
              <Button type="button" variant="outline" className="gap-2" onClick={downloadContractsExport}>
                <FileSpreadsheet className="h-4 w-4" />
                Exportar Excel
              </Button>
            )}
            {canCreate && (
              <>
              <input
                ref={contractFileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => onContractFileSelected(e.target.files?.[0] ?? null)}
              />
              <Button type="button" variant="outline" className="gap-2" onClick={downloadContractTemplate}>
                <Download className="h-4 w-4" />
                Plantilla Excel
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={importing}
                onClick={() => contractFileRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                {importing ? "Importando…" : "Importar Excel"}
              </Button>
              <Link href="/contracts/new">
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Nuevo Contrato
                </Button>
              </Link>
              </>
            )}
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Buscar por licitación o cliente..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <MultiSelect
                options={companyRows.map((c) => ({ value: c.code, label: c.name }))}
                value={companies}
                onChange={setCompanies}
                placeholder="Todas las empresas"
                className="w-52"
              />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.entries(CONTRACT_STATUS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={clientType} onValueChange={setClientType}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.entries(CLIENT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center text-slate-400">Cargando contratos...</div>
            ) : contracts.length === 0 ? (
              <div className="p-12 text-center text-slate-400">No se encontraron contratos</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Licitación</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Cliente</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Empresa</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Tipo</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-600">Facturación</th>
                      <th className="text-right px-2 py-3 font-semibold text-slate-600" title="Mano de obra">
                        M.O.
                      </th>
                      <th className="text-right px-2 py-3 font-semibold text-slate-600" title="Insumos">
                        Insumos
                      </th>
                      <th className="text-right px-2 py-3 font-semibold text-slate-600" title="Gasto administrativo">
                        Adm.
                      </th>
                      <th className="text-right px-2 py-3 font-semibold text-slate-600" title="Utilidad">
                        Util.
                      </th>
                      <th className="text-right px-2 py-3 font-semibold text-slate-600" title="Participación global de la facturación (activos)">
                        P.g. fact.
                      </th>
                      <th className="text-right px-2 py-3 font-semibold text-slate-600" title="Participación global M.O. (activos)">
                        P.g. M.O.
                      </th>
                      <th className="text-right px-2 py-3 font-semibold text-slate-600" title="Participación global insumos (activos)">
                        P.g. ins.
                      </th>
                      <th className="text-right px-2 py-3 font-semibold text-slate-600" title="Participación global adm. (activos)">
                        P.g. adm.
                      </th>
                      <th className="text-right px-2 py-3 font-semibold text-slate-600" title="Participación global utilidad (activos)">
                        P.g. util.
                      </th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Ejecución</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Vencimiento</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Estado</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {contracts.map((c) => {
                      const days = daysUntilExpiry(c.endDate);
                      const expireWarning = days >= 0 && days <= 30;
                      return (
                        <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <Link href={`/contracts/${c.id}`} className="font-medium text-blue-600 hover:underline">
                              {c.licitacionNo}
                            </Link>
                          </td>
                          <td className="px-4 py-3 max-w-48">
                            <div className="truncate font-medium text-slate-800">{c.client}</div>
                            <div className="text-xs text-slate-400">{c.officersCount} oficiales · {c.positionsCount} puestos</div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline">{companyDisplayName(c.company, companyRows)}</Badge>
                          </td>
                          <td className="px-4 py-3 text-slate-500">{CLIENT_TYPE_LABELS[c.clientType]}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(c.monthlyBilling)}</td>
                          <BudgetPartidaCell amount={c.laborBudget ?? 0} pct={c.laborPct ?? 0} />
                          <BudgetPartidaCell amount={c.suppliesBudget ?? 0} pct={c.suppliesBudgetPct ?? 0} />
                          <BudgetPartidaCell amount={c.adminBudget ?? 0} pct={c.adminPct ?? 0} />
                          <BudgetPartidaCell amount={c.profitBudget ?? 0} pct={c.profitPct ?? 0} />
                          {(() => {
                            const active = c.status === "ACTIVE" || c.status === "PROLONGATION";
                            return (
                              <>
                                <GlobalPartidaCell sharePct={c.billingSharePct ?? 0} active={active} />
                                <GlobalPartidaCell sharePct={c.laborSharePct ?? 0} active={active} />
                                <GlobalPartidaCell sharePct={c.suppliesSharePct ?? 0} active={active} />
                                <GlobalPartidaCell sharePct={c.adminSharePct ?? 0} active={active} />
                                <GlobalPartidaCell sharePct={c.profitSharePct ?? 0} active={active} />
                              </>
                            );
                          })()}
                          <td className="px-4 py-3 min-w-32">
                            <TrafficLightBadge light="GREEN" size="sm" />
                          </td>
                          <td className="px-4 py-3">
                            <span className={expireWarning ? "text-red-600 font-medium" : "text-slate-500"}>
                              {formatDate(c.endDate)}
                            </span>
                            {expireWarning && <div className="text-xs text-red-500">{days}d restantes</div>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={statusColors[c.status] as never}>
                              {CONTRACT_STATUS_LABELS[c.status]}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Link href={`/contracts/${c.id}`}>
                              <Button variant="ghost" size="sm">Ver</Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {(() => {
                      const totalBilling = contracts.reduce((s, c) => s + c.monthlyBilling, 0);
                      const totalLabor = contracts.reduce((s, c) => s + (c.laborBudget ?? 0), 0);
                      const totalSupplies = contracts.reduce((s, c) => s + (c.suppliesBudget ?? 0), 0);
                      const totalAdmin = contracts.reduce((s, c) => s + (c.adminBudget ?? 0), 0);
                      const totalProfit = contracts.reduce((s, c) => s + (c.profitBudget ?? 0), 0);
                      const activeRows = contracts.filter((c) => c.status === "ACTIVE" || c.status === "PROLONGATION");
                      const sumGlob = (pick: (c: Contract) => number) =>
                        activeRows.reduce((s, c) => s + pick(c), 0);
                      return (
                        <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-700">
                          <td className="px-4 py-3" colSpan={4}>Total ({contracts.length} contratos)</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(totalBilling)}</td>
                          <td className="px-2 py-3 text-right">{formatCurrency(totalLabor)}</td>
                          <td className="px-2 py-3 text-right">{formatCurrency(totalSupplies)}</td>
                          <td className="px-2 py-3 text-right">{formatCurrency(totalAdmin)}</td>
                          <td className="px-2 py-3 text-right">{formatCurrency(totalProfit)}</td>
                          <td className="px-2 py-3 text-right text-indigo-600" title="Suma de % globales en esta página (activos)">
                            {(sumGlob((c) => c.billingSharePct) * 100).toFixed(2)}%
                          </td>
                          <td className="px-2 py-3 text-right text-indigo-600">
                            {(sumGlob((c) => c.laborSharePct) * 100).toFixed(2)}%
                          </td>
                          <td className="px-2 py-3 text-right text-indigo-600">
                            {(sumGlob((c) => c.suppliesSharePct) * 100).toFixed(2)}%
                          </td>
                          <td className="px-2 py-3 text-right text-indigo-600">
                            {(sumGlob((c) => c.adminSharePct) * 100).toFixed(2)}%
                          </td>
                          <td className="px-2 py-3 text-right text-indigo-600">
                            {(sumGlob((c) => c.profitSharePct) * 100).toFixed(2)}%
                          </td>
                          <td className="px-4 py-3" colSpan={4} />
                        </tr>
                      );
                    })()}
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
