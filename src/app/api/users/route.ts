import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdmin } from "@/lib/api/middleware";
import { ok, created, badRequest, unauthorized, forbidden, conflict, serverError } from "@/lib/api/response";
import { listUsersForAdmin } from "@/lib/server/list-users";
import { requireCompanyCode } from "@/lib/server/companies";
import bcrypt from "bcryptjs";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(2, "Nombre requerido"),
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres"),
  role: z.enum(["ADMIN", "SUPERVISOR", "COMPRAS", "COMMERCIAL", "CONSULTA"]),
  company: z.string().optional().nullable(),
});

export async function GET(_req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    if (!isAdmin(session.user.role)) return forbidden();

    const users = await listUsersForAdmin(prisma);

    return ok(users);
  } catch (e) {
    return serverError("Error al listar usuarios", e);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session.user.role)) return forbidden();

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return badRequest("Datos inválidos", parsed.error.flatten());

    const { name, email, password, role, company } = parsed.data;

    if (company) {
      const companyOk = await requireCompanyCode(prisma, company, { mustBeActive: true });
      if (!companyOk.ok) return badRequest(companyOk.message);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return conflict("Ya existe un usuario con ese email");

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: role as never,
        company: company || null,
        isActive: true,
      },
      select: { id: true, name: true, email: true, role: true, company: true, isActive: true, createdAt: true },
    });

    return created(user);
  } catch (e) {
    return serverError("Error al crear usuario", e);
  }
}
