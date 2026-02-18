import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { getMcpServer } from "@/lib/db";

/**
 * Initiates the OAuth authorization flow for an MCP server.
 * Redirects the user to the server's OAuth authorization endpoint.
 * Supports Home Assistant IndieAuth (client_id = base URL, no secret).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { serverId: string } }
) {
  const denied = await requireOwner();
  if (denied) return denied;

  const server = getMcpServer(params.serverId);
  if (!server) {
    return NextResponse.json({ error: "MCP server not found." }, { status: 404 });
  }

  if (!server.url) {
    return NextResponse.json({ error: "Server URL is required for OAuth." }, { status: 400 });
  }

  // Derive the OAuth endpoints from the server URL
  // For Home Assistant: base is e.g. https://homeassistant.local:8123
  const serverUrl = new URL(server.url);
  const baseUrl = `${serverUrl.protocol}//${serverUrl.host}`;

  // Build our callback URL
  const appBaseUrl = new URL(req.url).origin;
  const redirectUri = `${appBaseUrl}/api/mcp/${params.serverId}/oauth/callback`;

  // Client ID: use stored client_id, or default to our app's base URL (IndieAuth convention)
  const clientId = server.client_id || appBaseUrl;

  // Generate a random state for CSRF protection
  const state = Math.random().toString(36).substring(2, 15);

  // Store state in a cookie for validation on callback
  const authUrl = new URL(`${baseUrl}/auth/authorize`);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set(`mcp_oauth_state_${params.serverId}`, state, {
    httpOnly: true,
    secure: false, // LAN deployment, allow HTTP
    maxAge: 600, // 10 minutes
    path: "/",
    sameSite: "lax",
  });

  return response;
}
