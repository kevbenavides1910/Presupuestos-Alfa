"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { APP_BRANDING_QUERY_KEY, DEFAULT_PRIMARY_HEX, DEFAULT_SIDEBAR_HEX } from "@/lib/branding-constants";

type PublicBranding = {
  primaryHex: string;
  sidebarHex: string;
  hasLogo: boolean;
  updatedAt: string;
};

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: APP_BRANDING_QUERY_KEY,
    queryFn: async (): Promise<PublicBranding> => {
      const r = await fetch("/api/branding");
      const j = (await r.json()) as { data?: PublicBranding; error?: { message?: string } };
      if (!r.ok || !j.data) {
        return {
          primaryHex: DEFAULT_PRIMARY_HEX,
          sidebarHex: DEFAULT_SIDEBAR_HEX,
          hasLogo: false,
          updatedAt: new Date().toISOString(),
        };
      }
      return j.data;
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    const primary = data?.primaryHex ?? DEFAULT_PRIMARY_HEX;
    const sidebar = data?.sidebarHex ?? DEFAULT_SIDEBAR_HEX;
    document.documentElement.style.setProperty("--app-primary", primary);
    document.documentElement.style.setProperty("--app-sidebar", sidebar);
  }, [data?.primaryHex, data?.sidebarHex]);

  return <>{children}</>;
}
