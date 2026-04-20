import type { UserRole } from "@prisma/client";

/** Crear/editar contratos, periodos, puestos, historial de facturación (no gastos). */
export function canModifyContracts(role: UserRole): boolean {
  return role === "ADMIN" || role === "SUPERVISOR" || role === "COMMERCIAL";
}

/** Alta/edición de gastos, uniformes, hallazgos de auditoría, distribuciones. */
export function canManageExpenses(role: UserRole): boolean {
  return role === "ADMIN" || role === "SUPERVISOR" || role === "COMPRAS";
}

export function isAdmin(role: UserRole): boolean {
  return role === "ADMIN";
}

/** Importar nuevos lotes de apercibimientos al módulo disciplinario. */
export function canImportDisciplinary(role: UserRole): boolean {
  return role === "ADMIN";
}

/** Consultar el módulo disciplinario (toda persona autenticada del sistema). */
export function canViewDisciplinary(_role: UserRole): boolean {
  return true;
}

/**
 * Editar el seguimiento del módulo disciplinario:
 * - cambiar estado del apercibimiento (Entregado, Firmado, Anulado).
 * - registrar/actualizar tratamiento por empleado.
 * - cerrar ciclos.
 */
export function canManageDisciplinary(role: UserRole): boolean {
  return role === "ADMIN" || role === "SUPERVISOR";
}
