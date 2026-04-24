"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ImagePlus, Save, Trash2 } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isAdmin } from "@/lib/permissions";
import { toast } from "@/components/ui/toaster";

type Settings = {
  documentTitle: string;
  documentIntroTemplate: string;
  documentLegalText: string;
  documentFooter: string;
  documentFormCode: string;
  documentFormRevision: string;
  documentFormVersion: string;
  documentFormSubtitle: string;
  documentSignaturePath: string | null;
};

export default function DisciplinarioAjustesDocumentoPage() {
  const { data: session } = useSession();
  const readOnly = !session?.user?.role || !isAdmin(session.user.role);
  const sigFileRef = useRef<HTMLInputElement>(null);
  const [signatureCacheBust, setSignatureCacheBust] = useState(0);
  const [form, setForm] = useState<Settings>({
    documentTitle: "",
    documentIntroTemplate: "",
    documentLegalText: "",
    documentFooter: "",
    documentFormCode: "",
    documentFormRevision: "",
    documentFormVersion: "",
    documentFormSubtitle: "",
    documentSignaturePath: null,
  });

  const q = useQuery({
    queryKey: ["disciplinary-settings-document"],
    queryFn: async (): Promise<Settings> => {
      const r = await fetch("/api/admin/disciplinary/settings", { credentials: "same-origin" });
      const j = (await r.json()) as { data?: Settings; error?: { message?: string } };
      if (!r.ok || !j.data) throw new Error(j.error?.message ?? "Error al cargar ajustes");
      return j.data;
    },
    enabled: !readOnly,
  });

  useEffect(() => {
    if (q.data) {
      setForm({
        documentTitle: q.data.documentTitle ?? "",
        documentIntroTemplate: q.data.documentIntroTemplate ?? "",
        documentLegalText: q.data.documentLegalText ?? "",
        documentFooter: q.data.documentFooter ?? "",
        documentFormCode: q.data.documentFormCode ?? "",
        documentFormRevision: q.data.documentFormRevision ?? "",
        documentFormVersion: q.data.documentFormVersion ?? "",
        documentFormSubtitle: q.data.documentFormSubtitle ?? "",
        documentSignaturePath: q.data.documentSignaturePath ?? null,
      });
    }
  }, [q.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/admin/disciplinary/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(form),
      });
      const j = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) throw new Error(j.error?.message ?? "Error al guardar");
    },
    onSuccess: () => {
      toast.success("Documento disciplinario actualizado");
      q.refetch();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar"),
  });

  const uploadSignatureMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/admin/disciplinary/signature", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const j = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) throw new Error(j.error?.message ?? "Error al subir firma");
    },
    onSuccess: () => {
      toast.success("Firma guardada; aparecerá en los PDF de apercibimiento");
      setSignatureCacheBust((k) => k + 1);
      q.refetch();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo subir la imagen"),
  });

  const clearSignatureMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/admin/disciplinary/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ clearDocumentSignature: true }),
      });
      const j = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) throw new Error(j.error?.message ?? "Error al quitar firma");
    },
    onSuccess: () => {
      toast.success("Firma eliminada del documento");
      setSignatureCacheBust((k) => k + 1);
      q.refetch();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo quitar la firma"),
  });

  const hasSignature = Boolean(form.documentSignaturePath?.trim());

  return (
    <>
      <Topbar title="Disciplinario · Ajustes · Documento" />
      <div className="p-6 space-y-6 max-w-4xl">
        <p className="text-sm text-slate-600">
          El PDF de apercibimiento usa cabecera tipo formulario (como F-RH del escritorio): logo de{" "}
          <strong>Mantenimientos → Marca y colores</strong>, texto legal, pie y datos del encabezado
          (código de formulario, revisión, versión, subtítulo en azul).
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Encabezado del PDF</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-slate-700">Subtítulo (centro, azul)</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.documentFormSubtitle}
                onChange={(e) => setForm((s) => ({ ...s, documentFormSubtitle: e.target.value }))}
                disabled={readOnly}
                placeholder="Apercibimiento por omisión de marca"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Código de formulario</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm font-mono"
                value={form.documentFormCode}
                onChange={(e) => setForm((s) => ({ ...s, documentFormCode: e.target.value }))}
                disabled={readOnly}
                placeholder="F-RH-30"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Versión</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.documentFormVersion}
                onChange={(e) => setForm((s) => ({ ...s, documentFormVersion: e.target.value }))}
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-slate-700">Modificación (texto)</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.documentFormRevision}
                onChange={(e) => setForm((s) => ({ ...s, documentFormRevision: e.target.value }))}
                disabled={readOnly}
                placeholder="05/07/2021"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Párrafo tras «Estimado(a) Señor(a):»</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-600">
              Texto del cuerpo que sigue al saludo (antes de código de empleado y omisiones). Puede usar
              variables:{" "}
              <code className="text-[11px] bg-slate-100 px-1 rounded">
                {"{{numero}} {{fecha_emision}} {{omisiones_count}} {{nombre}} {{codigo}} {{cedula}}"}
              </code>
              . El número en vista previa es distinto al consecutivo real (se asigna al confirmar importación).
            </p>
            <textarea
              className="w-full rounded border px-3 py-2 text-sm min-h-32"
              value={form.documentIntroTemplate}
              onChange={(e) => setForm((s) => ({ ...s, documentIntroTemplate: e.target.value }))}
              disabled={readOnly}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Firma fija en el PDF</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              Imagen que se imprime encima de «Firma y sello» en todos los apercibimientos (vista previa,
              descarga y correos). Solo PNG o JPEG (requerido para el PDF). Fondo transparente o blanco. Ancho
              recomendado ~400–800 px.
            </p>
            {hasSignature && (
              <div className="rounded border bg-white p-4 inline-block max-w-full">
                <img
                  src={`/api/admin/disciplinary/signature?k=${signatureCacheBust}`}
                  alt="Vista previa de la firma configurada"
                  className="max-h-24 w-auto object-contain"
                />
              </div>
            )}
            <input
              ref={sigFileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              disabled={readOnly || uploadSignatureMutation.isPending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) uploadSignatureMutation.mutate(f);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={readOnly || uploadSignatureMutation.isPending}
                onClick={() => sigFileRef.current?.click()}
              >
                <ImagePlus className="h-4 w-4" />
                {hasSignature ? "Cambiar imagen de firma" : "Subir imagen de firma"}
              </Button>
              {hasSignature && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-destructive hover:text-destructive"
                  disabled={readOnly || clearSignatureMutation.isPending}
                  onClick={() => clearSignatureMutation.mutate()}
                >
                  <Trash2 className="h-4 w-4" />
                  Quitar firma
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cuerpo y pie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Título interno (referencia)</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={form.documentTitle}
                onChange={(e) => setForm((s) => ({ ...s, documentTitle: e.target.value }))}
                disabled={readOnly}
              />
              <p className="text-xs text-slate-500">
                El PDF formal usa el subtítulo azul de arriba; este campo queda como respaldo si el subtítulo
                está vacío.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Texto legal (párrafo antes de «Atentamente»)</label>
              <textarea
                className="w-full rounded border px-3 py-2 text-sm min-h-28"
                value={form.documentLegalText}
                onChange={(e) => setForm((s) => ({ ...s, documentLegalText: e.target.value }))}
                disabled={readOnly}
              />
              <p className="text-xs text-slate-500">Puede usar párrafos separados con una línea en blanco.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Pie de documento</label>
              <textarea
                className="w-full rounded border px-3 py-2 text-sm min-h-20"
                value={form.documentFooter}
                onChange={(e) => setForm((s) => ({ ...s, documentFooter: e.target.value }))}
                disabled={readOnly}
              />
            </div>
            <Button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={readOnly || saveMutation.isPending || q.isLoading}
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              {saveMutation.isPending ? "Guardando..." : "Guardar documento"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
