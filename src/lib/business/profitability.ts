import { prisma } from "@/lib/prisma";
import { TRAFFIC_LIGHT, TrafficLight, type ReportPartidaFilter } from "@/lib/utils/constants";
import type { Decimal } from "@prisma/client/runtime/library";
import type { ExpenseBudgetLine } from "@prisma/client";
import { getEffectiveMonthlyBilling } from "@/lib/business/effectiveBilling";

export type { ReportPartidaFilter } from "@/lib/utils/constants";

function toNum(v: Decimal | number | string): number {
  return parseFloat(v.toString());
}

/** % insumos: prioriza `suppliesPct` si está definido (>0), si no `suppliesBudgetPct` */
export function effectiveSuppliesPct(contract: {
  suppliesPct: Decimal | number | string;
  suppliesBudgetPct: Decimal | number | string;
}): number {
  const s = toNum(contract.suppliesPct);
  return s > 0 ? s : toNum(contract.suppliesBudgetPct);
}

/** % ejecución y semáforo por rubro de presupuesto (M.O., insumos, adm., utilidad). */
export type RubroTrafficSnapshot = {
  usagePct: number;
  usagePctFormatted: number;
  trafficLight: TrafficLight;
};

export interface ProfitabilityResult {
  contractId: string;
  monthlyBilling: number;
  /** % usado históricamente para insumos (efectivo) */
  suppliesBudgetPct: number;
  laborBudget: number;
  suppliesBudget: number;
  adminBudget: number;
  profitBudget: number;
  reportPartida: ReportPartidaFilter;
  /** En vista filtrada: presupuesto de esa partida. En ALL: 0 (usar labor/supplies/adminBudget). */
  reportBudget: number;
  reportBudgetPct: number;
  uniformsTotal: number;
  auditTotal: number;
  deferredTotal: number;
  adminTotal: number;
  directTotal: number;
  expenseDistTotal: number;
  directByType: Record<string, number>;
  expenseDistByType: Record<string, number>;
  expensesByType: Record<string, number>;
  grandTotal: number;
  budgetUsagePct: number;
  budgetUsagePctFormatted: number;
  remaining: number;
  trafficLight: TrafficLight;
  /** Desglose por línea de presupuesto (siempre calculado con los mismos gastos vs presupuesto del período). */
  rubroTraffic: {
    LABOR: RubroTrafficSnapshot;
    SUPPLIES: RubroTrafficSnapshot;
    ADMIN: RubroTrafficSnapshot;
    PROFIT: RubroTrafficSnapshot;
  };
  isOverBudget: boolean;
  lifetime?: {
    totalBilled: number;
    totalBudget: number;
    totalExpenses: number;
    totalMonths: number;
    surplus: number;
  };
}

export function calcSuppliesBudget(monthlyBilling: number, pct: number): number {
  return monthlyBilling * pct;
}

export function calcTrafficLight(usagePct: number): TrafficLight {
  if (usagePct < TRAFFIC_LIGHT.GREEN_MAX) return "GREEN";
  if (usagePct < TRAFFIC_LIGHT.YELLOW_MAX) return "YELLOW";
  return "RED";
}

/**
 * Combines unified `Expense` totals by type with legacy tables (full report).
 */
export function mergeLegacyIntoExpenseTypeBuckets(prof: ProfitabilityResult): Record<string, number> {
  const m: Record<string, number> = { ...prof.expensesByType };
  m.UNIFORMS = (m.UNIFORMS ?? 0) + prof.uniformsTotal;
  m.AUDIT = (m.AUDIT ?? 0) + prof.auditTotal;
  m.ADMIN = (m.ADMIN ?? 0) + prof.adminTotal;
  if (prof.deferredTotal > 0) {
    m.DEFERRED_LEGACY = prof.deferredTotal;
  }
  return m;
}

/**
 * Merge legacy tables into expense-type columns según la partida del reporte.
 */
export function mergeLegacyForReportPartida(
  prof: ProfitabilityResult,
  partida: ReportPartidaFilter
): Record<string, number> {
  if (partida === "ALL") return mergeLegacyIntoExpenseTypeBuckets(prof);
  const m: Record<string, number> = { ...prof.expensesByType };
  if (partida === "SUPPLIES") {
    m.UNIFORMS = (m.UNIFORMS ?? 0) + prof.uniformsTotal;
    if (prof.deferredTotal > 0) m.DEFERRED_LEGACY = prof.deferredTotal;
  } else if (partida === "ADMIN") {
    m.ADMIN = (m.ADMIN ?? 0) + prof.adminTotal;
    m.AUDIT = (m.AUDIT ?? 0) + prof.auditTotal;
  }
  return m;
}

