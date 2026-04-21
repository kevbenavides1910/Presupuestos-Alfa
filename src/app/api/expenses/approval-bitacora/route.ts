import { NextRequest } from "next/server";
import type { ExpenseApprovalDecision, ExpenseApprovalStatus, ExpenseType } from "@prisma/client";
import { getSession } from "@/lib/api/middleware";
import { ok, unauthorized, serverError } from "@/lib/api/response";
import {
  listApproverOptionsForBitacora,
  listExpenseApprovalBitacora,
  type BitacoraMode,
} from "@/lib/server/expense-approval-bitacora";

const APPROVAL_DECISIONS = ["APPROVED", "REJECTED"] as const;
const APPROVAL_STATUSES = [
  "PENDING_APPROVAL",
  "PARTIALLY_APPROVED",
  "APPROVED",
  "REJECTED",
] as const;
const EXPENSE_TYPES = [
  "APERTURA",
  "UNIFORMS",
  "AUDIT",
  "ADMIN",
  "TRANSPORT",
  "FUEL",
  "PHONES",
  "PLANILLA",
  "OTHER",
] as const;

function parseMode(v: string | null): BitacoraMode {
  return v === "submissions" ? "submissions" : "decisions";
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { searchParams } = new URL(req.url);
    if (searchParams.get("meta") === "approvers") {
      const approvers = await listApproverOptionsForBitacora(session);
      return ok({ approvers });
    }

    const mode = parseMode(searchParams.get("mode"));
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") ?? "25", 10);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const approverUserId = searchParams.get("approverUserId");
    const decisionRaw = searchParams.get("decision");
    const decision =
      decisionRaw && (APPROVAL_DECISIONS as readonly string[]).includes(decisionRaw)
        ? (decisionRaw as ExpenseApprovalDecision)
        : null;
    const company = searchParams.get("company");
    const typeRaw = searchParams.get("type");
    const type =
      typeRaw && (EXPENSE_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as ExpenseType) : null;
    const statusRaw = searchParams.get("approvalStatus");
    const approvalStatus =
      statusRaw && (APPROVAL_STATUSES as readonly string[]).includes(statusRaw)
        ? (statusRaw as ExpenseApprovalStatus)
        : null;
    const q = searchParams.get("q");

    const result = await listExpenseApprovalBitacora(session, {
      mode,
      page,
      pageSize,
      from,
      to,
      approverUserId: approverUserId || null,
      decision,
      company: company || null,
      type,
      approvalStatus,
      q: q || null,
    });

    return ok(result);
  } catch (e) {
    return serverError("Error al cargar bitácora de aprobaciones", e);
  }
}
