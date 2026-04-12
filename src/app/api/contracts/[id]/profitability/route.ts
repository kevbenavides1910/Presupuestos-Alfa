import { NextRequest } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, notFound, serverError } from "@/lib/api/response";
import { getContractProfitability, mergeLegacyForReportPartida } from "@/lib/business/profitability";
import { prisma } from "@/lib/prisma";
import { fromMonthString } from "@/lib/utils/format";
import { parseReportPartida } from "@/lib/utils/constants";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id } = await params;
  const contract = await prisma.contract.findFirst({
    where: { id, deletedAt: null },
  });
  if (!contract) return notFound();

  try {
    const { searchParams } = new URL(req.url);
    const monthStr = searchParams.get("month");
    const periodMonth = monthStr ? fromMonthString(monthStr) : undefined;
    const partida = parseReportPartida(searchParams.get("partida"));

    const result = await getContractProfitability(id, periodMonth, partida);
    const expensesByTypeMerged = mergeLegacyForReportPartida(result, partida);
    return ok({ ...result, expensesByTypeMerged, partida });
  } catch (e) {
    return serverError("Error calculando rentabilidad", e);
  }
}
