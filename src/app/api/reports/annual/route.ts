import { NextRequest } from "next/server";
import { getSession } from "@/lib/api/middleware";
import { ok, badRequest, unauthorized, serverError } from "@/lib/api/response";
import { getAnnualReport } from "@/lib/business/annualProfitability";
import { currentYearServer } from "@/lib/utils/time";
import { parseReportPartida } from "@/lib/utils/constants";
import { CompanyName } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { searchParams } = new URL(req.url);
  const yearStr = searchParams.get("year");
  const company = searchParams.get("company") as CompanyName | null;

  // If no year provided, default to current year on the server (respects TZ)
  const year = yearStr ? parseInt(yearStr) : currentYearServer();
  if (isNaN(year) || year < 2020 || year > 2100) return badRequest("Año inválido");

  const partida = parseReportPartida(searchParams.get("partida"));

  // Scope by company if user is company-scoped
  const companyFilter = session.user.company ?? company ?? undefined;

  try {
    const report = await getAnnualReport(year, companyFilter ?? undefined, partida);
    return ok(report);
  } catch (e) {
    return serverError("Error generando reporte anual", e);
  }
}
