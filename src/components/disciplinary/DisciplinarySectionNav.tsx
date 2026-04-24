"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

type Tab = {
  href: string;
  label: string;
  /** Si no se define: activo si pathname === href o pathname.startsWith(href + "/") */
  isActive?: (pathname: string) => boolean;
};

const PRIMARY_TABS: Tab[] = [
  { href: "/disciplinario/importar", label: "Importación" },
  {
    href: "/disciplinario",
    label: "Historial",
    isActive: (p) => p === "/disciplinario",
  },
  { href: "/disciplinario/empleados", label: "Tratamiento" },
  { href: "/disciplinario/convocatoria", label: "Solicitud de convocatoria" },
  { href: "/disciplinario/dashboard", label: "Dashboard" },
  { href: "/disciplinario/reportes/omisiones", label: "Reporte de omisiones" },
  {
    href: "/disciplinario/ajustes/bases",
    label: "Ajustes",
    isActive: (p) => p.startsWith("/disciplinario/ajustes"),
  },
];

const AJUSTES_TABS: Tab[] = [
  { href: "/disciplinario/ajustes/bases", label: "Bases de datos" },
  { href: "/disciplinario/ajustes/documento", label: "Documento" },
  { href: "/disciplinario/ajustes/configuracion", label: "Configuración" },
];

function tabActive(tab: Tab, pathname: string): boolean {
  if (tab.isActive) return tab.isActive(pathname);
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

export function DisciplinarySectionNav() {
  const pathname = usePathname() ?? "";
  const inAjustes = pathname.startsWith("/disciplinario/ajustes");

  return (
    <div className="border-b border-slate-200 bg-[#1a3a5c] text-white">
      <div className="px-4 py-2 text-xs font-medium text-slate-200 border-b border-white/10">
        Apercibimientos por omisiones de marca — misma estructura que la app de escritorio
      </div>
      <div className="flex flex-wrap gap-1 px-2 py-2 overflow-x-auto">
        {PRIMARY_TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors",
              tabActive(tab, pathname)
                ? "bg-white text-[#1a3a5c] shadow-sm"
                : "text-slate-200 hover:bg-white/10 hover:text-white",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      {inAjustes && (
        <div className="flex flex-wrap gap-1 px-2 pb-2 pt-0 border-t border-white/10">
          {AJUSTES_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "px-3 py-1 rounded text-xs font-medium whitespace-nowrap",
                tabActive(tab, pathname)
                  ? "bg-amber-400/90 text-[#1a3a5c]"
                  : "text-slate-300 hover:text-white hover:underline",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
