"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail, Save } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isAdmin } from "@/lib/permissions";
import { toast } from "@/components/ui/toaster";

type ConfigForm = {
  mailProvider: "CUSTOM_SMTP" | "OUTLOOK" | "GMAIL";
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  /** Varias direcciones separadas por coma o punto y coma. */
  emailFixedCc: string;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
};

export default function DisciplinarioAjustesConfiguracionPage() {
  const { data: session } = useSession();
  const readOnly = !session?.user?.role || !isAdmin(session.user.role);
  const [form, setForm] = useState<ConfigForm>({
    mailProvider: "CUSTOM_SMTP",
    smtpHost: "",
    smtpPort: "587",
    smtpSecure: false,
    smtpUser: "",
    smtpPass: "",
    smtpFrom: "",
    emailFixedCc: "",
    emailSubjectTemplate: "",
    emailBodyTemplate: "",
  });
  const [testTo, setTestTo] = useState("");

  const q = useQuery({
    queryKey: ["disciplinary-settings-config"],
    queryFn: async (): Promise<Record<string, unknown>> => {
      const r = await fetch("/api/admin/disciplinary/settings", { credentials: "same-origin" });
      const j = (await r.json()) as { data?: Record<string, unknown>; error?: { message?: string } };
      if (!r.ok || !j.data) throw new Error(j.error?.message ?? "Error al cargar ajustes");
      return j.data;
    },
    enabled: !readOnly,
  });

  useEffect(() => {
    const u = session?.user?.email?.trim();
    if (u) setTestTo((prev) => prev || u);
  }, [session?.user?.email]);

  useEffect(() => {
    if (!q.data) return;
    const d = q.data as Record<string, unknown>;
    setForm({
      mailProvider: ((d.mailProvider as string) || "CUSTOM_SMTP") as ConfigForm["mailProvider"],
      smtpHost: (d.smtpHost as string) || "",
      smtpPort: d.smtpPort !== null && d.smtpPort !== undefined ? String(d.smtpPort) : "587",
      smtpSecure: Boolean(d.smtpSecure),
      smtpUser: (d.smtpUser as string) || "",
      smtpPass: "",
      smtpFrom: (d.smtpFrom as string) || "",
      emailFixedCc: (d.emailFixedCc as string) || "",
      emailSubjectTemplate: (d.emailSubjectTemplate as string) || "",
      emailBodyTemplate: (d.emailBodyTemplate as string) || "",
    });
  }, [q.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        mailProvider: form.mailProvider,
        smtpHost: form.smtpHost || null,
        smtpPort: Number(form.smtpPort || 0) || null,
        smtpSecure: form.smtpSecure,
        smtpUser: form.smtpUser || null,
        smtpPass: form.smtpPass || undefined,
        smtpFrom: form.smtpFrom || null,
        emailFixedCc: form.emailFixedCc.trim() || null,
        emailSubjectTemplate: form.emailSubjectTemplate,
        emailBodyTemplate: form.emailBodyTemplate,
      };
      const r = await fetch("/api/admin/disciplinary/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const j = (await r.json()) as { error?: { message?: string } };
      if (!r.ok) throw new Error(j.error?.message ?? "No se pudo guardar");
    },
    onSuccess: () => {
      toast.success("Configuración de correo actualizada");
      setForm((s) => ({ ...s, smtpPass: "" }));
      q.refetch();
    },
    onError: (e: Error) => toast.error(e.message || "Error al guardar"),
  });

  const testMutation = useMutation({
    mutationFn: async (): Promise<{ sentTo: string; cc: string | null }> => {
      const port = Number(form.smtpPort || 0) || null;
      const body: Record<string, unknown> = {
        to: testTo.trim(),
        mailProvider: form.mailProvider,
        smtpHost: form.smtpHost.trim() || null,
        smtpPort: port,
        smtpSecure: form.smtpSecure,
        smtpUser: form.smtpUser.trim() || null,
        smtpFrom: form.smtpFrom.trim() || null,
        emailFixedCc: form.emailFixedCc,
      };
      if (form.smtpPass.trim()) body.smtpPass = form.smtpPass.trim();
      const r = await fetch("/api/admin/disciplinary/settings/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as {
        data?: { sentTo?: string; cc?: string | null };
        error?: { message?: string };
      };
      if (!r.ok) throw new Error(j.error?.message ?? "Error al enviar prueba");
      return {
        sentTo: j.data?.sentTo ?? testTo.trim(),
        cc: j.data?.cc ?? null,
      };
    },
    onSuccess: (data) => {
      toast.success(
        data.cc
          ? `Prueba enviada a ${data.sentTo} (CC: ${data.cc})`
          : `Correo de prueba enviado a ${data.sentTo}`,
      );
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo enviar"),
  });

  return (
    <>
      <Topbar title="Disciplinario · Ajustes · Configuración" />
      <div className="p-6 space-y-6 max-w-4xl">
        <p className="text-sm text-slate-600">
          Configure el correo de salida para apercibimientos: SMTP personalizado o presets para
          Outlook/Gmail. También puede editar plantilla de asunto y cuerpo del correo.
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Salida de correo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Proveedor</label>
                <select
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.mailProvider}
                  onChange={(e) => setForm((s) => ({ ...s, mailProvider: e.target.value as ConfigForm["mailProvider"] }))}
                  disabled={readOnly}
                >
                  <option value="CUSTOM_SMTP">SMTP personalizado</option>
                  <option value="OUTLOOK">Outlook (smtp.office365.com)</option>
                  <option value="GMAIL">Gmail (smtp.gmail.com)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Correo remitente (From)</label>
                <input className="w-full rounded border px-3 py-2 text-sm" value={form.smtpFrom} onChange={(e) => setForm((s) => ({ ...s, smtpFrom: e.target.value }))} disabled={readOnly} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Host SMTP</label>
                <input className="w-full rounded border px-3 py-2 text-sm" value={form.smtpHost} onChange={(e) => setForm((s) => ({ ...s, smtpHost: e.target.value }))} disabled={readOnly} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Puerto SMTP</label>
                <input className="w-full rounded border px-3 py-2 text-sm" value={form.smtpPort} onChange={(e) => setForm((s) => ({ ...s, smtpPort: e.target.value }))} disabled={readOnly} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Usuario SMTP</label>
                <input className="w-full rounded border px-3 py-2 text-sm" value={form.smtpUser} onChange={(e) => setForm((s) => ({ ...s, smtpUser: e.target.value }))} disabled={readOnly} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Contraseña SMTP</label>
                <input type="password" placeholder="Dejar en blanco para conservar" className="w-full rounded border px-3 py-2 text-sm" value={form.smtpPass} onChange={(e) => setForm((s) => ({ ...s, smtpPass: e.target.value }))} disabled={readOnly} />
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.smtpSecure} onChange={(e) => setForm((s) => ({ ...s, smtpSecure: e.target.checked }))} disabled={readOnly} />
              Usar conexión segura (SSL/TLS)
            </label>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Copia fija (CC)</label>
              <textarea
                className="w-full rounded border px-3 py-2 text-sm min-h-[4.5rem]"
                value={form.emailFixedCc}
                onChange={(e) => setForm((s) => ({ ...s, emailFixedCc: e.target.value }))}
                disabled={readOnly}
                placeholder="ej. rrhh@empresa.com; control@empresa.com"
              />
              <p className="text-xs text-slate-500">
                Siempre se añade en copia en cada envío de apercibimiento, además del administrador de zona (si
                está definido en el catálogo). El destinatario principal sigue siendo el correo del empleado en el
                maestro. Varias direcciones: separar con coma o punto y coma.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 space-y-3">
              <p className="text-sm font-medium text-slate-800">Probar envío</p>
              <p className="text-xs text-slate-600">
                Usa los valores del formulario (incluida una contraseña nueva sin guardar). Si la deja en blanco, se usa la guardada en el servidor.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="space-y-1.5 flex-1">
                  <label className="text-sm font-medium text-slate-700">Enviar prueba a</label>
                  <input
                    type="email"
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    disabled={readOnly}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 shrink-0"
                  disabled={readOnly || testMutation.isPending || !testTo.trim()}
                  onClick={() => testMutation.mutate()}
                >
                  <Mail className="h-4 w-4" />
                  {testMutation.isPending ? "Enviando…" : "Probar envío"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plantilla de correo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Asunto</label>
              <input className="w-full rounded border px-3 py-2 text-sm" value={form.emailSubjectTemplate} onChange={(e) => setForm((s) => ({ ...s, emailSubjectTemplate: e.target.value }))} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Cuerpo</label>
              <textarea className="w-full rounded border px-3 py-2 text-sm min-h-36" value={form.emailBodyTemplate} onChange={(e) => setForm((s) => ({ ...s, emailBodyTemplate: e.target.value }))} disabled={readOnly} />
              <p className="text-xs text-slate-500">Variables: {`{{numero}} {{nombre}} {{codigo}} {{omisiones_count}} {{zona}} {{administrador}}`}</p>
            </div>
            <Button type="button" onClick={() => saveMutation.mutate()} disabled={readOnly || saveMutation.isPending || q.isLoading} className="gap-2">
              <Save className="h-4 w-4" />
              {saveMutation.isPending ? "Guardando..." : "Guardar configuración"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
