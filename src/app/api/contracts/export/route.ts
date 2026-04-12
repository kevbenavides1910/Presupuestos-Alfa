import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/api/middleware";
import { unauthorized } from "@/lib/api/response";
import { getGlobalPartidaTotals } from "@/lib/business/equivalence";
import { autoExpireContracts } from "@/lib/business/autoExpire";
import { buildContractListWhere } from "@/lib/server/contracts-list-where";
import { enrichContractsListRows } from "@/lib/server/contracts-list-enrichment";
import { COMPANY_LABELS, CONTRACT_STATUS_LABELS, CLIENT_TYPE_LABELS } from "@/lib/utils/constants";
import type { CompanyName, ContractStatus, ClientType } from "@prisma/client";

const EXPORT_MAX = 10_000;

function fmtDate(v: Date | string): string {
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return unauthorized();

  await autoExpireContracts();

  const { searchParams } = new URL(req.url);
  const where = buildContractListWhere(session, searchParams);

  const [contracts, globalTotals] = await Promise.all([
    prisma.contract.findMany({
      where,
      orderBy: [{ company: "asc" }, { client: "asc" }],
      take: EXPORT_MAX,
    }),
    getGlobalPartidaTotals(new Date()),
  ]);

  const ids = contracts.map((c) => c.id);
  const allHistory =
    ids.length > 0
      ? await prisma.billingHistory.findMany({
          where: { contractId: { in: ids } },
          select: { contractId: true, periodMonth: true, monthlyBilling: true },
        })
      : [];

  const asOf = new Date();
  const rows = enrichContractsListRows(contracts, allHistory, globalTotals, asOf);

  const header = [
    "Licitación",
    "Cliente",
    "Empresa",
    "Tipo cliente",
    "Oficiales",
    "Puestos",
    "Facturación mensual (efectiva)",
    "M.O. ₡",
    "M.O. %",
    "Insumos ₡",
    "Insumos %",
    "Adm. ₡",
    "Adm. %",
    "Utilidad ₡",
    "Utilidad %",
    "Part. glob. facturación %",
    "Part. glob. M.O. %",
    "Part. glob. insumos %",
    "Part. glob. adm. %",
    "Part. glob. utilidad %",
    "Estado",
    "Inicio",
    "Vencimiento",
    "Notas",
  ];

  const dataRows = rows.map((c) => {
    const company = c.company as CompanyName;
    const status = c.status as ContractStatus;
    const ct = c.clientType as ClientType;
    return [
      c.licitacionNo,
      c.client,
      COMPANY_LABELS[company] ?? company,
      CLIENT_TYPE_LABELS[ct] ?? ct,
      c.officersCount,
      c.positionsCount,
      Math.round(c.monthlyBilling * 100) / 100,
      Math.round(c.laborBudget * 100) / 100,
      Math.round(c.laborPct * 10000) / 100,
      Math.round(c.suppliesBudget * 100) / 100,
      Math.round(c.suppliesBudgetPct * 10000) / 100,
      Math.round(c.adminBudget * 100) / 100,
      Math.round(c.adminPct * 10000) / 100,
      Math.round(c.profitBudget * 100) / 100,
      Math.round(c.profitPct * 10000) / 100,
      status === "ACTIVE" || status === "PROLONGATION"
        ? Math.round(c.billingSharePct * 10000) / 100
        : "",
      status === "ACTIVE" || status === "PROLONGATION"
        ? Math.round(c.laborSharePct * 10000) / 100
        : "",
      status === "ACTIVE" || status === "PROLONGATION"
        ? Math.round(c.suppliesSharePct * 10000) / 100
        : "",
      status === "ACTIVE" || status === "PROLONGATION"
        ? Math.round(c.adminSharePct * 10000) / 100
        : "",
      status === "ACTIVE" || status === "PROLONGATION"
        ? Math.round(c.profitSharePct * 10000) / 100
        : "",
      CONTRACT_STATUS_LABELS[status] ?? status,
      fmtDate(c.startDate),
      fmtDate(c.endDate),
      (c.notes ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
    ];
  });

  const aoa = [header, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = header.map((h) => ({ wch: Math.min(Math.max(String(h).length + 2, 12), 40) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Contratos");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date();
  const fname = `contratos_${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}.xlsx`;

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "X-Export-Row-Count": String(dataRows.length),
    },
  });
}
