"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { companyDisplayName } from "@/lib/utils/constants";
import type { CompanyRow } from "@/lib/hooks/use-companies";

export type DeferredContractDraft = string[] | "all";

export type DeferredSelectorContract = {
  id: string;
  client: string;
  licitacionNo: string;
  company: string;
};

export function contractIncludedInDeferredDraft(
  draft: DeferredContractDraft,
  contractId: string,
  allActiveIds: string[]
): boolean {
  if (allActiveIds.length === 0) return false;
  if (draft === "all") return true;
  return draft.includes(contractId);
}

/**
 * Permite quedar con 0 contratos en el draft para que el usuario arme su selección
 * manualmente. La validación de "al menos uno" se hace al guardar.
 */
export function toggleDeferredDraft(
  draft: DeferredContractDraft,
  contractId: string,
  allActiveIds: string[]
): DeferredContractDraft {
  if (allActiveIds.length === 0) return draft;
  if (draft === "all") {
    const next = allActiveIds.filter((id) => id !== contractId);
    return next;
  }
  const set = new Set(draft);
  if (set.has(contractId)) {
    set.delete(contractId);
    const arr = allActiveIds.filter((id) => set.has(id));
    if (arr.length === 0) return [];
    if (arr.length === allActiveIds.length) return "all";
    return arr;
  }
  set.add(contractId);
  const arr = allActiveIds.filter((id) => set.has(id));
  if (arr.length === allActiveIds.length) return "all";
  return arr;
}

/** True si el draft tiene al menos un contrato seleccionado. */
export function draftHasSelection(draft: DeferredContractDraft): boolean {
  if (draft === "all") return true;
  return draft.length > 0;
}

/** Normaliza lo que vino del backend (array vacío = todos) a un DeferredContractDraft. */
export function draftFromServer(ids: string[] | null | undefined): DeferredContractDraft {
  if (!ids || ids.length === 0) return "all";
  return [...ids];
}

export function DeferredContractSelector({
  contracts,
  allIds,
  draft,
  onChange,
  companyRows,
  listClassName,
  readOnly = false,
}: {
  contracts: DeferredSelectorContract[];
  allIds: string[];
  draft: DeferredContractDraft;
  onChange: (next: DeferredContractDraft) => void;
  companyRows: CompanyRow[];
  listClassName?: string;
  readOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState<string[]>([]);
  const q = query.trim().toLowerCase();

  // Empresas presentes en los contratos disponibles (para los chips del filtro).
  const availableCompanies = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of contracts) {
      if (!c.company) continue;
      if (!seen.has(c.company)) {
        seen.set(c.company, companyDisplayName(c.company, companyRows) ?? c.company);
      }
    }
    return Array.from(seen.entries())
      .map(([code, label]) => ({ code, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [contracts, companyRows]);

  const filtered = useMemo(() => {
    const activeCompanies = new Set(companyFilter);
    return contracts.filter((c) => {
      if (activeCompanies.size > 0 && !activeCompanies.has(c.company)) return false;
      if (!q) return true;
      const comp = companyDisplayName(c.company, companyRows) ?? "";
      return (
        c.client.toLowerCase().includes(q) ||
        c.licitacionNo.toLowerCase().includes(q) ||
        comp.toLowerCase().includes(q)
      );
    });
  }, [contracts, q, companyRows, companyFilter]);

  const selectedCount = draft === "all" ? allIds.length : draft.length;
  const visibleIds = filtered.map((c) => c.id);
  const allVisibleSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => contractIncludedInDeferredDraft(draft, id, allIds));
  const hasFilter = q.length > 0 || companyFilter.length > 0;

  const toggleCompany = (code: string) => {
    setCompanyFilter((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            className="pl-7 h-8 text-xs"
            placeholder="Buscar por cliente, licitación o empresa…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange("all")}
              className="text-xs font-medium text-blue-700 hover:underline disabled:text-slate-400 disabled:no-underline"
              disabled={draft === "all"}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs font-medium text-blue-700 hover:underline disabled:text-slate-400 disabled:no-underline"
              disabled={draft !== "all" && (draft as string[]).length === 0}
            >
              Ninguno
            </button>
            {hasFilter && visibleIds.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (allVisibleSelected) {
                    const current = draft === "all" ? allIds.slice() : draft.slice();
                    const remaining = current.filter((id) => !visibleIds.includes(id));
                    const sorted = allIds.filter((id) => remaining.includes(id));
                    onChange(sorted.length === allIds.length ? "all" : sorted);
                  } else {
                    const current = new Set(draft === "all" ? allIds : draft);
                    visibleIds.forEach((id) => current.add(id));
                    const sorted = allIds.filter((id) => current.has(id));
                    onChange(sorted.length === allIds.length ? "all" : sorted);
                  }
                }}
                className="text-xs font-medium text-slate-600 hover:underline"
              >
                {allVisibleSelected ? "Quitar visibles" : "Marcar visibles"}
              </button>
            )}
          </div>
        )}
      </div>

      {availableCompanies.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-500 mr-1">Empresas:</span>
          {availableCompanies.map((comp) => {
            const active = companyFilter.includes(comp.code);
            return (
              <button
                key={comp.code}
                type="button"
                onClick={() => toggleCompany(comp.code)}
                className={
                  active
                    ? "px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-600 text-white border border-blue-600"
                    : "px-2 py-0.5 rounded-full text-[11px] font-medium bg-white text-slate-700 border border-slate-300 hover:border-blue-400"
                }
              >
                {comp.label}
              </button>
            );
          })}
          {companyFilter.length > 0 && (
            <button
              type="button"
              onClick={() => setCompanyFilter([])}
              className="text-[11px] text-slate-500 hover:underline ml-1"
            >
              limpiar
            </button>
          )}
        </div>
      )}

      <p
        className={
          selectedCount === 0
            ? "text-[11px] font-medium text-amber-700"
            : "text-[11px] text-slate-500"
        }
      >
        {selectedCount} de {allIds.length} seleccionados
        {selectedCount === 0 && " · seleccione al menos uno para guardar"}
        {hasFilter && ` · ${filtered.length} coinciden con el filtro`}
      </p>
      <div
        className={
          listClassName ??
          "max-h-44 overflow-y-auto space-y-2 rounded-md border border-blue-100 bg-white p-2"
        }
      >
        {contracts.length === 0 ? (
          <p className="text-xs text-slate-500">No hay contratos en estado Activo o Prórroga.</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-slate-500">
            {q
              ? `Sin resultados para “${query}”.`
              : "Ningún contrato coincide con el filtro de empresas."}
          </p>
        ) : (
          filtered.map((c) => {
            const checked = contractIncludedInDeferredDraft(draft, c.id, allIds);
            return (
              <label key={c.id} className="flex items-start gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-slate-300"
                  checked={checked}
                  disabled={readOnly}
                  onChange={() => {
                    if (readOnly) return;
                    onChange(toggleDeferredDraft(draft, c.id, allIds));
                  }}
                />
                <span>
                  <span className="font-medium text-slate-800">{c.client}</span>
                  <span className="text-slate-500">
                    {" "}
                    · {c.licitacionNo} · {companyDisplayName(c.company, companyRows)}
                  </span>
                </span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
