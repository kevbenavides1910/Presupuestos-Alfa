"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { Plus, Pencil, UserX, UserCheck, KeyRound, X } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { COMPANIES, COMPANY_LABELS, USER_ROLE_LABELS } from "@/lib/utils/constants";
import { isAdmin } from "@/lib/permissions";
import type { CompanyName, UserRole } from "@prisma/client";

const ROLE_COLORS: Record<UserRole, string> = {
  ADMIN: "destructive",
  SUPERVISOR: "warning",
  COMPRAS: "default",
  COMMERCIAL: "outline",
  CONSULTA: "secondary",
};

interface User {
  id: string; name: string; email: string; role: UserRole;
  company: CompanyName | null; isActive: boolean; createdAt: string;
}

interface UserForm {
  name: string; email: string; password: string;
  role: UserRole; company: string;
}

const emptyForm: UserForm = { name: "", email: "", password: "", role: "CONSULTA", company: "" };

/** Evita «Unexpected end of JSON input» si el cuerpo viene vacío o no es JSON. */
async function parseJsonRes<T>(r: Response): Promise<T> {
  const text = await r.text();
  const trimmed = text.trim();

  if (!trimmed) {
    if (!r.ok) {
      throw new Error(`Error ${r.status}: respuesta vacía del servidor`);
    }
    throw new Error(
      "El servidor devolvió una respuesta vacía. Revisá la consola del servidor y la conexión a la base de datos."
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    const preview = trimmed.slice(0, 120);
    throw new Error(
      !r.ok
        ? `Error ${r.status} (${preview}${trimmed.length > 120 ? "…" : ""})`
        : "La respuesta del servidor no es JSON válido."
    );
  }

  const body = json as T & { error?: { message?: string } };
  if (!r.ok) {
    const msg =
      typeof (body as { error?: unknown }).error === "string"
        ? ((body as { error: string }).error)
        : body?.error?.message ?? `Error ${r.status}`;
    throw new Error(msg);
  }
  return body as T;
}

function sortUsersList(list: User[]): User[] {
  return [...list].sort((a, b) => {
    const byRole = a.role.localeCompare(b.role);
    if (byRole !== 0) return byRole;
    return a.name.localeCompare(b.name);
  });
}

export default function UsersPage() {
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [changePwd, setChangePwd] = useState(false);

  const userIsAdmin = session?.user?.role ? isAdmin(session.user.role) : false;

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<{ data: User[] }>({
    queryKey: ["users"],
    queryFn: async () => {
      const r = await fetch("/api/users", { credentials: "same-origin" });
      return parseJsonRes<{ data: User[] }>(r);
    },
    enabled: status === "authenticated" && userIsAdmin,
  });

  const createMutation = useMutation({
    mutationFn: async (body: UserForm) => {
      const r = await fetch("/api/users", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonRes<{ data: User }>(r);
    },
    onSuccess: (res) => {
      const created = res.data;
      queryClient.setQueryData<{ data: User[] }>(["users"], (old) => {
        const prev = old?.data ?? [];
        const next = sortUsersList([...prev.filter((u) => u.id !== created.id), created]);
        return { data: next };
      });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Usuario creado");
      closeModal();
    },
    onError: (e: Error) => toast.error(e.message || "Error al crear usuario"),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Partial<UserForm> }) => {
      const r = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonRes<{ data: User }>(r);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Usuario actualizado");
      closeModal();
    },
    onError: (e: Error) => toast.error(e.message || "Error al actualizar usuario"),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const r = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      return parseJsonRes<{ data: User }>(r);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Usuario actualizado");
    },
    onError: (e: Error) => toast.error(e.message || "Error"),
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setChangePwd(false);
    setShowModal(true);
  }

  function openEdit(u: User) {
    setEditing(u);
    setForm({ name: u.name, email: u.email, password: "", role: u.role, company: u.company ?? "" });
    setChangePwd(false);
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); }

  function submit() {
    if (editing) {
      const body: Record<string, unknown> = { name: form.name, role: form.role, company: form.company || null };
      if (changePwd && form.password) body.password = form.password;
      updateMutation.mutate({ id: editing.id, body: body as never });
    } else {
      createMutation.mutate(form);
    }
  }

  const users = data?.data ?? [];
  const active = users.filter((u) => u.isActive);
  const inactive = users.filter((u) => !u.isActive);

  if (status === "loading") {
    return (
      <>
        <Topbar title="Gestión de Usuarios" />
        <div className="p-12 text-center text-slate-400">Cargando sesión…</div>
      </>
    );
  }

  if (!userIsAdmin) {
    return (
      <>
        <Topbar title="Gestión de Usuarios" />
        <div className="p-6">
          <Card>
            <CardContent className="p-8 text-center text-slate-600">
              Solo los administradores pueden crear o editar usuarios. Si necesitás cambios, contactá a un administrador.
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Gestión de Usuarios" />
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Usuarios</h2>
            <p className="text-sm text-slate-500">{active.length} activos · {inactive.length} inactivos</p>
          </div>
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nuevo Usuario
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center text-slate-400">Cargando...</div>
            ) : isError ? (
              <div className="p-12 text-center space-y-3">
                <p className="text-red-600">{error instanceof Error ? error.message : "No se pudieron cargar los usuarios"}</p>
                <Button type="button" variant="outline" onClick={() => refetch()}>
                  Reintentar
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Nombre</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Email</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Rol</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Empresa</th>
                      <th className="text-left px-4 py-3 font-semibold text-slate-600">Estado</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.map((u) => (
                      <tr key={u.id} className={`hover:bg-slate-50 transition-colors ${!u.isActive ? "opacity-50" : ""}`}>
                        <td className="px-4 py-3 font-medium text-slate-800">{u.name}</td>
                        <td className="px-4 py-3 text-slate-500">{u.email}</td>
                        <td className="px-4 py-3">
                          <Badge variant={ROLE_COLORS[u.role] as never}>{USER_ROLE_LABELS[u.role]}</Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {u.company ? COMPANY_LABELS[u.company] : <span className="text-slate-300">Todas</span>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={u.isActive ? "success" : "secondary"}>
                            {u.isActive ? "Activo" : "Inactivo"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              className={u.isActive ? "text-red-500 hover:text-red-700" : "text-green-600 hover:text-green-800"}
                              onClick={() => toggleMutation.mutate({ id: u.id, isActive: !u.isActive })}
                            >
                              {u.isActive ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">{editing ? "Editar Usuario" : "Nuevo Usuario"}</h3>
              <button onClick={closeModal}><X className="h-5 w-5 text-slate-400 hover:text-slate-700" /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Nombre</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Juan Pérez" />
              </div>

              {!editing && (
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Email</label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="usuario@empresa.com" />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Rol</label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as UserRole })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(USER_ROLE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Empresa (opcional)</label>
                  <Select value={form.company || "ALL"} onValueChange={(v) => setForm({ ...form, company: v === "ALL" ? "" : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Todas</SelectItem>
                      {COMPANIES.map((c) => <SelectItem key={c} value={c}>{COMPANY_LABELS[c]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Password */}
              {!editing ? (
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Contraseña</label>
                  <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 6 caracteres" />
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={() => setChangePwd(!changePwd)}
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    {changePwd ? "Cancelar cambio de contraseña" : "Cambiar contraseña"}
                  </button>
                  {changePwd && (
                    <Input
                      type="password" className="mt-2"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="Nueva contraseña (mín. 6 caracteres)"
                    />
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={closeModal}>Cancelar</Button>
              <Button
                onClick={submit}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {editing ? "Guardar cambios" : "Crear usuario"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
