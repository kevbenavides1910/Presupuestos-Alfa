"use client";

import { useState, Suspense, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Shield, Loader2 } from "lucide-react";
import { APP_BRANDING_QUERY_KEY, DEFAULT_PRIMARY_HEX, DEFAULT_SIDEBAR_HEX } from "@/lib/branding-constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function messageForNextAuthError(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "CredentialsSignin":
      return "Email o contraseña incorrectos";
    case "Configuration":
      return "Error de configuración del servidor (revise NEXTAUTH_SECRET y NEXTAUTH_URL en .env).";
    case "AccessDenied":
      return "Acceso denegado.";
    default:
      return `No se pudo iniciar sesión (${code}). Si usa otro puerto que 3000, ponga en .env la misma URL que en el navegador, por ejemplo NEXTAUTH_URL=http://localhost:3002`;
  }
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { data: brand } = useQuery({
    queryKey: APP_BRANDING_QUERY_KEY,
    queryFn: async () => {
      const r = await fetch("/api/branding");
      const j = (await r.json()) as {
        data?: { hasLogo: boolean; updatedAt: string; primaryHex: string; sidebarHex: string };
      };
      if (!r.ok || !j.data) {
        return { hasLogo: false, updatedAt: "", primaryHex: DEFAULT_PRIMARY_HEX, sidebarHex: DEFAULT_SIDEBAR_HEX };
      }
      return j.data;
    },
    staleTime: 30_000,
  });

  const urlError = searchParams.get("error");

  useEffect(() => {
    const msg = messageForNextAuthError(urlError);
    if (msg) setError(msg);
  }, [urlError]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Redirección completa (redirect por defecto): en App Router evita entrar al dashboard sin sesión en el servidor.
      const result = await signIn("credentials", {
        email,
        password,
        callbackUrl: "/dashboard",
        redirect: false,
      });

      if (result?.error) {
        setError(messageForNextAuthError(result.error) ?? "No se pudo iniciar sesión");
        return;
      }

      // NextAuth a veces omite `ok` en éxito; basta con no tener `error`.
      if (result === undefined) {
        setError("No hubo respuesta del servidor de autenticación.");
        return;
      }

      function sameOriginPath(url: string | null | undefined): string {
        if (!url) return "/dashboard";
        try {
          const u = new URL(url, window.location.origin);
          if (u.origin === window.location.origin) return `${u.pathname}${u.search}${u.hash}` || "/dashboard";
        } catch {
          /* ignore */
        }
        return url.startsWith("/") ? url : "/dashboard";
      }

      window.location.assign(sameOriginPath(result.url));
    } catch {
      setError("Error de red o del servidor. Intente de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  const primary = brand?.primaryHex ?? DEFAULT_PRIMARY_HEX;
  const sidebar = brand?.sidebarHex ?? DEFAULT_SIDEBAR_HEX;
  const logoSrc =
    brand?.hasLogo && brand.updatedAt ? `/api/branding/logo?${encodeURIComponent(brand.updatedAt)}` : null;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: `linear-gradient(to bottom right, ${sidebar}, ${primary})`,
      }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 overflow-hidden shadow-lg"
            style={{ backgroundColor: primary }}
          >
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} alt="Logo" className="max-h-14 max-w-14 object-contain" />
            ) : (
              <Shield className="h-8 w-8 text-white" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-white">Syntra</h1>
          <p className="text-slate-400 mt-1">Control de Rentabilidad de Contratos</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Iniciar Sesión</CardTitle>
            <CardDescription>Ingrese sus credenciales para acceder al sistema</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Correo Electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="usuario@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Ingresando...
                  </>
                ) : (
                  "Iniciar Sesión"
                )}
              </Button>
            </form>

            <div className="mt-6 p-3 bg-slate-50 rounded text-xs text-slate-500 space-y-1">
              <div className="font-semibold text-slate-700 mb-2">Credenciales de prueba:</div>
              <div>Admin: admin@seguridadgrupocr.com / admin123</div>
              <div>Supervisor: supervisor@seguridadgrupocr.com / supervisor123</div>
              <p className="text-slate-400 pt-2 border-t mt-2">
                Use siempre la misma URL en el navegador que en <code className="text-slate-600">NEXTAUTH_URL</code> (mismo
                puerto; no mezcle <code className="text-slate-600">localhost</code> con <code className="text-slate-600">127.0.0.1</code>).
                Si falta <code className="text-slate-600">NEXTAUTH_SECRET</code> en desarrollo, la app usa un valor fijo solo
                para pruebas locales.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-900 flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-white animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
