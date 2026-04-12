"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  LayoutDashboard, FileText, BarChart3, TrendingUp, DollarSign, Users, Shield, BookOpen
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contracts", label: "Contratos", icon: FileText },
  { href: "/expenses", label: "Gastos", icon: DollarSign },
  { href: "/reports/annual", label: "Reporte Anual", icon: TrendingUp },
  { href: "/reports", label: "Reporte mensual", icon: BarChart3 },
  { href: "/admin/users", label: "Usuarios", icon: Users },
  { href: "/admin/catalogs", label: "Catálogos", icon: BookOpen },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role;

  return (
    <aside className="w-64 bg-slate-900 text-white flex flex-col min-h-screen">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-700">
        <div className="bg-blue-600 rounded-lg p-2">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="font-bold text-sm leading-tight">Grupo Seguridad CR</div>
          <div className="text-xs text-slate-400">Control de Rentabilidad</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-4 py-4 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href!));
          return (
            <Link
              key={item.href}
              href={item.href!}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-4 py-4 border-t border-slate-700">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">
            {session?.user?.name?.[0]?.toUpperCase() ?? "U"}
          </div>
          <div className="overflow-hidden">
            <div className="text-sm font-medium truncate">{session?.user?.name}</div>
            <div className="text-xs text-slate-400 truncate">{role}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
