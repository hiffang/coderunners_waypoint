import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/server/db";
import { rateLimit } from "@/server/auth/rate-limit";
import type { Role } from "@/shared/roles";

const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // one working shift

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;

        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
        if (!rateLimit(`login:${ip}`, 20, 15 * 60_000) || !rateLimit(`login:u:${username}`, 8, 15 * 60_000)) {
          throw new RateLimited();
        }

        const user = await db.user.findUnique({ where: { username } });
        // Compare against a dummy hash when the user is missing to keep timing flat.
        const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !user.active || !ok) return null;

        return {
          id: user.id,
          name: user.displayName,
          username: user.username,
          role: user.role,
          depotId: user.depotId,
          outletId: user.outletId,
          vehicleId: user.vehicleId,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id!;
        token.username = user.username;
        token.role = user.role;
        token.depotId = user.depotId ?? null;
        token.outletId = user.outletId ?? null;
        token.vehicleId = user.vehicleId ?? null;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid;
      session.user.username = token.username;
      session.user.role = token.role;
      session.user.depotId = token.depotId;
      session.user.outletId = token.outletId;
      session.user.vehicleId = token.vehicleId;
      return session;
    },
  },
});

// Hash of a random throwaway string; never matches any real password.
const DUMMY_HASH = "$2b$10$2ZLgYfVQNg0h..2KrU/B5unYcW38Egbvn56JE6CD.Lnmes2YBU9IK";

declare module "next-auth" {
  interface User {
    username: string;
    role: Role;
    depotId?: string | null;
    outletId?: string | null;
    vehicleId?: string | null;
  }
  interface Session {
    user: {
      id: string;
      name?: string | null;
      username: string;
      role: Role;
      depotId: string | null;
      outletId: string | null;
      vehicleId: string | null;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid: string;
    username: string;
    role: Role;
    depotId: string | null;
    outletId: string | null;
    vehicleId: string | null;
  }
}
