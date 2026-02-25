import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { compare, hash } from "bcryptjs";
import {
  getUserByEmail,
  getUserByExternalSub,
  createUser,
  updateUserPassword,
  getUserCount,
  getEnabledAuthProviders,
} from "@/lib/db";

const LOCAL_SALT_ROUNDS = 12;

/**
 * Build NextAuth options dynamically — OAuth providers are read from the DB
 * each time this function is called so admin changes take effect immediately.
 */
export function getAuthOptions(): NextAuthOptions {
  const oauthProviders: NextAuthOptions["providers"] = [];

  try {
    const dbProviders = getEnabledAuthProviders();
    for (const p of dbProviders) {
      if (p.provider_type === "azure-ad" && p.client_id && p.client_secret && p.tenant_id) {
        oauthProviders.push(
          AzureADProvider({
            clientId: p.client_id,
            clientSecret: p.client_secret,
            tenantId: p.tenant_id,
          })
        );
      } else if (p.provider_type === "google" && p.client_id && p.client_secret) {
        oauthProviders.push(
          GoogleProvider({
            clientId: p.client_id,
            clientSecret: p.client_secret,
          })
        );
      }
      // 'discord' type is not an OAuth login provider — it's for the bot gateway
    }
  } catch {
    // DB may not be initialized yet during first import — skip
  }

  return {
    providers: [
      CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const existing = getUserByEmail(credentials.email);

        // New user signup: first user becomes admin, subsequent users become regular users
        if (!existing) {
          // Check if open registration is disabled
          if (process.env.DISABLE_REGISTRATION === "true" && getUserCount() > 0) {
            return null; // Registration disabled — reject new signups
          }
          const isFirst = getUserCount() === 0;
          const passwordHash = await hash(credentials.password, LOCAL_SALT_ROUNDS);
          const user = createUser({
            email: credentials.email,
            providerId: "local",
            externalSubId: null,
            passwordHash,
            role: isFirst ? "admin" : "user",
          });
          return { id: user.id, email: user.email, name: user.display_name };
        }

        // Existing user — verify password
        if (existing.provider_id !== "local" || !existing.password_hash) {
          return null;
        }

        const valid = await compare(credentials.password, existing.password_hash);
        if (!valid) {
          return null;
        }

        return { id: existing.id, email: existing.email, name: existing.display_name };
      },
    }),
    ...oauthProviders,
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

      const providerId = account.provider === "azure-ad" ? "azure-ad" : "google";
      const subId = account.providerAccountId;

      // Check if user already exists by external sub
      const existingBySub = getUserByExternalSub(subId);
      if (existingBySub) {
        // Returning user
        return true;
      }

      // Check if user exists by email (may have signed up with another method)
      const existingByEmail = getUserByEmail(user.email);
      if (existingByEmail) {
        // Allow sign-in if same email, even if different provider
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

      return true;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).id = token.userId;
        (session.user as Record<string, unknown>).role = token.role;
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
        const byEmail = getUserByEmail(token.email as string);
        if (byEmail) {
          token.userId = byEmail.id;
        }
      }

      // Fetch role from DB on every token refresh
      if (token.userId) {
        const { getUserById, isUserEnabled } = await import("@/lib/db");
        const dbUser = getUserById(token.userId as string);
        if (dbUser) {
          token.role = dbUser.role ?? "user";
          // Block disabled users
          if (!isUserEnabled(token.userId as string)) {
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
  };
}

/** Cached snapshot for use in guards (avoids re-reading DB on every call within the same request) */
export const authOptions: NextAuthOptions = getAuthOptions();
