import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import GoogleProvider from "next-auth/providers/google";
import { upsertIdentity, getIdentity } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  providers: [
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
      if (!account || !user.email) return false;

      const providerId = account.provider === "azure-ad" ? "azure-ad" : "google";
      const subId = account.providerAccountId;

      const existing = getIdentity();

      // First user becomes the owner (sovereign identity-lock)
      if (!existing) {
        upsertIdentity(user.email, providerId, subId);
        return true;
      }

      // Subsequent logins: only the owner can access
      if (existing.external_sub_id === subId) {
        return true;
      }

      // Deny all other users
      return false;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).sub = token.sub;
      }
      return session;
    },
    async jwt({ token, account }) {
      if (account) {
        token.sub = account.providerAccountId;
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
