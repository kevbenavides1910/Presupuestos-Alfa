import type { Contract } from "@prisma/client";
import type { Decimal } from "@prisma/client/runtime/library";
import type { GlobalPartidaTotals } from "@/lib/business/equivalence";
import { getEffectiveMonthlyBilling } from "@/lib/business/effectiveBilling";
import { calcSuppliesBudget, effectiveSuppliesPct } from "@/lib/business/profitability";

type HistoryRow = {
  contractId: string;
  periodMonth: Date;
  monthlyBilling: Decimal | number | string;
};

/**
 * Enriquece contratos para listado: facturación efectiva, presupuesto por partida (M.O., insumos, adm., utilidad)
 * y participación global por partida (facturación, M.O., insumos, adm., util.) frente al total activo.
 */
export function enrichContractsListRows(
  contracts: Contract[],
  pageHistory: HistoryRow[],
  globalTotals: GlobalPartidaTotals,
  asOf: Date = new Date()
) {
  const histByContract = new Map<string, HistoryRow[]>();
  for (const h of pageHistory) {
    const arr = histByContract.get(h.contractId) ?? [];
    arr.push(h);
    histByContract.set(h.contractId, arr);
  }

  return contracts.map((c) => {
    const baseBilling = parseFloat(c.monthlyBilling.toString());
    const hist = histByContract.get(c.id) ?? [];
    const billing = getEffectiveMonthlyBilling(baseBilling, hist, asOf);
    const suppliesPctEff = effectiveSuppliesPct(c);
    const laborPct = parseFloat(c.laborPct.toString());
    const adminPct = parseFloat(c.adminPct.toString());
    const profitPct = parseFloat(c.profitPct.toString());
    const suppliesBudget = calcSuppliesBudget(billing, suppliesPctEff);
    const laborBudget = billing * laborPct;
    const adminBudget = billing * adminPct;
    const profitBudget = billing * profitPct;

    const billingSharePct =
      globalTotals.totalBilling > 0 ? billing / globalTotals.totalBilling : 0;
    const laborSharePct =
      globalTotals.totalLabor > 0 ? laborBudget / globalTotals.totalLabor : 0;
    const suppliesSharePct =
      globalTotals.totalSupplies > 0 ? suppliesBudget / globalTotals.totalSupplies : 0;
    const adminSharePct =
      globalTotals.totalAdmin > 0 ? adminBudget / globalTotals.totalAdmin : 0;
    const profitSharePct =
      globalTotals.totalProfit > 0 ? profitBudget / globalTotals.totalProfit : 0;

    return {
      ...c,
      monthlyBilling: billing,
      suppliesBudgetPct: suppliesPctEff,
      laborPct,
      adminPct,
      profitPct,
      laborBudget,
      suppliesBudget,
      adminBudget,
      profitBudget,
      equivalencePct: parseFloat(c.equivalencePct.toString()),
      billingSharePct,
      laborSharePct,
      suppliesSharePct,
      adminSharePct,
      profitSharePct,
    };
  });
}
