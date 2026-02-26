/**
 * Unit tests — SSRF protection with DNS rebinding defence
 */
import {
  assertExternalUrl,
  assertExternalUrlWithResolve,
  isPrivateIPv4,
  isPrivateIPv6,
  isPrivateIP,
} from "@/lib/agent/ssrf";

describe("isPrivateIPv4", () => {
  test("detects loopback", () => {
    expect(isPrivateIPv4("127.0.0.1")).toBe(true);
    expect(isPrivateIPv4("127.255.255.255")).toBe(true);
  });

  test("detects 10.x.x.x private", () => {
    expect(isPrivateIPv4("10.0.0.1")).toBe(true);
    expect(isPrivateIPv4("10.255.255.255")).toBe(true);
  });

  test("detects 172.16-31.x.x private", () => {
    expect(isPrivateIPv4("172.16.0.1")).toBe(true);
    expect(isPrivateIPv4("172.31.255.255")).toBe(true);
    expect(isPrivateIPv4("172.15.0.1")).toBe(false);
    expect(isPrivateIPv4("172.32.0.1")).toBe(false);
  });

  test("detects 192.168.x.x private", () => {
    expect(isPrivateIPv4("192.168.0.1")).toBe(true);
    expect(isPrivateIPv4("192.168.255.255")).toBe(true);
  });

  test("detects link-local / cloud metadata", () => {
    expect(isPrivateIPv4("169.254.169.254")).toBe(true);
    expect(isPrivateIPv4("169.254.0.1")).toBe(true);
  });

  test("detects 0.0.0.0", () => {
    expect(isPrivateIPv4("0.0.0.0")).toBe(true);
  });

  test("allows public IPs", () => {
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
    expect(isPrivateIPv4("1.1.1.1")).toBe(false);
    expect(isPrivateIPv4("93.184.216.34")).toBe(false);
  });
});

describe("isPrivateIPv6", () => {
  test("detects loopback", () => {
    expect(isPrivateIPv6("::1")).toBe(true);
  });

  test("detects link-local", () => {
    expect(isPrivateIPv6("fe80::1")).toBe(true);
  });

  test("detects unique local (fc/fd)", () => {
    expect(isPrivateIPv6("fc00::1")).toBe(true);
    expect(isPrivateIPv6("fd00::1")).toBe(true);
  });

  test("detects IPv4-mapped private", () => {
    expect(isPrivateIPv6("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIPv6("::ffff:10.0.0.1")).toBe(true);
  });

  test("allows public IPv6", () => {
    expect(isPrivateIPv6("2001:4860:4860::8888")).toBe(false);
  });
});

describe("assertExternalUrl (synchronous)", () => {
  test("allows valid public URLs", () => {
    expect(() => assertExternalUrl("https://example.com")).not.toThrow();
    expect(() => assertExternalUrl("http://93.184.216.34")).not.toThrow();
  });

  test("blocks non-http protocols", () => {
    expect(() => assertExternalUrl("ftp://example.com")).toThrow("unsupported protocol");
    expect(() => assertExternalUrl("file:///etc/passwd")).toThrow("unsupported protocol");
  });

  test("blocks localhost", () => {
    expect(() => assertExternalUrl("http://localhost")).toThrow("internal/private");
  });

  test("blocks cloud metadata hostnames", () => {
    expect(() => assertExternalUrl("http://metadata.google.internal")).toThrow("internal/private");
    expect(() => assertExternalUrl("http://metadata.azure.com")).toThrow("internal/private");
    expect(() => assertExternalUrl("http://instance-data")).toThrow("internal/private");
  });

  test("blocks private IP addresses", () => {
    expect(() => assertExternalUrl("http://127.0.0.1")).toThrow("internal/private");
    expect(() => assertExternalUrl("http://10.0.0.1")).toThrow("internal/private");
    expect(() => assertExternalUrl("http://192.168.0.1")).toThrow("internal/private");
    expect(() => assertExternalUrl("http://169.254.169.254")).toThrow("internal/private");
  });

  test("blocks private IPv6 addresses", () => {
    expect(() => assertExternalUrl("http://[::1]")).toThrow("internal/private");
    expect(() => assertExternalUrl("http://[fe80::1]")).toThrow("internal/private");
  });

  test("rejects invalid URLs", () => {
    expect(() => assertExternalUrl("not-a-url")).toThrow("Invalid URL");
  });
});

describe("assertExternalUrlWithResolve (async DNS)", () => {
  test("allows valid public domain", async () => {
    // example.com resolves to a public IP
    const result = await assertExternalUrlWithResolve("https://example.com");
    expect(result.resolvedIP).toBeDefined();
    expect(isPrivateIP(result.resolvedIP)).toBe(false);
  });

  test("blocks localhost", async () => {
    await expect(assertExternalUrlWithResolve("http://localhost")).rejects.toThrow("internal/private");
  });

  test("blocks IP-literal private addresses", async () => {
    await expect(assertExternalUrlWithResolve("http://192.168.0.1")).rejects.toThrow("internal/private");
  });

  test("passes through IP-literal public addresses", async () => {
    const result = await assertExternalUrlWithResolve("http://8.8.8.8");
    expect(result.resolvedIP).toBe("8.8.8.8");
  });
});
