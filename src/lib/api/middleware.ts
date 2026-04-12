import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { UserRole } from "@prisma/client";
import { unauthorized, forbidden } from "./response";
import { NextRequest } from "next/server";
import { canModifyContracts, canManageExpenses, isAdmin } from "@/lib/permissions";

export { canModifyContracts, canManageExpenses, isAdmin };

type Handler<T = unknown> = (
  req: NextRequest,
  context: { session: Awaited<ReturnType<typeof getServerSession>>; params?: T }
) => Promise<Response>;

export function withAuth<T = unknown>(
  handler: Handler<T>,
  options: { roles?: UserRole[] } = {}
) {
  return async (req: NextRequest, ctx?: { params?: T }) => {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return unauthorized();
    }

    if (options.roles && !options.roles.includes(session.user.role)) {
      return forbidden();
    }

    return handler(req, { session, params: ctx?.params });
  };
}

export async function getSession() {
  return getServerSession(authOptions);
}

