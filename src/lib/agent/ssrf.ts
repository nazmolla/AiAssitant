/**
 * Shared SSRF protection with DNS-rebinding defence.
 *
 * 1. Validates the URL scheme (http/https only).
 * 2. Blocks well-known internal/cloud-metadata hostnames.
 * 3. If the hostname is already an IP literal, checks it directly.
 * 4. Otherwise resolves the hostname via DNS and checks ALL resolved IPs.
 *
 * This prevents DNS-rebinding attacks where a domain initially resolves to a
 * public IP during validation but then resolves to an internal IP during the
 * actual request (TOCTOU).  Callers should use the resolved IP returned by
 * `assertExternalUrlWithResolve()` to pin the connection.
 */

import * as dns from "dns";
import * as net from "net";

// ── Blocklists ────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.azure.com",
  "metadata.digitalocean.com",
  "instance-data",
]);

/**
 * Check if an IPv4 address is private/internal.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  return (
    parts[0] === 127 ||                                      // 127.0.0.0/8  loopback
    parts[0] === 10 ||                                       // 10.0.0.0/8   private
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // 172.16-31.x  private
    (parts[0] === 192 && parts[1] === 168) ||                // 192.168.x.x  private
    (parts[0] === 169 && parts[1] === 254) ||                // 169.254.x.x  link-local / cloud metadata
    parts[0] === 0                                           // 0.0.0.0
  );
}

/**
 * Check if an IPv6 address is private/internal.
 */
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fe80") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized === "::" ||
    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    (normalized.startsWith("::ffff:") && isPrivateIPv4(normalized.slice(7)))
  );
}

/**
 * Check if an IP (v4 or v6) is private/internal.
 */
export function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return false;
}

// ── Core Validation ───────────────────────────────────────────

/**
 * Synchronous URL validation (hostname/IP checks, no DNS).
 * Used for fast pre-checks and for redirect-hop validation.
 */
export function assertExternalUrl(urlStr: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Blocked: unsupported protocol "${parsed.protocol}". Only http/https allowed.`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new Error("Blocked: request to internal/private address is not allowed.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error("Blocked: request to internal/private address is not allowed.");
    }
  }
}

/**
 * Async URL validation with DNS resolution — prevents DNS rebinding.
 *
 * Returns the first valid resolved IP so callers can pin the connection
 * to that address (preventing TOCTOU between validation and fetch).
 */
export async function assertExternalUrlWithResolve(
  urlStr: string
): Promise<{ resolvedIP: string; hostname: string }> {
  // Run synchronous checks first
  assertExternalUrl(urlStr);

  const parsed = new URL(urlStr);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // If the hostname is already an IP, we've already validated it above
  if (net.isIP(hostname)) {
    return { resolvedIP: hostname, hostname };
  }

  // Resolve DNS and check ALL resolved addresses
  const resolver = new dns.Resolver();
  resolver.setServers(dns.getServers()); // use system DNS

  let resolvedIPs: string[] = [];

  // Try IPv4 first, fall back to IPv6
  try {
    resolvedIPs = await new Promise<string[]>((resolve, reject) => {
      resolver.resolve4(hostname, (err, addresses) => {
        if (err) reject(err);
        else resolve(addresses);
      });
    });
  } catch {
    // No A records — try AAAA
    try {
      resolvedIPs = await new Promise<string[]>((resolve, reject) => {
        resolver.resolve6(hostname, (err, addresses) => {
          if (err) reject(err);
          else resolve(addresses);
        });
      });
    } catch {
      throw new Error(`DNS resolution failed for "${hostname}".`);
    }
  }

  if (resolvedIPs.length === 0) {
    throw new Error(`DNS resolution returned no addresses for "${hostname}".`);
  }

  // Block if ANY resolved IP is private
  for (const ip of resolvedIPs) {
    if (isPrivateIP(ip)) {
      throw new Error(
        `Blocked: "${hostname}" resolves to internal/private address ${ip}.`
      );
    }
  }

  // Return the first safe IP for connection pinning
  return { resolvedIP: resolvedIPs[0], hostname };
}
