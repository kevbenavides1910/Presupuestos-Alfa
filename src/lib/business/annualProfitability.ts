import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calcTrafficLight, type ReportPartidaFilter, type TrafficLight } from "@/lib/utils/constants";
import { effectiveSuppliesPct } from "@/lib/business/profitability";
import { getEffectiveMonthlyBilling } from "@/lib/business/effectiveBilling";

export interface MonthCell {
  month: number;
  monthlyBilling: number;
  /** Presupuesto de la partida activa (en ALL: suma MO+Insumos+Adm. para referencia; el detalle va en `partidaAllDetail`) */
  lineBudget: number;
  totalExpenses: number;
  surplus: number;
  hasData: boolean;
  trafficLight: TrafficLight;
  /** Desglose cuando el reporte es “todas las partidas” (semáforo y superávit vs. mensual). */
  partidaAllDetail?: {
    laborBudget: number;
    suppliesBudget: number;
    adminBudget: number;
    laborSpend: number;
    suppliesSpend: number;
    adminSpend: number;
    /** Gastos directos sin partida (budgetLine nulo); no entran en MO/Ins/Adm hasta asignarlos */
    unassignedSpend: number;
  };
}

export interface AnnualReportRow {
  contractId: string;
  licitacionNo: string;
  company: string;
  client: string;
  status: string;
  months: MonthCell[];
  annualBudget: number;
  annualExpenses: number;
  annualSurplus: number;
}

export interface AnnualReport {
  year: number;
  partida: ReportPartidaFilter;
  rows: AnnualReportRow[];
  monthlyTotals: { month: number; budget: number; expenses: number; surplus: number }[];
  grandBudget: number;
  grandExpenses: number;
  grandSurplus: number;
}

type RawRow = { contractid: string; month: number; total: string };
type RawLineRow = { contractid: string; month: number; bl: string; total: string };

function monthNum(m: number | string): number {
  const n = typeof m === "string" ? parseInt(m, 10) : m;
  return Number.isFinite(n) ? n : 0;
}

function buildMap(rows: RawRow[]): Map<string, Map<number, number>> {
  const m = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const cid = r.contractid;
    const mo = monthNum(r.month);
    if (mo < 1 || mo > 12) continue;
    const val = parseFloat(r.total);
    if (!m.has(cid)) m.set(cid, new Map());
    m.get(cid)!.set(mo, (m.get(cid)!.get(mo) ?? 0) + val);
  }
  return m;
}

/** Normaliza etiqueta de enum desde Postgres (p. ej. LABOR, "labor") */
function normalizeBudgetLineKey(bl: string | null | undefined): string {
  if (bl == null || bl === "" || bl === "NULL") return "NULL";
  return String(bl).replace(/^"|"$/g, "").trim().toUpperCase();
}

/** Map contractId → month → budgetLine key → amount */
function buildLineMap(rows: RawLineRow[]): Map<string, Map<number, Map<string, number>>> {
  const m = new Map<string, Map<number, Map<string, number>>>();
  for (const r of rows) {
    const cid = r.contractid;
    const mo = monthNum(r.month);
    if (mo < 1 || mo > 12) continue;
    const key = normalizeBudgetLineKey(r.bl);
    const val = parseFloat(r.total);
    if (!m.has(cid)) m.set(cid, new Map());
    const cm = m.get(cid)!;
    if (!cm.has(mo)) cm.set(mo, new Map());
    const lineMap = cm.get(mo)!;
    lineMap.set(key, (lineMap.get(key) ?? 0) + val);
  }
  return m;
}

function getLine(
  lineMap: Map<string, Map<number, Map<string, number>>>,
  cid: string,
  mo: number,
  line: "LABOR" | "SUPPLIES" | "ADMIN" | "PROFIT"
): number {
  return lineMap.get(cid)?.get(mo)?.get(line) ?? 0;
}

