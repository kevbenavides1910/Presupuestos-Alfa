import { z } from "zod";

/** Código estable en mayúsculas (ej. ALFA, NUEVA_EMPRESA) */
export const companyCodeSchema = z
  .string()
  .min(1, "Empresa requerida")
  .max(64)
  .regex(/^[A-Z0-9_]+$/, "Use solo letras mayúsculas, números y guión bajo");

export const companyCodeCreateSchema = z
  .string()
  .min(1, "Código requerido")
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/, "Debe empezar con letra; solo A-Z, 0-9 y _");