function monthRange(periodMonth?: Date): { gte: Date; lte: Date } | undefined {
  if (!periodMonth) return undefined;
  const y = periodMonth.getFullYear();
  const m = periodMonth.getMonth();
  return {
    gte: new Date(y, m, 1),
    lte: new Date(y, m + 1, 0, 23, 59, 59),
  };
}

function usageRatio(spend: number, budget: number): number {
  if (budget <= 0) return 0;
  return spend / budget;
}

function rubroSnapshot(spend: number, budget: number): RubroTrafficSnapshot {
  const ur = usageRatio(spend, budget);
  return {
    usagePct: ur,
    usagePctFormatted: ur * 100,
    trafficLight: budget > 0 ? calcTrafficLight(ur) : "GREEN",
  };
}

export async function getContractProfitability(
  contractId: string,
  periodMonth?: Date,
  partida: ReportPartidaFilter = "ALL"
): Promise<ProfitabilityResult> {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
  });

  const billingHistRows = await prisma.billingHistory.findMany({
    where: { contractId },
    select: { periodMonth: true, monthlyBilling: true },
  });

  const baseBilling = toNum(contract.monthlyBilling);
  const suppliesPctEff = effectiveSuppliesPct(contract);
  const laborPct = toNum(contract.laborPct);
  const adminPct = toNum(contract.adminPct);
  const profitPct = toNum(contract.profitPct);

  const asOfForRate = periodMonth ?? new Date();
  const billing = getEffectiveMonthlyBilling(baseBilling, billingHistRows, asOfForRate);

  const laborBudget = calcSuppliesBudget(billing, laborPct);
  const suppliesBudget = calcSuppliesBudget(billing, suppliesPctEff);
  const adminBudget = calcSuppliesBudget(billing, adminPct);
  const profitBudget = calcSuppliesBudget(billing, profitPct);

  const range = monthRange(periodMonth);

  const uniforms = await prisma.uniformExpense.findMany({
    where: {
      contractId,
      ...(range ? { periodMonth: { gte: range.gte, lte: range.lte } } : {}),
    },
  });
  const uniformsTotal = uniforms.reduce((s, u) => s + toNum(u.totalCost), 0);

  const findings = await prisma.auditFinding.findMany({
    where: {
      contractId,
      status: "PENDING",
      ...(range ? { findingDate: { gte: range.gte, lte: range.lte } } : {}),
    },
  });
  const auditTotal = findings.reduce((s, f) => s + toNum(f.totalCost), 0);

  const deferredDists = await prisma.deferredDistribution.findMany({
    where: {
      contractId,
      ...(range
        ? { deferredExpense: { periodMonth: { gte: range.gte, lte: range.lte } } }
        : {}),
    },
  });
  const deferredTotal = deferredDists.reduce((s, d) => s + toNum(d.allocatedAmount), 0);

  const adminDists = await prisma.adminDistribution.findMany({
    where: {
      contractId,
      ...(range
        ? { adminExpense: { periodMonth: { gte: range.gte, lte: range.lte } } }
        : {}),
    },
  });
  const adminTotal = adminDists.reduce((s, d) => s + toNum(d.allocatedAmount), 0);

  const directExpenses = await prisma.expense.findMany({
    where: {
      contractId,
      isDeferred: false,
      ...(range ? { periodMonth: { gte: range.gte, lte: range.lte } } : {}),
    },
  });

  const expenseDists = await prisma.expenseDistribution.findMany({
    where: {
      contractId,
      expense: {
        approvalStatus: { not: "REJECTED" },
        ...(range ? { periodMonth: { gte: range.gte, lte: range.lte } } : {}),
      },
    },
    include: { expense: { select: { type: true, budgetLine: true } } },
  });

  const directByType: Record<string, number> = {};
  const directByLine: Record<ExpenseBudgetLine, number> = {
    LABOR: 0,
    SUPPLIES: 0,
    ADMIN: 0,
    PROFIT: 0,
  };
  let directUnassigned = 0;

  for (const e of directExpenses) {
    const amt = toNum(e.amount);
    if (e.budgetLine == null) {
      directUnassigned += amt;
    } else {
      directByLine[e.budgetLine] = (directByLine[e.budgetLine] ?? 0) + amt;
    }
    directByType[e.type] = (directByType[e.type] ?? 0) + amt;
  }

  const expenseDistByType: Record<string, number> = {};
  const distByLine: Record<ExpenseBudgetLine, number> = {
    LABOR: 0,
    SUPPLIES: 0,
    ADMIN: 0,
    PROFIT: 0,
  };
  let distUnassigned = 0;

  for (const d of expenseDists) {
    const amt = toNum(d.allocatedAmount);
    const bl = d.expense.budgetLine;
    if (bl == null) {
      distUnassigned += amt;
    } else {
      distByLine[bl] = (distByLine[bl] ?? 0) + amt;
    }
    const t = d.expense.type;
    expenseDistByType[t] = (expenseDistByType[t] ?? 0) + amt;
  }

  const lineSpend = (line: ExpenseBudgetLine) =>
    (directByLine[line] ?? 0) + (distByLine[line] ?? 0);

  const laborSpend = lineSpend("LABOR");
  const suppliesUnifiedSpend = lineSpend("SUPPLIES");
  const adminUnifiedSpend = lineSpend("ADMIN");
  const profitSpend = lineSpend("PROFIT");

  const suppliesSpendTotal = suppliesUnifiedSpend + uniformsTotal + deferredTotal;
  const adminSpendTotal = adminUnifiedSpend + adminTotal + auditTotal;

  const directTotal = directExpenses.reduce((s, e) => s + toNum(e.amount), 0);
  const expenseDistTotal = expenseDists.reduce((s, d) => s + toNum(d.allocatedAmount), 0);

  const expensesByType: Record<string, number> = { ...directByType };
  for (const [t, v] of Object.entries(expenseDistByType)) {
    expensesByType[t] = (expensesByType[t] ?? 0) + v;
  }

  const grandTotalAll =
    uniformsTotal +
    auditTotal +
    deferredTotal +
    adminTotal +
    directTotal +
    expenseDistTotal;

  let grandTotal: number;
  let budgetUsagePct: number;
  let trafficLight: TrafficLight;
  let isOverBudget: boolean;
  let remaining: number;
  let reportBudget: number;
  let reportBudgetPct: number;

  let outDirectTotal = directTotal;
  let outExpenseDistTotal = expenseDistTotal;

  if (partida === "ALL") {
    grandTotal = grandTotalAll;
    const maxUsage = Math.max(
      usageRatio(laborSpend, laborBudget),
      usageRatio(suppliesSpendTotal, suppliesBudget),
      usageRatio(adminSpendTotal, adminBudget),
      usageRatio(profitSpend, profitBudget)
    );
    budgetUsagePct = maxUsage;
    trafficLight = calcTrafficLight(maxUsage);
    isOverBudget = maxUsage > 1;
    // Coherente con reporte anual (ALL): presupuesto MO+Ins+Adm. (sin utilidad) − gastos totales del mes.
    // El semáforo sigue usando el mayor % entre líneas (cuello de botella).
    const combinedBudgetNoProfit = laborBudget + suppliesBudget + adminBudget;
    remaining = combinedBudgetNoProfit - grandTotalAll;
    reportBudget = 0;
    reportBudgetPct = 0;
  } else {
    const line = partida;
    const b =
      line === "LABOR"
        ? laborBudget
        : line === "SUPPLIES"
          ? suppliesBudget
          : adminBudget;
    const pct =
      line === "LABOR"
        ? laborPct
        : line === "SUPPLIES"
          ? suppliesPctEff
          : adminPct;

    const spend =
      line === "LABOR"
        ? laborSpend
        : line === "SUPPLIES"
          ? suppliesSpendTotal
          : adminSpendTotal;

    grandTotal = spend;
    budgetUsagePct = usageRatio(spend, b);
    trafficLight = calcTrafficLight(budgetUsagePct);
    isOverBudget = spend > b;
    remaining = b - spend;
    reportBudget = b;
    reportBudgetPct = pct;

    const dt: Record<string, number> = {};
    const edt: Record<string, number> = {};
    for (const e of directExpenses) {
      if (e.budgetLine !== line) continue;
      dt[e.type] = (dt[e.type] ?? 0) + toNum(e.amount);
    }
    for (const d of expenseDists) {
      if (d.expense.budgetLine !== line) continue;
      const t = d.expense.type;
      edt[t] = (edt[t] ?? 0) + toNum(d.allocatedAmount);
    }
    const et: Record<string, number> = { ...dt };
    for (const [t, v] of Object.entries(edt)) {
      et[t] = (et[t] ?? 0) + v;
    }
    Object.keys(directByType).forEach((k) => delete directByType[k]);
    Object.assign(directByType, dt);
    Object.keys(expenseDistByType).forEach((k) => delete expenseDistByType[k]);
    Object.assign(expenseDistByType, edt);
    Object.keys(expensesByType).forEach((k) => delete expensesByType[k]);
    Object.assign(expensesByType, et);

    outDirectTotal = Object.values(dt).reduce((s, v) => s + v, 0);
    outExpenseDistTotal = Object.values(edt).reduce((s, v) => s + v, 0);

    void directUnassigned;
    void distUnassigned;
  }

  const budgetUsagePctFormatted = budgetUsagePct * 100;

  let lifetime: ProfitabilityResult["lifetime"] = undefined;
  if (!periodMonth) {
    const now = new Date();
    const contractEnd = new Date(contract.endDate);
    const limitDate = contractEnd < now ? contractEnd : now;
    const startY = new Date(contract.startDate).getFullYear();
    const startM = new Date(contract.startDate).getMonth();
    const endY = limitDate.getFullYear();
    const endM = limitDate.getMonth();

    let totalBilled = 0;
    let totalBudget = 0;
    let totalMonths = 0;

    let y = startY,
      m = startM;
    while (y < endY || (y === endY && m <= endM)) {
      const monthBilling = getEffectiveMonthlyBilling(baseBilling, billingHistRows, new Date(y, m, 1));
      totalBilled += monthBilling;
      totalBudget += monthBilling * suppliesPctEff;
      totalMonths++;
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }

    lifetime = {
      totalBilled,
      totalBudget,
      totalExpenses: grandTotalAll,
      totalMonths,
      surplus: totalBudget - grandTotalAll,
    };
  }

  const rubroTraffic = {
    LABOR: rubroSnapshot(laborSpend, laborBudget),
    SUPPLIES: rubroSnapshot(suppliesSpendTotal, suppliesBudget),
    ADMIN: rubroSnapshot(adminSpendTotal, adminBudget),
    PROFIT: rubroSnapshot(profitSpend, profitBudget),
  };

  return {
    contractId,
    monthlyBilling: billing,
    suppliesBudgetPct: suppliesPctEff,
    laborBudget,
    suppliesBudget,
    adminBudget,
    profitBudget,
    reportPartida: partida,
    reportBudget,
    reportBudgetPct,
    uniformsTotal,
    auditTotal,
    deferredTotal,
    adminTotal,
    directTotal: outDirectTotal,
    expenseDistTotal: outExpenseDistTotal,
    directByType,
    expenseDistByType,
    expensesByType,
    grandTotal,
    budgetUsagePct,
    budgetUsagePctFormatted,
    remaining,
    trafficLight,
    rubroTraffic,
    isOverBudget,
    lifetime,
  };
}

export async function getCompanyProfitabilitySummary(company?: string) {
  const whereClause = company
    ? { company, deletedAt: null as null }
    : { deletedAt: null as null };

  const contracts = await prisma.contract.findMany({ where: whereClause });
  const results = await Promise.all(contracts.map((c) => getContractProfitability(c.id)));

  return {
    totalContracts: contracts.length,
    totalBilling: results.reduce((s, r) => s + r.monthlyBilling, 0),
    totalSuppliesBudget: results.reduce((s, r) => s + r.suppliesBudget, 0),
    totalExpenses: results.reduce((s, r) => s + r.grandTotal, 0),
    green: results.filter((r) => r.trafficLight === "GREEN").length,
    yellow: results.filter((r) => r.trafficLight === "YELLOW").length,
    red: results.filter((r) => r.trafficLight === "RED").length,
    overBudget: results.filter((r) => r.isOverBudget).length,
    results,
  };
}