export async function getAnnualReport(
  year: number,
  companyFilter?: string,
  partida: ReportPartidaFilter = "ALL"
): Promise<AnnualReport> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const where: Record<string, unknown> = {
    deletedAt: null,
    startDate: { lte: yearEnd },
    endDate: { gte: yearStart },
  };
  if (companyFilter) where.company = companyFilter;
  const contracts = await prisma.contract.findMany({ where, orderBy: [{ company: "asc" }, { client: "asc" }] });
  const ids = contracts.map((c) => c.id);
  if (ids.length === 0) {
    return { year, partida, rows: [], monthlyTotals: [], grandBudget: 0, grandExpenses: 0, grandSurplus: 0 };
  }

  const [
    uniforms,
    audits,
    deferred,
    admin,
    direct,
    expDist,
    directByLine,
    distByLine,
    billingHistRows,
  ] = await Promise.all([
    prisma.$queryRaw<RawRow[]>`
      SELECT "contractId" as contractid, EXTRACT(MONTH FROM "periodMonth")::int AS month, CAST(SUM("totalCost") AS TEXT) AS total
      FROM uniform_expenses
      WHERE EXTRACT(YEAR FROM "periodMonth") = ${year} AND "contractId" IN (${Prisma.join(ids)})
      GROUP BY 1, 2`,

    prisma.$queryRaw<RawRow[]>`
      SELECT "contractId" as contractid, EXTRACT(MONTH FROM "findingDate")::int AS month, CAST(SUM("totalCost") AS TEXT) AS total
      FROM audit_findings
      WHERE EXTRACT(YEAR FROM "findingDate") = ${year} AND "contractId" IN (${Prisma.join(ids)}) AND status = 'PENDING'
      GROUP BY 1, 2`,

    prisma.$queryRaw<RawRow[]>`
      SELECT dd."contractId" as contractid, EXTRACT(MONTH FROM de."periodMonth")::int AS month, CAST(SUM(dd."allocatedAmount") AS TEXT) AS total
      FROM deferred_distributions dd
      JOIN deferred_expenses de ON de.id = dd."deferredExpenseId"
      WHERE EXTRACT(YEAR FROM de."periodMonth") = ${year} AND dd."contractId" IN (${Prisma.join(ids)})
      GROUP BY 1, 2`,

    prisma.$queryRaw<RawRow[]>`
      SELECT ad."contractId" as contractid, EXTRACT(MONTH FROM ae."periodMonth")::int AS month, CAST(SUM(ad."allocatedAmount") AS TEXT) AS total
      FROM admin_distributions ad
      JOIN admin_expenses ae ON ae.id = ad."adminExpenseId"
      WHERE EXTRACT(YEAR FROM ae."periodMonth") = ${year} AND ad."contractId" IN (${Prisma.join(ids)})
      GROUP BY 1, 2`,

    prisma.$queryRaw<RawRow[]>`
      SELECT "contractId" as contractid, EXTRACT(MONTH FROM "periodMonth")::int AS month, CAST(SUM(amount) AS TEXT) AS total
      FROM expenses
      WHERE EXTRACT(YEAR FROM "periodMonth") = ${year} AND "contractId" IN (${Prisma.join(ids)}) AND "isDeferred" = false
      GROUP BY 1, 2`,

    prisma.$queryRaw<RawRow[]>`
      SELECT ed."contractId" as contractid, EXTRACT(MONTH FROM e."periodMonth")::int AS month, CAST(SUM(ed."allocatedAmount") AS TEXT) AS total
      FROM expense_distributions ed
      JOIN expenses e ON e.id = ed."expenseId"
      WHERE EXTRACT(YEAR FROM e."periodMonth") = ${year} AND ed."contractId" IN (${Prisma.join(ids)})
      GROUP BY 1, 2`,

    prisma.$queryRaw<RawLineRow[]>`
      SELECT "contractId" as contractid, EXTRACT(MONTH FROM "periodMonth")::int AS month,
        COALESCE("budgetLine"::text, 'NULL') AS bl,
        CAST(SUM(amount) AS TEXT) AS total
      FROM expenses
      WHERE EXTRACT(YEAR FROM "periodMonth") = ${year} AND "contractId" IN (${Prisma.join(ids)}) AND "isDeferred" = false
      GROUP BY 1, 2, 3`,

    prisma.$queryRaw<RawLineRow[]>`
      SELECT ed."contractId" as contractid, EXTRACT(MONTH FROM e."periodMonth")::int AS month,
        COALESCE(e."budgetLine"::text, 'NULL') AS bl,
        CAST(SUM(ed."allocatedAmount") AS TEXT) AS total
      FROM expense_distributions ed
      JOIN expenses e ON e.id = ed."expenseId"
      WHERE EXTRACT(YEAR FROM e."periodMonth") = ${year} AND ed."contractId" IN (${Prisma.join(ids)})
      GROUP BY 1, 2, 3`,

    prisma.billingHistory.findMany({
      where: { contractId: { in: ids } },
      select: { contractId: true, periodMonth: true, monthlyBilling: true },
      orderBy: { periodMonth: "asc" },
    }),
  ]);

  const uniformsMap = buildMap(uniforms);
  const auditsMap = buildMap(audits);
  const deferredMap = buildMap(deferred);
  const adminMap = buildMap(admin);
  const directMap = buildMap(direct);
  const expDistMap = buildMap(expDist);

  const directLineMap = buildLineMap(directByLine);
  const distLineMap = buildLineMap(distByLine);

  const billingHistoryByContract = new Map<
    string,
    { periodMonth: Date; monthlyBilling: (typeof billingHistRows)[number]["monthlyBilling"] }[]
  >();
  for (const h of billingHistRows) {
    if (!billingHistoryByContract.has(h.contractId)) {
      billingHistoryByContract.set(h.contractId, []);
    }
    billingHistoryByContract.get(h.contractId)!.push({
      periodMonth: h.periodMonth,
      monthlyBilling: h.monthlyBilling,
    });
  }

  const rows: AnnualReportRow[] = contracts.map((c) => {
    const defaultBilling = parseFloat(c.monthlyBilling.toString());
    const supPctEff = effectiveSuppliesPct(c);
    const laborPct = parseFloat(c.laborPct.toString());
    const adminPct = parseFloat(c.adminPct.toString());

    const contractStart = new Date(c.startDate);
    const contractEnd = new Date(c.endDate);

    const billingHistForContract = billingHistoryByContract.get(c.id) ?? [];

    const months: MonthCell[] = Array.from({ length: 12 }, (_, i) => {
      const mo = i + 1;
      const monthStart = new Date(year, i, 1);
      const monthEnd = new Date(year, i + 1, 0);
      const contractActive = contractStart <= monthEnd && contractEnd >= monthStart;

      /** Misma regla que rentabilidad mensual: cada cambio en historial vale desde ese mes hasta el siguiente cambio. */
      const billing = getEffectiveMonthlyBilling(defaultBilling, billingHistForContract, monthStart);

      const uniformsM = uniformsMap.get(c.id)?.get(mo) ?? 0;
      const auditM = auditsMap.get(c.id)?.get(mo) ?? 0;
      const deferredM = deferredMap.get(c.id)?.get(mo) ?? 0;
      const adminM = adminMap.get(c.id)?.get(mo) ?? 0;

      const laborU = getLine(directLineMap, c.id, mo, "LABOR") + getLine(distLineMap, c.id, mo, "LABOR");
      const supU = getLine(directLineMap, c.id, mo, "SUPPLIES") + getLine(distLineMap, c.id, mo, "SUPPLIES");
      const admU = getLine(directLineMap, c.id, mo, "ADMIN") + getLine(distLineMap, c.id, mo, "ADMIN");
      const unassignedU =
        (directLineMap.get(c.id)?.get(mo)?.get("NULL") ?? 0) +
        (distLineMap.get(c.id)?.get(mo)?.get("NULL") ?? 0);

      const laborSpend = laborU;
      const suppliesSpendTotal = supU + uniformsM + deferredM;
      const adminSpendTotal = admU + auditM + adminM;

      const totalExpenses =
        (directMap.get(c.id)?.get(mo) ?? 0) +
        (expDistMap.get(c.id)?.get(mo) ?? 0) +
        uniformsM +
        auditM +
        deferredM +
        adminM;

      const laborB = contractActive ? billing * laborPct : 0;
      const supB = contractActive ? billing * supPctEff : 0;
      const admB = contractActive ? billing * adminPct : 0;

      const hasData = contractActive || totalExpenses > 0;

      let lineBudget: number;
      let surplus: number;
      let trafficLight: TrafficLight;
      let partidaAllDetail: MonthCell["partidaAllDetail"];

      if (partida === "ALL") {
        // Presupuesto mostrado = MO + Insumos + Adm. (sin utilidad). Resultado del mes = ese total − gastos totales
        // del mes (coherente con KPI anual: suma de presupuestos − suma de gastos). El semáforo sigue usando el
        // mayor % de ejecución entre líneas (cuello de botella).
        lineBudget = laborB + supB + admB;
        surplus = lineBudget - totalExpenses;
        const maxUsage = Math.max(
          laborB > 0 ? laborSpend / laborB : 0,
          supB > 0 ? suppliesSpendTotal / supB : 0,
          admB > 0 ? adminSpendTotal / admB : 0
        );
        trafficLight =
          hasData && (laborB > 0 || supB > 0 || admB > 0)
            ? calcTrafficLight(maxUsage)
            : "GREEN";
        partidaAllDetail = {
          laborBudget: laborB,
          suppliesBudget: supB,
          adminBudget: admB,
          laborSpend,
          suppliesSpend: suppliesSpendTotal,
          adminSpend: adminSpendTotal,
          unassignedSpend: unassignedU,
        };
      } else if (partida === "LABOR") {
        lineBudget = laborB;
        surplus = laborB > 0 ? laborB - laborSpend : 0;
        trafficLight =
          hasData && laborB > 0 ? calcTrafficLight(laborSpend / laborB) : "GREEN";
      } else if (partida === "SUPPLIES") {
        lineBudget = supB;
        surplus = supB > 0 ? supB - suppliesSpendTotal : 0;
        trafficLight =
          hasData && supB > 0 ? calcTrafficLight(suppliesSpendTotal / supB) : "GREEN";
      } else {
        lineBudget = admB;
        surplus = admB > 0 ? admB - adminSpendTotal : 0;
        trafficLight =
          hasData && admB > 0 ? calcTrafficLight(adminSpendTotal / admB) : "GREEN";
      }

      const cellTotalExpenses =
        partida === "ALL"
          ? totalExpenses
          : partida === "LABOR"
            ? laborSpend
            : partida === "SUPPLIES"
              ? suppliesSpendTotal
              : adminSpendTotal;

      return {
        month: mo,
        monthlyBilling: contractActive ? billing : 0,
        lineBudget,
        totalExpenses: cellTotalExpenses,
        surplus,
        hasData,
        trafficLight,
        ...(partida === "ALL" ? { partidaAllDetail } : {}),
      };
    });

    const annualBudget = months.reduce((s, m) => s + (m.hasData ? m.lineBudget : 0), 0);
    const annualExpenses = months.reduce((s, m) => s + m.totalExpenses, 0);
    const annualSurplus = months.reduce((s, m) => s + m.surplus, 0);
    return {
      contractId: c.id,
      licitacionNo: c.licitacionNo,
      company: c.company,
      client: c.client,
      status: c.status,
      months,
      annualBudget,
      annualExpenses,
      annualSurplus,
    };
  });

  const monthlyTotals = Array.from({ length: 12 }, (_, i) => {
    const mo = i + 1;
    return {
      month: mo,
      budget: rows.reduce((s, r) => s + r.months[i].lineBudget, 0),
      expenses: rows.reduce((s, r) => s + r.months[i].totalExpenses, 0),
      surplus: rows.reduce((s, r) => s + r.months[i].surplus, 0),
    };
  });

  return {
    year,
    partida,
    rows,
    monthlyTotals,
    grandBudget: rows.reduce((s, r) => s + r.annualBudget, 0),
    grandExpenses: rows.reduce((s, r) => s + r.annualExpenses, 0),
    grandSurplus: rows.reduce((s, r) => s + r.annualSurplus, 0),
  };
}
