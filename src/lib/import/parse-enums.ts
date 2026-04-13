import type { ClientType, ContractStatus, ExpenseBudgetLine, ExpenseType } from "@prisma/client";

const NORM = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");

export function parseCompanyCell(
  v: unknown,
  catalog: { code: string; name: string }[]
): string | null {
  if (v === undefined || v === null || v === "") return null;
  const raw = String(v).trim();
  const n = NORM(raw);
  for (const { code, name } of catalog) {
    if (code === raw || NORM(code) === n) return code;
    if (NORM(name) === n) return code;
  }
  return null;
}

export function parseClientTypeCell(v: unknown): ClientType | null {
  if (v === undefined || v === null || v === "") return null;
  const n = NORM(String(v));
  if (n === "public" || n === "publica" || n === "publico") return "PUBLIC";
  if (n === "private" || n === "privada" || n === "privado") return "PRIVATE";
  if (n === "PUBLIC" || n === "PRIVATE") return n as ClientType;
  return null;
}

export function parseContractStatusCell(v: unknown): ContractStatus | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  const n = NORM(s);
  const map: [string, ContractStatus][] = [
    ["active", "ACTIVE"],
    ["activo", "ACTIVE"],
    ["prolongation", "PROLONGATION"],
    ["prorroga", "PROLONGATION"],
    ["suspended", "SUSPENDED"],
    ["suspendido", "SUSPENDED"],
    ["finished", "FINISHED"],
    ["finalizado", "FINISHED"],
    ["cancelled", "CANCELLED"],
    ["cancelado", "CANCELLED"],
  ];
  for (const [k, val] of map) {
    if (n === k) return val;
  }
  const upper = s.toUpperCase();
  if (
    upper === "ACTIVE" ||
    upper === "PROLONGATION" ||
    upper === "SUSPENDED" ||
    upper === "FINISHED" ||
    upper === "CANCELLED"
  ) {
    return upper as ContractStatus;
  }
  return null;
}

const EXPENSE_TYPE_ALIASES: [string, ExpenseType][] = [
  ["apertura", "APERTURA"],
  ["uniformes", "UNIFORMS"],
  ["auditoria", "AUDIT"],
  ["administrativo", "ADMIN"],
  ["gasto_administrativo", "ADMIN"],
  ["admin", "ADMIN"],
  ["transporte", "TRANSPORT"],
  ["combustible", "FUEL"],
  ["telefonos", "PHONES"],
  ["planilla", "PLANILLA"],
  ["otros", "OTHER"],
  ["otro", "OTHER"],
];

export function parseExpenseTypeCell(v: unknown): ExpenseType | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  const n = NORM(s);
  const up = s.toUpperCase();
  const valid: ExpenseType[] = [
    "APERTURA",
    "UNIFORMS",
    "AUDIT",
    "ADMIN",
    "TRANSPORT",
    "FUEL",
    "PHONES",
    "PLANILLA",
    "OTHER",
  ];
  if (valid.includes(up as ExpenseType)) return up as ExpenseType;
  for (const [alias, t] of EXPENSE_TYPE_ALIASES) {
    if (n === alias) return t;
  }
  return null;
}

const BUDGET_ALIASES: [string, ExpenseBudgetLine][] = [
  ["labor", "LABOR"],
  ["mo", "LABOR"],
  ["mano_de_obra", "LABOR"],
  ["manoobra", "LABOR"],
  ["insumos", "SUPPLIES"],
  ["supplies", "SUPPLIES"],
  ["gasto_administrativo", "ADMIN"],
  ["gastoadministrativo", "ADMIN"],
  ["admin", "ADMIN"],
  ["utilidad", "PROFIT"],
  ["profit", "PROFIT"],
];

export function parseExpenseBudgetLineCell(v: unknown): ExpenseBudgetLine | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  const n = NORM(s);
  const up = s.toUpperCase();
  if (["LABOR", "SUPPLIES", "ADMIN", "PROFIT"].includes(up)) return up as ExpenseBudgetLine;
  for (const [alias, b] of BUDGET_ALIASES) {
    if (n === alias) return b;
  }
  return null;
}

export function parseBoolCell(v: unknown): boolean | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const n = NORM(String(v));
  if (n === "si" || n === "sí" || n === "yes" || n === "true" || n === "1" || n === "verdadero") return true;
  if (n === "no" || n === "false" || n === "0" || n === "falso") return false;
  return null;
}
