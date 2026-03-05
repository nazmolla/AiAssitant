import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import { NextRequest } from "next/server";
import MicrosoftEntraId from "next-auth/providers/microsoft-entra-id";
import Google from "next-auth/providers/google";
import { buildAuthConfig } from "@/lib/auth/auth";
import { getEnabledAuthProviders } from "@/lib/db";

/**
 * Dynamic handler — rebuilds provider list from DB on each request
 * so admin changes to OAuth providers take effect immediately.
 */
function buildHandlers() {
  const config = buildAuthConfig();

  // Append OAuth providers loaded from DB
  const oauthProviders: NextAuthConfig["providers"] = [];
  try {
    const dbProviders = getEnabledAuthProviders();
    for (const p of dbProviders) {
      if (p.provider_type === "azure-ad" && p.client_id && p.client_secret && p.tenant_id) {
        oauthProviders.push(
          MicrosoftEntraId({
            id: "azure-ad",
            clientId: p.client_id,
            clientSecret: p.client_secret,
            issuer: `https://login.microsoftonline.com/${p.tenant_id}/v2.0`,
          })
        );
      } else if (p.provider_type === "google" && p.client_id && p.client_secret) {
        oauthProviders.push(
          Google({
            clientId: p.client_id,
            clientSecret: p.client_secret,
          })
        );
      }
    }
  } catch {
    // DB may not be initialized yet
  }

  return NextAuth({
    ...config,
    providers: [...(config.providers ?? []), ...oauthProviders],
  }).handlers;
}

export function GET(request: NextRequest) {
  return buildHandlers().GET(request);
}

export function POST(request: NextRequest) {
  return buildHandlers().POST(request);
}
