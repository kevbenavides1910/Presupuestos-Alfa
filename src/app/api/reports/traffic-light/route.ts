import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, serverError } from "@/lib/api/response";
import { getContractProfitability } from "@/lib/business/profitability";
import { fromMonthString } from "@/lib/utils/format";
import { autoExpireContracts } from "@/lib/business/autoExpire";
import { nowServer } from "@/lib/utils/time";
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { searchParams } = new URL(req.url);
  const company = searchParams.get("company");
  const month = searchParams.get("month");

  const where: Record<string, unknown> = {
    status: { notIn: ["CANCELLED", "FINISHED"] },
    deletedAt: null,
  };

  if (session.user.company) where.company = session.user.company;
  else if (company) where.company = company;

  try {
    await autoExpireContracts();

    const contracts = await prisma.contract.findMany({
      where,
      orderBy: [{ company: "asc" }, { client: "asc" }],
    });

    // Default to current month so the traffic light shows THIS month's execution,
    // not a cumulative total vs a single month's budget (which inflates %).
    const now = nowServer();
    const defaultMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodMonth = month ? fromMonthString(month) : defaultMonth;

    const results = await Promise.all(
      contracts.map(async (c) => {
        const { contractId: _cid, ...prof } = await getContractProfitability(c.id, periodMonth);
        return {
          contractId: c.id,
          licitacionNo: c.licitacionNo,
          company: c.company,
          client: c.client,
          clientType: c.clientType,
          status: c.status,
          startDate: c.startDate,
          endDate: c.endDate,
          officersCount: c.officersCount,
          positionsCount: c.positionsCount,
          ...prof,
        };
      })
    );

    // Group by traffic light
    const grouped = {
      GREEN: results.filter((r) => r.trafficLight === "GREEN"),
      YELLOW: results.filter((r) => r.trafficLight === "YELLOW"),
      RED: results.filter((r) => r.trafficLight === "RED"),
    };

    return ok({
      summary: {
        total: results.length,
        green: grouped.GREEN.length,
        yellow: grouped.YELLOW.length,
        red: grouped.RED.length,
        totalBilling: results.reduce((s, r) => s + r.monthlyBilling, 0),
        totalBudget: results.reduce((s, r) => s + r.suppliesBudget, 0),
        totalExpenses: results.reduce((s, r) => s + r.grandTotal, 0),
      },
      contracts: results,
      grouped,
    });
  } catch (e) {
    return serverError("Error generando reporte", e);
  }
}
