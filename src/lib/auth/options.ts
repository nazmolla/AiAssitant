import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { compare, hash } from "bcryptjs";
import { upsertIdentity, getIdentity } from "@/lib/db";

const LOCAL_OWNER_SUB = "local-owner";
const LOCAL_SALT_ROUNDS = 12;

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Owner Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const identity = getIdentity();

        // First-time local signup becomes the sovereign owner.
        if (!identity) {
          const passwordHash = await hash(credentials.password, LOCAL_SALT_ROUNDS);
          upsertIdentity({
            email: credentials.email,
            providerId: "local",
            subId: LOCAL_OWNER_SUB,
            passwordHash,
          });
          return { id: LOCAL_OWNER_SUB, email: credentials.email };
        }

        if (identity.provider_id !== "local" || !identity.password_hash) {
          return null;
        }

        if (identity.owner_email.toLowerCase() !== credentials.email.toLowerCase()) {
          return null;
        }

        const valid = await compare(credentials.password, identity.password_hash);
        if (!valid) {
          return null;
        }

        return { id: identity.external_sub_id ?? LOCAL_OWNER_SUB, email: identity.owner_email };
      },
    }),
    ...(process.env.AZURE_AD_CLIENT_ID
      ? [
          AzureADProvider({
            clientId: process.env.AZURE_AD_CLIENT_ID!,
            clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
            tenantId: process.env.AZURE_AD_TENANT_ID!,
          }),
        ]
      : []),
    ...(process.env.GOOGLE_CLIENT_ID
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user?.email) return false;

      const existing = getIdentity();

      if (account?.provider === "credentials") {
        // Credentials provider already validated password & bootstrap owner record
        return existing?.provider_id === "local";
      }

      if (!account?.providerAccountId) {
        return false;
      }

      const providerId = account.provider === "azure-ad" ? "azure-ad" : "google";
      const subId = account.providerAccountId;

      if (!existing) {
        upsertIdentity({ email: user.email, providerId, subId });
        return true;
      }

      return existing.external_sub_id === subId;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).sub = token.sub;
      }
      return session;
    },
    async jwt({ token, account, user }) {
      if (account?.provider === "credentials" && user) {
        token.sub = (user as Record<string, unknown>).id as string;
      } else if (account) {
        token.sub = account.providerAccountId;
      }
      const identity = getIdentity();
      if (identity?.external_sub_id) {
        (token as Record<string, unknown>).ownerSub = identity.external_sub_id;
      } else if (identity?.provider_id === "local") {
        (token as Record<string, unknown>).ownerSub = LOCAL_OWNER_SUB;
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
