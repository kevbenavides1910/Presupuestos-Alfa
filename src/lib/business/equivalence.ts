import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { getEffectiveMonthlyBilling } from "@/lib/business/effectiveBilling";
import { calcSuppliesBudget, effectiveSuppliesPct } from "@/lib/business/profitability";

function toNum(v: Decimal | number | string): number {
  return parseFloat(v.toString());
}

async function loadHistoryByContractId(contractIds: string[]) {
  if (contractIds.length === 0) return new Map<string, { periodMonth: Date; monthlyBilling: Decimal }[]>();
  const rows = await prisma.billingHistory.findMany({
    where: { contractId: { in: contractIds } },
    select: { contractId: true, periodMonth: true, monthlyBilling: true },
  });
  const map = new Map<string, { periodMonth: Date; monthlyBilling: Decimal }[]>();
  for (const h of rows) {
    const arr = map.get(h.contractId) ?? [];
    arr.push(h);
    map.set(h.contractId, arr);
  }
  return map;
}

/**
 * Recalculates equivalencePct for ALL active contracts based on each contract's
 * supplies budget as a share of the total supplies budget across ALL active contracts.
 *
 * equivalencePct = (effectiveMonthlyBilling × suppliesBudgetPct) / Σ(effectiveMonthlyBilling × suppliesBudgetPct)
 *
 * This is used when distributing deferred / admin expenses proportionally.
 * The optional `company` parameter is kept for call-site compatibility but is ignored —
 * equivalence is always global (all companies).
 */
export async function recalculateEquivalence(_company?: string): Promise<void> {
  const contracts = await prisma.contract.findMany({
    where: {
      status: { in: ["ACTIVE", "PROLONGATION"] },
      deletedAt: null,
    },
    select: { id: true, monthlyBilling: true, suppliesBudgetPct: true },
  });

  const historyById = await loadHistoryByContractId(contracts.map((c) => c.id));
  const asOf = new Date();

  const totalSuppliesBudget = contracts.reduce((sum, c) => {
    const hist = historyById.get(c.id) ?? [];
    const eff = getEffectiveMonthlyBilling(toNum(c.monthlyBilling), hist, asOf);
    return sum + eff * toNum(c.suppliesBudgetPct);
  }, 0);

  await prisma.$transaction(
    contracts.map((c) => {
      const hist = historyById.get(c.id) ?? [];
      const eff = getEffectiveMonthlyBilling(toNum(c.monthlyBilling), hist, asOf);
      const contractBudget = eff * toNum(c.suppliesBudgetPct);
      return prisma.contract.update({
        where: { id: c.id },
        data: {
          equivalencePct: totalSuppliesBudget > 0
            ? contractBudget / totalSuppliesBudget
            : 0,
        },
      });
    })
  );
}

/** Totales globales entre contratos ACTIVO/PRÓRROGA (misma base que la participación de insumos). */
export type GlobalPartidaTotals = {
  totalBilling: number;
  totalLabor: number;
  totalSupplies: number;
  totalAdmin: number;
  totalProfit: number;
};

/**
 * Suma de facturación efectiva y de cada partida presupuestaria en todos los contratos
 * activos/prórroga (para % de participación global por partida).
 * Usa el mismo criterio de % insumos que el resto del módulo (effectiveSuppliesPct).
 */
export async function getGlobalPartidaTotals(asOf: Date = new Date()): Promise<GlobalPartidaTotals> {
  const contracts = await prisma.contract.findMany({
    where: {
      status: { in: ["ACTIVE", "PROLONGATION"] },
      deletedAt: null,
    },
    select: {
      id: true,
      monthlyBilling: true,
      laborPct: true,
      suppliesPct: true,
      suppliesBudgetPct: true,
      adminPct: true,
      profitPct: true,
    },
  });

  const historyById = await loadHistoryByContractId(contracts.map((c) => c.id));

  let totalBilling = 0;
  let totalLabor = 0;
  let totalSupplies = 0;
  let totalAdmin = 0;
  let totalProfit = 0;

  for (const c of contracts) {
    const hist = historyById.get(c.id) ?? [];
    const eff = getEffectiveMonthlyBilling(toNum(c.monthlyBilling), hist, asOf);
    const supPct = effectiveSuppliesPct(c);
    const laborPct = toNum(c.laborPct);
    const adminPct = toNum(c.adminPct);
    const profitPct = toNum(c.profitPct);
    totalBilling += eff;
    totalLabor += eff * laborPct;
    totalSupplies += calcSuppliesBudget(eff, supPct);
    totalAdmin += eff * adminPct;
    totalProfit += eff * profitPct;
  }

  return {
    totalBilling,
    totalLabor,
    totalSupplies,
    totalAdmin,
    totalProfit,
  };
}

/**
 * Total presupuesto insumos global (alias; alineado con {@link getGlobalPartidaTotals}).
 */
export async function getTotalSuppliesBudget(asOf: Date = new Date()): Promise<number> {
  const t = await getGlobalPartidaTotals(asOf);
  return t.totalSupplies;
}
