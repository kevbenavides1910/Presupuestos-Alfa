import type { CompanyName, ClientType, ContractStatus, ExpenseBudgetLine, UserRole } from "@prisma/client";

export const EXPENSE_BUDGET_LINES: ExpenseBudgetLine[] = ["LABOR", "SUPPLIES", "ADMIN", "PROFIT"];

export const EXPENSE_BUDGET_LINE_LABELS: Record<ExpenseBudgetLine, string> = {
  LABOR: "Mano de obra",
  SUPPLIES: "Insumos",
  ADMIN: "Gasto administrativo",
  PROFIT: "Utilidad",
};

/** Filtro del reporte mensual por partida presupuestaria (no incluye PROFIT; la utilidad sigue en gastos con partida Utilidad). */
export type ReportPartidaFilter = "ALL" | "LABOR" | "SUPPLIES" | "ADMIN";

const REPORT_PARTIDA_SET = new Set<string>(["ALL", "LABOR", "SUPPLIES", "ADMIN"]);

export const REPORT_PARTIDA_OPTIONS: { value: ReportPartidaFilter; label: string }[] = [
  { value: "ALL", label: "Todas las partidas" },
  { value: "LABOR", label: "Mano de obra" },
  { value: "SUPPLIES", label: "Insumos" },
  { value: "ADMIN", label: "Gasto administrativo" },
];

export function parseReportPartida(raw: string | null): ReportPartidaFilter {
  if (raw && REPORT_PARTIDA_SET.has(raw)) return raw as ReportPartidaFilter;
  return "ALL";
}

export const COMPANIES: CompanyName[] = [
  "CONSORCIO", "MONITOREO", "TANGO", "ALFA",
  "ALFATRONIC", "BENLO", "BENA", "JOBEN", "GRUPO", "ACE",
];

export const COMPANY_LABELS: Record<CompanyName, string> = {
  CONSORCIO: "Consorcio",
  MONITOREO: "Monitoreo",
  TANGO: "Tango",
  ALFA: "Alfa",
  ALFATRONIC: "Alfatronic",
  BENLO: "Benlo",
  BENA: "Bena",
  JOBEN: "Joben",
  GRUPO: "Grupo",
  ACE: "ACE",
};

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  PUBLIC: "Pública",
  PRIVATE: "Privada",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  ACTIVE: "Activo",
  PROLONGATION: "Prórroga",
  SUSPENDED: "Suspendido",
  FINISHED: "Finalizado",
  CANCELLED: "Cancelado",
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  COMPRAS: "Compras",
  COMMERCIAL: "Comercial",
  CONSULTA: "Consulta",
};

// Traffic light thresholds
export const TRAFFIC_LIGHT = {
  GREEN_MAX: 0.70,
  YELLOW_MAX: 0.90,
};

export type TrafficLight = "GREEN" | "YELLOW" | "RED";

export function calcTrafficLight(usagePct: number): TrafficLight {
  if (usagePct < TRAFFIC_LIGHT.GREEN_MAX) return "GREEN";
  if (usagePct < TRAFFIC_LIGHT.YELLOW_MAX) return "YELLOW";
  return "RED";
}

export const TRAFFIC_LIGHT_LABELS: Record<TrafficLight, string> = {
  GREEN: "Normal",
  YELLOW: "Precaución",
  RED: "Crítico",
};

export const UNIFORM_ITEMS = [
  { key: "shirt",  label: "Camisa",    qtyKey: "shirtQty",  costKey: "shirtCost" },
  { key: "pants",  label: "Pantalón",  qtyKey: "pantsQty",  costKey: "pantsCost" },
  { key: "shoes",  label: "Zapatos",   qtyKey: "shoesQty",  costKey: "shoesCost" },
  { key: "cap",    label: "Gorra",     qtyKey: "capQty",    costKey: "capCost" },
  { key: "vest",   label: "Chaleco",   qtyKey: "vestQty",   costKey: "vestCost" },
  { key: "belt",   label: "Cinturón",  qtyKey: "beltQty",   costKey: "beltCost" },
  { key: "boots",  label: "Botas",     qtyKey: "bootsQty",  costKey: "bootsCost" },
  { key: "other",  label: "Otros",     qtyKey: "otherQty",  costKey: "otherCost" },
] as const;

export const AUDIT_ITEMS = [
  { key: "radio",      label: "Radio",       qtyKey: "radioQty",      costKey: "radioCost" },
  { key: "handcuffs",  label: "Esposas",     qtyKey: "handcuffsQty",  costKey: "handcuffsCost" },
  { key: "umbrella",   label: "Paraguas",    qtyKey: "umbrellaQty",   costKey: "umbrellaCost" },
  { key: "blackjack",  label: "Blackjack",   qtyKey: "blackjackQty",  costKey: "blackjackCost" },
  { key: "flashlight", label: "Linterna",    qtyKey: "flashlightQty", costKey: "flashlightCost" },
  { key: "other",      label: "Otros",       qtyKey: "otherQty",      costKey: "otherCost" },
] as const;

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  UNIFORMS: "Uniformes",
  AUDIT_FINDINGS: "Hallazgos de auditoría",
  DEFERRED: "Diferidos",
  ADMIN: "Administrativos",
  TRANSPORT: "Transporte",
  FUEL: "Combustible",
  PHONES: "Teléfonos",
  OTHER: "Otros",
};
