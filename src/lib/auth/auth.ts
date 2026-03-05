import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

const LOCAL_SALT_ROUNDS = 12;

/**
 * Build NextAuth v5 config dynamically — OAuth providers are read from the DB
 * each time this function is called so admin changes take effect immediately.
 *
 * All heavy imports (DB, bcryptjs, etc.) use dynamic import() so that
 * this module stays Edge-compatible for middleware (which only reads JWTs).
 */
export function buildAuthConfig(): NextAuthConfig {
  // Dynamic provider loading is deferred to the Credentials authorize/signIn
  // callbacks — at module parse time we only register a static Credentials provider.
  // OAuth providers are loaded dynamically in the route handler (see [...nextauth]/route.ts).
  return {
    providers: [
      Credentials({
        name: "Credentials",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
          const email = credentials?.email as string | undefined;
          const password = credentials?.password as string | undefined;
          if (!email || !password) {
            return null;
          }

          const { compare, hash } = await import("bcryptjs");
          const { getUserByEmail, getUserCount, createUser, isUserEnabled } = await import("@/lib/db");
          const { validatePassword } = await import("@/lib/auth/password-policy");

          const existing = getUserByEmail(email);

          // New user signup: first user becomes admin, subsequent users become regular users
          if (!existing) {
            // Check if open registration is disabled
            if (process.env.DISABLE_REGISTRATION === "true" && getUserCount() > 0) {
              return null; // Registration disabled — reject new signups
            }
            // Enforce password policy on signup
            const policy = validatePassword(password);
            if (!policy.valid) {
              throw new Error(policy.message);
            }
            const isFirst = getUserCount() === 0;
            const passwordHash = await hash(password, LOCAL_SALT_ROUNDS);
            const user = createUser({
              email,
              providerId: "local",
              externalSubId: null,
              passwordHash,
              role: isFirst ? "admin" : "user",
            });
            // Non-admin users start inactive — they must be activated by an admin
            if (!isFirst) {
              throw new Error("ACCOUNT_PENDING");
            }
            return { id: user.id, email: user.email, name: user.display_name };
          }

          // Existing user — verify password
          if (existing.provider_id !== "local" || !existing.password_hash) {
            return null;
          }

          const valid = await compare(password, existing.password_hash);
          if (!valid) {
            return null;
          }

          // Block disabled/inactive users at sign-in
          if (!isUserEnabled(existing.id)) {
            throw new Error("ACCOUNT_PENDING");
          }

          return { id: existing.id, email: existing.email, name: existing.display_name };
        },
      }),
    ],
    callbacks: {
      async signIn({ user, account }) {
        if (!user?.email) return false;

        if (account?.provider === "credentials") {
          // Credentials provider already handled user creation/validation in authorize()
          return true;
        }

        // OAuth providers (Azure AD, Google)
        if (!account?.providerAccountId) return false;

        const { getUserByExternalSub, getUserByEmail, getUserCount, createUser, isUserEnabled } = await import("@/lib/db");

        const providerId = account.provider === "azure-ad" ? "azure-ad" : "google";
        const subId = account.providerAccountId;

        // Check if user already exists by external sub
        const existingBySub = getUserByExternalSub(subId);
        if (existingBySub) {
          // Block disabled/inactive users
          if (!isUserEnabled(existingBySub.id)) return false;
          return true;
        }

        // Check if user exists by email (may have signed up with another method)
        const existingByEmail = getUserByEmail(user.email);
        if (existingByEmail) {
          // Block disabled/inactive users
          if (!isUserEnabled(existingByEmail.id)) return false;
          return true;
        }

        // New OAuth user — create account
        if (process.env.DISABLE_REGISTRATION === "true" && getUserCount() > 0) {
          return false; // Registration disabled
        }
        const isFirst = getUserCount() === 0;
        createUser({
          email: user.email,
          displayName: user.name || undefined,
          providerId,
          externalSubId: subId,
          role: isFirst ? "admin" : "user",
        });

        // Non-admin users start inactive — reject sign-in until admin activates
        if (!isFirst) return false;

        return true;
      },
      async session({ session, token }) {
        if (session.user) {
          (session.user as unknown as Record<string, unknown>).id = token.userId;
          (session.user as unknown as Record<string, unknown>).role = token.role;
        }
        return session;
      },
      async jwt({ token, account, user }) {
        // On first sign-in, resolve the userId from the users table
        if (user) {
          if (account?.provider === "credentials") {
            // user.id is already our users.id from authorize()
            token.userId = user.id;
          } else if (account?.providerAccountId) {
            const { getUserByExternalSub, getUserByEmail } = await import("@/lib/db");
            // OAuth — look up by external sub or email
            const bySubId = getUserByExternalSub(account.providerAccountId);
            if (bySubId) {
              token.userId = bySubId.id;
            } else if (user.email) {
              const byEmail = getUserByEmail(user.email);
              if (byEmail) {
                token.userId = byEmail.id;
              }
            }
          }
        }

        // Backfill userId for existing sessions from before multi-user migration
        if (!token.userId && token.email) {
          const { getUserByEmail } = await import("@/lib/db");
          const byEmail = getUserByEmail(token.email as string);
          if (byEmail) {
            token.userId = byEmail.id;
          }
        }

        // Fetch role from DB on every token refresh
        if (token.userId) {
          const { getUserById, isUserEnabled: isEnabled } = await import("@/lib/db");
          const dbUser = getUserById(token.userId as string);
          if (dbUser) {
            token.role = dbUser.role ?? "user";
            // Block disabled users
            if (!isEnabled(token.userId as string)) {
              delete token.userId;
              delete token.role;
            }
          } else {
            // User was deleted (e.g. DB reinitialized) — clear stale session
            delete token.userId;
            delete token.role;
          }
        }

        return token;
      },
    },
    pages: {
      signIn: "/auth/signin",
      error: "/auth/error",
    },
    session: {
      strategy: "jwt",
    },
    trustHost: true,
  };
}

/** Default (cached) instance for session reading & middleware */
export const { handlers, auth, signIn, signOut } = NextAuth(buildAuthConfig());
