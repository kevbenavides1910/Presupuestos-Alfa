import { z } from "zod";
import { ExpenseBudgetLine, ExpenseCategory, ExpenseType } from "@prisma/client";
import { companyCodeSchema } from "@/lib/validations/company-code";

const expenseCategoryEnum = z.enum([
  "UNIFORMS",
  "AUDIT_FINDINGS",
  "DEFERRED",
  "ADMIN",
  "TRANSPORT",
  "FUEL",
  "PHONES",
  "OTHER",
] as [ExpenseCategory, ...ExpenseCategory[]]);

export const expenseCreateSchema = z
  .object({
    type: z.enum([
      "APERTURA",
      "UNIFORMS",
      "AUDIT",
      "ADMIN",
      "TRANSPORT",
      "FUEL",
      "PHONES",
      "PLANILLA",
      "OTHER",
    ] as [ExpenseType, ...ExpenseType[]]),
    budgetLine: z.enum(["LABOR", "SUPPLIES", "ADMIN", "PROFIT"] as [
      ExpenseBudgetLine,
      ...ExpenseBudgetLine[],
    ]),
    description: z.string().min(2, "Descripción requerida"),
    amount: z.number().positive("El monto debe ser positivo"),
    periodMonth: z.string(),
    contractId: z.string().optional(),
    positionId: z.string().optional(),
    originId: z.string().optional(),
    referenceNumber: z.string().optional(),
    company: companyCodeSchema,
    isDeferred: z.boolean().default(false),
    notes: z.string().optional(),
    spreadMonths: z.coerce.number().int().min(1).max(60).default(1),
  })
  .refine((d) => d.isDeferred || d.contractId, {
    message: "Debe especificar un contrato (o marcar como diferido)",
  })
  .refine((d) => d.spreadMonths <= 1 || (!d.isDeferred && !!d.contractId), {
    message: "El prorrateo en meses solo aplica a gastos asignados a un contrato específico",
  });

export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

// ─── Gastos administrativos globales (por empresa / mes) ─────────────────────

export const adminExpenseSchema = z.object({
  company: companyCodeSchema,
  periodMonth: z.string(),
  transport: z.coerce.number().min(0),
  adminCosts: z.coerce.number().min(0),
  phones: z.coerce.number().min(0),
  phoneLines: z.coerce.number().min(0),
  fuel: z.coerce.number().min(0),
  otherAmount: z.coerce.number().min(0),
  otherDesc: z.string().optional(),
});

export type AdminExpenseInput = z.infer<typeof adminExpenseSchema>;

// ─── Gastos diferidos globales ───────────────────────────────────────────────

export const deferredExpenseSchema = z.object({
  company: companyCodeSchema,
  description: z.string().min(1, "Descripción requerida"),
  category: expenseCategoryEnum,
  totalAmount: z.number().positive("El monto debe ser positivo"),
  periodMonth: z.string(),
});

export type DeferredExpenseInput = z.infer<typeof deferredExpenseSchema>;

// ─── Hallazgos de auditoría (por contrato) ───────────────────────────────────

const nonneg = z.coerce.number().min(0);

export const auditFindingSchema = z.object({
  contractId: z.string(),
  postName: z.string().min(1, "Nombre del puesto requerido"),
  findingDate: z.string(),
  radioQty: z.coerce.number().int().min(0).default(0),
  radioCost: nonneg.default(0),
  handcuffsQty: z.coerce.number().int().min(0).default(0),
  handcuffsCost: nonneg.default(0),
  umbrellaQty: z.coerce.number().int().min(0).default(0),
  umbrellaCost: nonneg.default(0),
  blackjackQty: z.coerce.number().int().min(0).default(0),
  blackjackCost: nonneg.default(0),
  flashlightQty: z.coerce.number().int().min(0).default(0),
  flashlightCost: nonneg.default(0),
  otherQty: z.coerce.number().int().min(0).default(0),
  otherCost: nonneg.default(0),
  otherDesc: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["PENDING", "COMPLETED"]).optional(),
});

export type AuditFindingInput = z.infer<typeof auditFindingSchema>;

// ─── Uniformes (por contrato / mes) ──────────────────────────────────────────

export const uniformExpenseSchema = z.object({
  contractId: z.string(),
  periodMonth: z.string(),
  shirtQty: z.coerce.number().int().min(0).default(0),
  shirtCost: nonneg.default(0),
  pantsQty: z.coerce.number().int().min(0).default(0),
  pantsCost: nonneg.default(0),
  shoesQty: z.coerce.number().int().min(0).default(0),
  shoesCost: nonneg.default(0),
  capQty: z.coerce.number().int().min(0).default(0),
  capCost: nonneg.default(0),
  vestQty: z.coerce.number().int().min(0).default(0),
  vestCost: nonneg.default(0),
  beltQty: z.coerce.number().int().min(0).default(0),
  beltCost: nonneg.default(0),
  bootsQty: z.coerce.number().int().min(0).default(0),
  bootsCost: nonneg.default(0),
  otherQty: z.coerce.number().int().min(0).default(0),
  otherCost: nonneg.default(0),
  otherDesc: z.string().optional(),
});

export type UniformExpenseInput = z.infer<typeof uniformExpenseSchema>;
