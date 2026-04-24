import { z } from "zod";
import { companyCodeSchema } from "@/lib/validations/company-code";

const pct = z.number().min(0).max(1).default(0);

const contractInputSchema = z.object({
  licitacionNo: z.string().min(3, "Número de licitación requerido"),
  company: companyCodeSchema,
  client: z.string().min(2, "Cliente requerido"),
  clientType: z.enum(["PUBLIC", "PRIVATE"]),
  officersCount: z.number().int().min(1, "Mínimo 1 oficial"),
  positionsCount: z.number().int().min(1, "Mínimo 1 puesto"),
  startDate: z.string().or(z.date()),
  endDate: z.string().or(z.date()),
  monthlyBilling: z.number().positive("La facturación debe ser positiva"),
  laborPct: pct,
  suppliesPct: pct,
  adminPct: pct,
  profitPct: pct,
  status: z.enum(["ACTIVE", "PROLONGATION", "SUSPENDED", "FINISHED", "CANCELLED"]).default("ACTIVE"),
  notes: z.string().optional(),
});

function distributionSumsTo100(data: {
  laborPct: number;
  suppliesPct: number;
  adminPct: number;
  profitPct: number;
}) {
  // Permitimos pequeno margen para redondeos humanos/UI (ej. 83.44 + 5.50 + 1.06 + 10.00)
  // y precision de parseo decimal; evita bloquear contratos que efectivamente suman 100%.
  return Math.abs(data.laborPct + data.suppliesPct + data.adminPct + data.profitPct - 1) < 0.001;
}

export const contractCreateSchema = contractInputSchema
  .refine(
    (data) => distributionSumsTo100(data),
    {
      message: "Mano de obra + Insumos + Gasto administrativo + Utilidad deben sumar 100%",
      path: ["suppliesPct"],
    }
  )
  .refine(
    (data) => new Date(data.endDate) > new Date(data.startDate),
    { message: "La fecha de cierre debe ser posterior a la de inicio", path: ["endDate"] }
  );

export const contractUpdateSchema = contractInputSchema
  .partial()
  .omit({ licitacionNo: true })
  .superRefine((data, ctx) => {
    const L = data.laborPct;
    const S = data.suppliesPct;
    const A = data.adminPct;
    const P = data.profitPct;
    if (L !== undefined && S !== undefined && A !== undefined && P !== undefined) {
      if (!distributionSumsTo100({ laborPct: L, suppliesPct: S, adminPct: A, profitPct: P })) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Mano de obra + Insumos + Gasto administrativo + Utilidad deben sumar 100%",
          path: ["suppliesPct"],
        });
      }
    }
  });

export const periodSchema = z.object({
  startDate: z.string().or(z.date()),
  endDate: z.string().or(z.date()),
  monthlyBilling: z.number().positive(),
  notes: z.string().optional(),
}).refine(
  (data) => new Date(data.endDate) > new Date(data.startDate),
  { message: "La fecha de cierre debe ser posterior a la de inicio", path: ["endDate"] }
);

export type ContractCreateInput = z.infer<typeof contractCreateSchema>;
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
export type PeriodInput = z.infer<typeof periodSchema>;
