"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { APP_BRANDING_QUERY_KEY } from "@/lib/branding-constants";
import { DEFAULT_PRIMARY_HEX, DEFAULT_SIDEBAR_HEX } from "@/lib/branding-constants";
import { Upload, Trash2, Save, ImageIcon } from "lucide-react";

type AdminBranding = {
  primaryHex: string;
  sidebarHex: string;
  hasLogo: boolean;
  updatedAt: string;
};

export function BrandingAppearanceTab({ readOnly }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const [primaryHex, setPrimaryHex] = useState(DEFAULT_PRIMARY_HEX);
  const [sidebarHex, setSidebarHex] = useState(DEFAULT_SIDEBAR_HEX);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-branding"],
    queryFn: async (): Promise<AdminBranding> => {
      const r = await fetch("/api/admin/branding", { credentials: "same-origin" });
      const j = (await r.json()) as { data?: AdminBranding; error?: { message?: string } };
      if (!r.ok) throw new Error(j.error?.message ?? `Error ${r.status}`);
      if (!j.data) throw new Error("Sin datos");
      return j.data;
    },
    enabled: !readOnly,
  });

  useEffect(() => {
    if (data) {
      setPrimaryHex(data.primaryHex);
      setSidebarHex(data.sidebarHex);
    }
  }, [data]);

  const saveColorsMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/admin/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ primaryHex, sidebarHex }),
      });
      const j = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) throw new Error(j.error?.message ?? "Error al guardar colores");
      return j;
    },
    onSuccess: () => {
      toast.success("Colores actualizados");
      qc.invalidateQueries({ queryKey: ["admin-branding"] });
      qc.invalidateQueries({ queryKey: APP_BRANDING_QUERY_KEY });
      refetch();
    },
    onError: (e: Error) => toast.error(e.message || "Error al guardar"),
  });

  const clearLogoMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/admin/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ clearLogo: true }),
      });
      const j = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) throw new Error(j.error?.message ?? "Error al quitar logo");
      return j;
    },
    onSuccess: () => {
      toast.success("Logo eliminado");
      qc.invalidateQueries({ queryKey: ["admin-branding"] });
      qc.invalidateQueries({ queryKey: APP_BRANDING_QUERY_KEY });
      refetch();
    },
    onError: (e: Error) => toast.error(e.message || "Error"),
  });

  async function onLogoSelected(file: File | null) {
    if (!file || readOnly) return;
    const fd = new FormData();
    fd.set("file", file);
    const r = await fetch("/api/admin/branding/logo", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
    });
    const j = (await r.json()) as { error?: { message?: string } };
    if (!r.ok) {
      toast.error(j.error?.message ?? "Error al subir logo");
      return;
    }
    toast.success("Logo actualizado");
    qc.invalidateQueries({ queryKey: ["admin-branding"] });
    qc.invalidateQueries({ queryKey: APP_BRANDING_QUERY_KEY });
    refetch();
  }

  if (readOnly) {
    return <p className="text-sm text-slate-500">Solo administradores pueden cambiar el logo y los colores.</p>;
  }

  if (isLoading) return <div className="p-8 text-center text-slate-400">Cargando…</div>;

  const logoSrc = data?.hasLogo ? `/api/branding/logo?${encodeURIComponent(data.updatedAt)}` : null;

  return (
    <div className="space-y-6 max-w-xl">
      <p className="text-sm text-slate-600">
        Personalice el logo (barra lateral e inicio de sesión) y los colores principales de la interfaz.
      </p>

      <div className="space-y-3 rounded-lg border p-4 bg-slate-50/60">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <ImageIcon className="h-4 w-4" /> Logo
        </h3>
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-16 w-40 rounded-md border bg-white flex items-center justify-center overflow-hidden shrink-0">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} alt="Logo" className="max-h-14 max-w-[9.5rem] object-contain" />
            ) : (
              <span className="text-xs text-slate-400">Sin logo (ícono por defecto)</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              id="branding-logo-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                onLogoSelected(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => document.getElementById("branding-logo-input")?.click()}
            >
              <Upload className="h-3.5 w-3.5" /> Subir imagen
            </Button>
            {data?.hasLogo ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1 text-red-600"
                disabled={clearLogoMutation.isPending}
                onClick={() => clearLogoMutation.mutate()}
              >
                <Trash2 className="h-3.5 w-3.5" /> Quitar logo
              </Button>
            ) : null}
          </div>
        </div>
        <p className="text-xs text-slate-500">PNG, JPEG o WebP. Máximo 2 MB.</p>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <h3 className="text-sm font-semibold text-slate-800">Colores</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Color principal</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryHex.length === 7 ? primaryHex : DEFAULT_PRIMARY_HEX}
                onChange={(e) => setPrimaryHex(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded border bg-white p-0.5"
              />
              <input
                type="text"
                value={primaryHex}
                onChange={(e) => setPrimaryHex(e.target.value)}
                className="h-9 flex-1 rounded border px-2 font-mono text-sm"
                spellCheck={false}
              />
            </div>
            <p className="text-xs text-slate-500">Botones y elemento activo del menú.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Fondo del menú lateral</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={sidebarHex.length === 7 ? sidebarHex : DEFAULT_SIDEBAR_HEX}
                onChange={(e) => setSidebarHex(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded border bg-white p-0.5"
              />
              <input
                type="text"
                value={sidebarHex}
                onChange={(e) => setSidebarHex(e.target.value)}
                className="h-9 flex-1 rounded border px-2 font-mono text-sm"
                spellCheck={false}
              />
            </div>
            <p className="text-xs text-slate-500">Fondo de la barra lateral.</p>
          </div>
        </div>
        <Button
          type="button"
          onClick={() => saveColorsMutation.mutate()}
          disabled={saveColorsMutation.isPending}
          className="gap-1.5"
        >
          <Save className="h-4 w-4" />
          {saveColorsMutation.isPending ? "Guardando…" : "Guardar colores"}
        </Button>
      </div>
    </div>
  );
}
