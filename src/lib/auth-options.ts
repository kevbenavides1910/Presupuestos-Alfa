import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: UserRole;
      company: string | null;
    };
  }
  interface User {
    role: UserRole;
    company: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    company: string | null;
  }
}

/** En dev, un secret fijo si falta en .env evita JWT inválidos y sesiones que no “pegan”. En producción debe existir NEXTAUTH_SECRET. */
function resolveAuthSecret(): string | undefined {
  const fromEnv = process.env.NEXTAUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "development") {
    return "presupuestos-alfa-dev-nextauth-secret-not-for-production";
  }
  return undefined;
}

/**
 * Solo usar cookies "Secure" cuando la app realmente se sirve por HTTPS.
 * Si está detrás de Nginx/Caddy con TLS, NEXTAUTH_URL debe empezar con https://.
 * Si se accede por HTTP plano (ej. http://IP:3000) hay que dejarlas no-secure
 * porque el navegador descarta cookies Secure en conexiones HTTP y nunca se loguea.
 */
function shouldUseSecureCookies(): boolean {
  const url = process.env.NEXTAUTH_URL?.trim().toLowerCase();
  if (!url) return false;
  return url.startsWith("https://");
}

export const authOptions: NextAuthOptions = {
  // JWT + credenciales: no hace falta PrismaAdapter; evita que NextAuth toque la BD en rutas como /api/auth/session.
  secret: resolveAuthSecret(),
  useSecureCookies: shouldUseSecureCookies(),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          const user = await prisma.user.findUnique({
            where: { email: credentials.email },
          });

          if (!user || !user.passwordHash || !user.isActive) return null;

          const valid = await bcrypt.compare(credentials.password, user.passwordHash);
          if (!valid) return null;

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role as UserRole,
            company: user.company,
          };
        } catch (e) {
          console.error("[next-auth authorize]", e);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.id = user.id;
        token.role = user.role;
        token.company = user.company;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        const uid = (typeof token.id === "string" && token.id ? token.id : null) ?? (token.sub as string | undefined);
        if (uid) session.user.id = uid;
        session.user.role = token.role;
        session.user.company = token.company ?? null;
      }
      return session;
    },
  },
};
