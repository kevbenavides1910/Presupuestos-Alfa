"use client";

import { useQuery } from "@tanstack/react-query";

export type CompanyRow = { code: string; name: string; isActive: boolean };

export function useCompanies() {
  return useQuery<{ data: CompanyRow[] }>({
    queryKey: ["companies-catalog"],
    queryFn: async () => {
      const r = await fetch("/api/companies");
      if (!r.ok) throw new Error("No se pudo cargar empresas");
      return r.json();
    },
    staleTime: 60_000,
  });
}
