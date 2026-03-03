import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/guard";
import { getMcpServer, upsertMcpServer, type McpServerRecord } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * OAuth callback handler. Receives the authorization code from the OAuth provider
 * (e.g., Home Assistant), exchanges it for an access token, stores it in the DB,
 * then redirects back to the UI.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { serverId: string } }
) {
  // Require authentication on the callback
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const appBaseUrl = new URL(req.url).origin;
  const uiRedirect = (extra: string) =>
    NextResponse.redirect(`${appBaseUrl}?tab=mcp&${extra}`);

  if (error) {
    return uiRedirect(`oauth_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return uiRedirect(`oauth_error=${encodeURIComponent("No authorization code received")}`);
  }

  // Validate state
  const storedState = req.cookies.get(`mcp_oauth_state_${params.serverId}`)?.value;
  if (!storedState || storedState !== state) {
    return uiRedirect(`oauth_error=${encodeURIComponent("Invalid OAuth state (CSRF check failed)")}`);
  }

  const server = getMcpServer(params.serverId);
  if (!server) {
    return uiRedirect(`oauth_error=${encodeURIComponent("Server not found")}`);
  }

  if (!server.url) {
    return uiRedirect(`oauth_error=${encodeURIComponent("Server URL missing")}`);
  }

  try {
    // Derive token endpoint from server URL
    const serverUrl = new URL(server.url);
    const baseUrl = `${serverUrl.protocol}//${serverUrl.host}`;
    const tokenUrl = `${baseUrl}/auth/token`;

    const redirectUri = `${appBaseUrl}/api/mcp/${params.serverId}/oauth/callback`;
    const clientId = server.client_id || appBaseUrl;

    // Exchange authorization code for access token
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        ...(server.client_secret ? { client_secret: server.client_secret } : {}),
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Token exchange failed (${tokenRes.status}): ${text}`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error("No access_token in token response");
    }

    // Update the server record with the obtained access token
    upsertMcpServer({
      ...server,
      auth_type: "bearer", // After OAuth, we use the token as bearer
      access_token: accessToken,
    } as McpServerRecord);

    // Clear the state cookie
    const response = uiRedirect(
      `oauth_server_id=${params.serverId}&oauth_token=ok`
    );
    response.cookies.delete(`mcp_oauth_state_${params.serverId}`);
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return uiRedirect(`oauth_error=${encodeURIComponent(msg)}`);
  }
}
