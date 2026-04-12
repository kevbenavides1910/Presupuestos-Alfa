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
