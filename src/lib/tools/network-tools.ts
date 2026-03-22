/**
 * Built-in Network Tools for Nexus Agent
 *
 * Provides capabilities for scanning the local network and connecting to devices:
 *  1. net_ping               — Ping a host to check reachability
 *  2. net_scan_network       — Discover devices on the local network         [REQUIRES APPROVAL]
 *  3. net_scan_ports         — Port-scan a specific host                     [REQUIRES APPROVAL]
 *  4. net_connect_ssh        — SSH into a device and execute a command       [REQUIRES APPROVAL]
 *  5. net_http_request       — Make HTTP requests to local network devices   [REQUIRES APPROVAL]
 *  6. net_wake_on_lan        — Wake a device via WOL magic packet            [REQUIRES APPROVAL]
 *
 * Unlike web-tools (which block private IPs for SSRF defence), these tools
 * are specifically designed for the local / private network.
 */

import type { ToolDefinition } from "@/lib/llm";
import { execFile } from "child_process";
import { promisify } from "util";
import * as net from "net";
import * as dgram from "dgram";
import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import { Client as SSHClient } from "ssh2";
import { BaseTool, type ToolExecutionContext, registerToolCategory } from "./base-tool";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("tools.network-tools");

const execFileAsync = promisify(execFile);

// ── Limits ────────────────────────────────────────────────────
import {
  NET_MAX_OUTPUT,
  NET_CMD_TIMEOUT_MS,
  NET_SSH_TIMEOUT_MS,
  NET_PORT_SCAN_TIMEOUT_MS,
  NET_HTTP_TIMEOUT_MS,
  NET_MAX_HTTP_BODY,
  NET_PING_DEFAULT_COUNT,
  NET_PING_MAX_COUNT,
  NET_PING_SWEEP_TIMEOUT_MS,
  NET_IP_ROUTE_TIMEOUT_MS,
} from "@/lib/constants";

// ── Tool Names ────────────────────────────────────────────────

export const NET_TOOL_NAMES = {
  PING: "builtin.net_ping",
  SCAN_NETWORK: "builtin.net_scan_network",
  SCAN_PORTS: "builtin.net_scan_ports",
  CONNECT_SSH: "builtin.net_connect_ssh",
  HTTP_REQUEST: "builtin.net_http_request",
  WAKE_ON_LAN: "builtin.net_wake_on_lan",
} as const;

/** Tools that require owner approval before execution. */
export const NETWORK_TOOLS_REQUIRING_APPROVAL = [
  NET_TOOL_NAMES.SCAN_NETWORK,
  NET_TOOL_NAMES.SCAN_PORTS,
  NET_TOOL_NAMES.CONNECT_SSH,
  NET_TOOL_NAMES.HTTP_REQUEST,
  NET_TOOL_NAMES.WAKE_ON_LAN,
];

// ── Tool Definitions ──────────────────────────────────────────

export const BUILTIN_NETWORK_TOOLS: ToolDefinition[] = [
  // ── Read-only / benign ─────────────────────────────────────
  {
    name: NET_TOOL_NAMES.PING,
    description:
      "Ping a host to check if it is reachable on the network. Returns round-trip time statistics. Works with IP addresses and hostnames (including .local mDNS names).",
    inputSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "IP address or hostname to ping (e.g. '192.168.0.1', 'printer.local').",
        },
        count: {
          type: "number",
          description: "Number of ping packets to send (default: 4, max: 20).",
        },
      },
      required: ["host"],
    },
  },

  // ── Discovery (require approval) ──────────────────────────
  {
    name: NET_TOOL_NAMES.SCAN_NETWORK,
    description:
      "Scan the local network to discover connected devices. Returns a list of IP addresses, MAC addresses, and hostnames. Uses ARP scanning and/or ping sweep. REQUIRES APPROVAL.",
    inputSchema: {
      type: "object",
      properties: {
        subnet: {
          type: "string",
          description:
            "Subnet to scan in CIDR notation (e.g. '192.168.0.0/24'). If omitted, scans the default local network.",
        },
        method: {
          type: "string",
          enum: ["arp", "nmap", "auto"],
          description:
            "Scan method: 'arp' (ARP scan, fastest on LAN), 'nmap' (uses nmap -sn), or 'auto' (tries arp first, falls back to nmap, then ping sweep). Default: 'auto'.",
        },
      },
      required: [],
    },
  },
  {
    name: NET_TOOL_NAMES.SCAN_PORTS,
    description:
      "Scan ports on a specific host to discover running services. Returns list of open ports with service names. REQUIRES APPROVAL.",
    inputSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "IP address or hostname to scan.",
        },
        ports: {
          type: "string",
          description:
            "Port range or list to scan. Examples: '1-1024' (range), '22,80,443,8080' (list), '1-65535' (all). Default: common ports (top 100).",
        },
        timeout: {
          type: "number",
          description: "Per-port timeout in milliseconds (default: 2000).",
        },
      },
      required: ["host"],
    },
  },

  // ── Connection (require approval) ─────────────────────────
  {
    name: NET_TOOL_NAMES.CONNECT_SSH,
    description:
      "Connect to a device via SSH and execute a command. Supports both key-based and password authentication securely (password is never exposed in the process list). REQUIRES APPROVAL.",
    inputSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "IP address or hostname of the remote device.",
        },
        username: {
          type: "string",
          description: "SSH username.",
        },
        command: {
          type: "string",
          description: "Command to execute on the remote device.",
        },
        port: {
          type: "number",
          description: "SSH port (default: 22).",
        },
        keyPath: {
          type: "string",
          description: "Path to the SSH private key file. If omitted, uses the system default (~/.ssh/id_rsa).",
        },
        password: {
          type: "string",
          description:
            "SSH password for password-based auth, or passphrase for an encrypted key. Transmitted securely via the ssh2 library (never visible in process list).",
        },
      },
      required: ["host", "username", "command"],
    },
  },
  {
    name: NET_TOOL_NAMES.HTTP_REQUEST,
    description:
      "Make an HTTP/HTTPS request to a device on the local network. Unlike web_fetch (which blocks private IPs for security), this tool is designed specifically for local/internal network devices (routers, IoT devices, APIs, etc.). REQUIRES APPROVAL.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full URL including protocol (e.g. 'http://192.168.0.1/api/status', 'http://homeassistant.local:8123/api/').",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"],
          description: "HTTP method (default: 'GET').",
        },
        headers: {
          type: "object",
          description: "Request headers as key-value pairs (e.g. { \"Authorization\": \"Bearer token\" }).",
        },
        body: {
          type: "string",
          description: "Request body (for POST/PUT/PATCH). Will be sent as-is; set Content-Type header accordingly.",
        },
        timeout: {
          type: "number",
          description: "Request timeout in milliseconds (default: 30000).",
        },
      },
      required: ["url"],
    },
  },
  {
    name: NET_TOOL_NAMES.WAKE_ON_LAN,
    description:
      "Send a Wake-on-LAN (WOL) magic packet to wake up a device on the network by its MAC address. The target device must have WOL enabled in BIOS/firmware. REQUIRES APPROVAL.",
    inputSchema: {
      type: "object",
      properties: {
        macAddress: {
          type: "string",
          description: "MAC address of the target device (e.g. 'AA:BB:CC:DD:EE:FF' or 'AA-BB-CC-DD-EE-FF').",
        },
        broadcastAddress: {
          type: "string",
          description: "Broadcast address to send the packet to (default: '255.255.255.255').",
        },
        port: {
          type: "number",
          description: "UDP port for the WOL packet (default: 9).",
        },
      },
      required: ["macAddress"],
    },
  },
];

// ── Internal interface ────────────────────────────────────────

interface DeviceEntry {
  ip: string;
  mac: string | null;
  hostname: string | null;
  vendor: string | null;
}

// ── BaseTool class wrapper ────────────────────────────────────

export class NetworkTools extends BaseTool {
  readonly name = "network";
  readonly toolNamePrefix = "builtin.net_";
  readonly registrationOrder = 30;
  readonly tools = BUILTIN_NETWORK_TOOLS;
  readonly toolsRequiringApproval = [...NETWORK_TOOLS_REQUIRING_APPROVAL];

  private readonly cmdMap: ReadonlyMap<string, (a: Record<string, unknown>) => Promise<unknown>>;

  constructor() {
    super();
    this.cmdMap = new Map<string, (a: Record<string, unknown>) => Promise<unknown>>([
      [NET_TOOL_NAMES.PING,         (a) => this.ping(a)],
      [NET_TOOL_NAMES.SCAN_NETWORK, (a) => this.scanNetwork(a)],
      [NET_TOOL_NAMES.SCAN_PORTS,   (a) => this.scanPorts(a)],
      [NET_TOOL_NAMES.CONNECT_SSH,  (a) => this.connectSsh(a)],
      [NET_TOOL_NAMES.HTTP_REQUEST, (a) => this.httpRequest(a)],
      [NET_TOOL_NAMES.WAKE_ON_LAN,  (a) => this.wakeOnLan(a)],
    ]);
  }

  async execute(toolName: string, args: Record<string, unknown>, _context: ToolExecutionContext): Promise<unknown> {
    const t0 = Date.now();
    log.enter("execute", { toolName });
    const handler = this.cmdMap.get(toolName);
    if (!handler) throw new Error(`Unknown built-in network tool: "${toolName}"`);
    const result = await handler(args);
    log.exit("execute", { toolName }, Date.now() - t0);
    return result;
  }

  private ping(args: Record<string, unknown>): Promise<unknown>         { return NetworkTools.netPing(args); }
  private scanNetwork(args: Record<string, unknown>): Promise<unknown>  { return NetworkTools.netScanNetwork(args); }
  private scanPorts(args: Record<string, unknown>): Promise<unknown>    { return NetworkTools.netScanPorts(args); }
  private connectSsh(args: Record<string, unknown>): Promise<unknown>   { return NetworkTools.netConnectSsh(args); }
  private httpRequest(args: Record<string, unknown>): Promise<unknown>  { return NetworkTools.netHttpRequest(args); }
  private wakeOnLan(args: Record<string, unknown>): Promise<unknown>    { return NetworkTools.netWakeOnLan(args); }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Check whether a tool name is a built-in network tool.
   */
  static isNetworkTool(name: string): boolean {
    return Object.values(NET_TOOL_NAMES).includes(name as any);
  }

  /**
   * Execute a built-in network tool and return the result.
   */
  static async executeBuiltinNetworkTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    switch (name) {
      case NET_TOOL_NAMES.PING:
        return NetworkTools.netPing(args);
      case NET_TOOL_NAMES.SCAN_NETWORK:
        return NetworkTools.netScanNetwork(args);
      case NET_TOOL_NAMES.SCAN_PORTS:
        return NetworkTools.netScanPorts(args);
      case NET_TOOL_NAMES.CONNECT_SSH:
        return NetworkTools.netConnectSsh(args);
      case NET_TOOL_NAMES.HTTP_REQUEST:
        return NetworkTools.netHttpRequest(args);
      case NET_TOOL_NAMES.WAKE_ON_LAN:
        return NetworkTools.netWakeOnLan(args);
      default:
        throw new Error(`Unknown built-in network tool: "${name}"`);
    }
  }

  // ── Sanitizers ──────────────────────────────────────────────

  private static sanitizeHost(host: string): string {
    const cleaned = host.trim();
    if (!/^[a-zA-Z0-9.\-:%]+$/.test(cleaned)) {
      throw new Error(`Invalid host: "${host}". Only alphanumeric characters, dots, hyphens, and colons are allowed.`);
    }
    if (cleaned.length > 253) {
      throw new Error("Hostname too long (max 253 characters).");
    }
    return cleaned;
  }

  private static sanitizeSubnetCidr(subnet: string): string {
    const cleaned = subnet.trim();
    const cidrMatch = cleaned.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/);
    if (!cidrMatch) {
      throw new Error(
        `Invalid subnet: "${subnet}". Expected IPv4 CIDR notation like "192.168.0.0/24".`
      );
    }

    const ip = cidrMatch[1];
    const prefix = cidrMatch[2] ? Number(cidrMatch[2]) : 24;
    const octets = ip.split(".").map((part) => Number(part));
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      throw new Error(`Invalid subnet IP: "${subnet}".`);
    }
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error(`Invalid subnet prefix in "${subnet}". CIDR prefix must be between 0 and 32.`);
    }

    return `${octets.join(".")}/${prefix}`;
  }

  private static sanitizeUsername(username: string): string {
    const cleaned = username.trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(cleaned)) {
      throw new Error(`Invalid username: "${username}". Only alphanumeric, dots, underscores, and hyphens allowed.`);
    }
    return cleaned;
  }

  // ── 1. Ping ─────────────────────────────────────────────────

  private static async netPing(args: Record<string, unknown>): Promise<unknown> {
    const host = NetworkTools.sanitizeHost(args.host as string);
    const count = Math.min(Math.max((args.count as number) || NET_PING_DEFAULT_COUNT, 1), NET_PING_MAX_COUNT);

    const isWindows = process.platform === "win32";
    const countFlag = isWindows ? "-n" : "-c";

    try {
      const { stdout, stderr } = await execFileAsync("ping", [countFlag, String(count), host], {
        timeout: NET_CMD_TIMEOUT_MS,
        maxBuffer: NET_MAX_OUTPUT,
      });

      const lines = stdout.split("\n").filter((l) => l.trim());
      const statsLine = lines.find((l) => /packets transmitted/i.test(l) || /Packets: Sent/i.test(l));
      const rttLine = lines.find((l) => /rtt|round-trip|Minimum/i.test(l));

      return {
        host,
        reachable: !stderr.includes("100% packet loss") && !stdout.includes("100% packet loss"),
        count,
        output: stdout.slice(0, NET_MAX_OUTPUT),
        stats: statsLine?.trim() || null,
        rtt: rttLine?.trim() || null,
      };
    } catch (err: unknown) {
      const errObj = err as { stderr?: string; message?: string; stdout?: string };
      return {
        host,
        reachable: false,
        count,
        output: (errObj.stdout || "").slice(0, NET_MAX_OUTPUT),
        error: errObj.stderr || errObj.message,
      };
    }
  }

  // ── 2. Scan Network ─────────────────────────────────────────

  private static async netScanNetwork(args: Record<string, unknown>): Promise<unknown> {
    const subnet = args.subnet ? NetworkTools.sanitizeSubnetCidr(args.subnet as string) : null;
    const method = (args.method as string) || "auto";

    const devices: DeviceEntry[] = [];
    let scanMethod = "";

    if (method === "arp" || method === "auto") {
      // Try arp-scan first (Linux only, needs root or setuid)
      try {
        const arpArgs = subnet ? ["-l", subnet] : ["-l"];
        const { stdout } = await execFileAsync("arp-scan", arpArgs, {
          timeout: NET_CMD_TIMEOUT_MS,
          maxBuffer: NET_MAX_OUTPUT,
        });
        scanMethod = "arp-scan";
        NetworkTools.parseArpScanOutput(stdout, devices);
      } catch {
        // arp-scan not available or failed; try arp -a
        if (method === "arp" || method === "auto") {
          try {
            const { stdout } = await execFileAsync("arp", ["-a"], {
              timeout: NET_CMD_TIMEOUT_MS,
              maxBuffer: NET_MAX_OUTPUT,
            });
            scanMethod = "arp -a";
            NetworkTools.parseArpTableOutput(stdout, devices);
          } catch {
            // arp also failed
          }
        }
      }
    }

    if ((method === "nmap" || (method === "auto" && devices.length === 0)) && devices.length === 0) {
      // Try nmap -sn (ping scan)
      try {
        const target = subnet || "192.168.0.0/24";
        const { stdout } = await execFileAsync("nmap", ["-sn", target], {
          timeout: 60_000, // nmap scans can take a while
          maxBuffer: NET_MAX_OUTPUT,
        });
        scanMethod = "nmap";
        NetworkTools.parseNmapPingScanOutput(stdout, devices);
      } catch {
        // nmap not available
      }
    }

    // Last resort: ping sweep (slow but universal)
    if (method === "auto" && devices.length === 0) {
      const baseSubnet = subnet || await NetworkTools.detectLocalSubnet();
      if (baseSubnet) {
        scanMethod = "ping-sweep";
        await NetworkTools.pingSweep(baseSubnet, devices);
      }
    }

    return {
      scanMethod,
      subnet: subnet || "auto-detected",
      devicesFound: devices.length,
      devices,
    };
  }

  private static parseArpScanOutput(output: string, devices: DeviceEntry[]): void {
    // arp-scan output: "192.168.0.1\t00:11:22:33:44:55\tVendor Name"
    const lines = output.split("\n");
    for (const line of lines) {
      const match = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:]{17})\s*(.*)?$/);
      if (match) {
        devices.push({
          ip: match[1],
          mac: match[2].toUpperCase(),
          hostname: null,
          vendor: match[3]?.trim() || null,
        });
      }
    }
  }

  private static parseArpTableOutput(output: string, devices: DeviceEntry[]): void {
    // Linux arp -a: "hostname (192.168.0.1) at 00:11:22:33:44:55 [ether] on eth0"
    // macOS arp -a: "? (192.168.0.1) at 0:11:22:33:44:55 on en0 ifscope [ethernet]"
    const lines = output.split("\n");
    for (const line of lines) {
      const match = line.match(/\(?(\d+\.\d+\.\d+\.\d+)\)?\s+at\s+([0-9a-fA-F:]+)/);
      if (match) {
        const hostname = line.match(/^([^\s(]+)\s+\(/)?.[1] || null;
        devices.push({
          ip: match[1],
          mac: match[2] !== "(incomplete)" ? match[2].toUpperCase() : null,
          hostname: hostname === "?" ? null : hostname,
          vendor: null,
        });
      }
    }
  }

  private static parseNmapPingScanOutput(output: string, devices: DeviceEntry[]): void {
    // nmap -sn output blocks:
    // Nmap scan report for hostname (192.168.0.1)
    // Host is up (0.0050s latency).
    // MAC Address: 00:11:22:33:44:55 (Vendor)
    const blocks = output.split(/Nmap scan report for /);
    for (const block of blocks) {
      if (!block.includes("Host is up")) continue;
      const ipMatch = block.match(/(\d+\.\d+\.\d+\.\d+)/);
      const macMatch = block.match(/MAC Address:\s+([0-9A-Fa-f:]{17})\s*\(?([^)]*)\)?/);
      const hostnameMatch = block.match(/^([^\s(]+)\s+\(/);
      if (ipMatch) {
        devices.push({
          ip: ipMatch[1],
          mac: macMatch?.[1]?.toUpperCase() || null,
          hostname: hostnameMatch?.[1] || null,
          vendor: macMatch?.[2]?.trim() || null,
        });
      }
    }
  }

  private static async detectLocalSubnet(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("ip", ["route"], { timeout: NET_IP_ROUTE_TIMEOUT_MS });
      const match = stdout.match(/src\s+(\d+\.\d+\.\d+\.\d+)/);
      const ip = match?.[1]?.trim();
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        const parts = ip.split(".");
        return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      }
    } catch {
      // Fallback
    }
    return "192.168.0.0/24";
  }

  private static async pingSweep(subnet: string, devices: DeviceEntry[]): Promise<void> {
    // Parse subnet (simple /24 support)
    const match = subnet.match(/^(\d+\.\d+\.\d+)\.\d+\/24$/);
    if (!match) return;
    const base = match[1];

    // Ping sweep: fire all 254 pings in parallel with short timeout
    const promises: Promise<void>[] = [];
    for (let i = 1; i <= 254; i++) {
      const ip = `${base}.${i}`;
      promises.push(
        execFileAsync("ping", ["-c", "1", "-W", "1", ip], { timeout: NET_PING_SWEEP_TIMEOUT_MS })
          .then(() => {
            devices.push({ ip, mac: null, hostname: null, vendor: null });
          })
          .catch(() => {
            // Host not reachable — skip
          })
      );
    }
    await Promise.all(promises);

    // Sort by IP
    devices.sort((a, b) => {
      const aParts = a.ip.split(".").map(Number);
      const bParts = b.ip.split(".").map(Number);
      for (let i = 0; i < 4; i++) {
        if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
      }
      return 0;
    });
  }

  // ── 3. Port Scan ────────────────────────────────────────────

  /** Common ports to scan when no specific ports are given. */
  private static readonly COMMON_PORTS = [
    21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 554, 993, 995,
    1080, 1433, 1883, 2049, 3000, 3306, 3389, 5000, 5432, 5900, 5901, 6379,
    8000, 8080, 8123, 8443, 8883, 8888, 9000, 9090, 9200, 27017, 32400, 49152,
  ];

  /** Well-known service names for port descriptions. */
  private static readonly PORT_SERVICES: Record<number, string> = {
    21: "FTP",
    22: "SSH",
    23: "Telnet",
    25: "SMTP",
    53: "DNS",
    80: "HTTP",
    110: "POP3",
    111: "RPC",
    135: "MSRPC",
    139: "NetBIOS",
    143: "IMAP",
    443: "HTTPS",
    445: "SMB",
    554: "RTSP",
    993: "IMAPS",
    995: "POP3S",
    1080: "SOCKS",
    1433: "MSSQL",
    1883: "MQTT",
    2049: "NFS",
    3000: "Dev Server",
    3306: "MySQL",
    3389: "RDP",
    5000: "HTTP Alt",
    5432: "PostgreSQL",
    5900: "VNC",
    5901: "VNC",
    6379: "Redis",
    8000: "HTTP Alt",
    8080: "HTTP Proxy",
    8123: "Home Assistant",
    8443: "HTTPS Alt",
    8883: "MQTT/TLS",
    8888: "HTTP Alt",
    9000: "HTTP Alt",
    9090: "Prometheus",
    9200: "Elasticsearch",
    27017: "MongoDB",
    32400: "Plex",
    49152: "UPnP",
  };

  private static async netScanPorts(args: Record<string, unknown>): Promise<unknown> {
    const host = NetworkTools.sanitizeHost(args.host as string);
    const portsStr = (args.ports as string) || null;
    const perPortTimeout = Math.min((args.timeout as number) || NET_PORT_SCAN_TIMEOUT_MS, 10_000);

    let portsToScan: number[];

    if (portsStr) {
      portsToScan = NetworkTools.parsePorts(portsStr);
    } else {
      portsToScan = [...NetworkTools.COMMON_PORTS];
    }

    // Limit total ports to prevent abuse
    if (portsToScan.length > 10000) {
      throw new Error("Too many ports requested (max 10,000). Use a smaller range.");
    }

    const openPorts: Array<{ port: number; service: string | null }> = [];
    const closedCount = { value: 0 };

    // Scan in batches of 50 to avoid too many concurrent connections
    const BATCH_SIZE = 50;
    for (let i = 0; i < portsToScan.length; i += BATCH_SIZE) {
      const batch = portsToScan.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((port) => NetworkTools.checkPort(host, port, perPortTimeout))
      );
      for (let j = 0; j < results.length; j++) {
        if (results[j]) {
          openPorts.push({
            port: batch[j],
            service: NetworkTools.PORT_SERVICES[batch[j]] || null,
          });
        } else {
          closedCount.value++;
        }
      }
    }

    return {
      host,
      portsScanned: portsToScan.length,
      openPorts,
      closedPorts: closedCount.value,
    };
  }

  private static parsePorts(portsStr: string): number[] {
    const ports: Set<number> = new Set();
    const parts = portsStr.split(",").map((s) => s.trim());
    for (const part of parts) {
      if (part.includes("-")) {
        const [start, end] = part.split("-").map(Number);
        if (isNaN(start) || isNaN(end) || start < 1 || end > 65535 || start > end) {
          throw new Error(`Invalid port range: "${part}".`);
        }
        for (let p = start; p <= end; p++) ports.add(p);
      } else {
        const p = Number(part);
        if (isNaN(p) || p < 1 || p > 65535) throw new Error(`Invalid port: "${part}".`);
        ports.add(p);
      }
    }
    return Array.from(ports).sort((a, b) => a - b);
  }

  private static checkPort(host: string, port: number, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeout);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    });
  }

  // ── 4. SSH Connect (via ssh2 library — no password in process list) ──

  private static async netConnectSsh(args: Record<string, unknown>): Promise<unknown> {
    const host = NetworkTools.sanitizeHost(args.host as string);
    const username = NetworkTools.sanitizeUsername(args.username as string);
    const command = args.command as string;
    const port = (args.port as number) || 22;
    const keyPath = args.keyPath as string | undefined;
    const password = args.password as string | undefined;

    if (!command || typeof command !== "string" || command.trim().length === 0) {
      throw new Error("Command must be a non-empty string.");
    }

    // Block known dangerous commands (defence-in-depth)
    const BLOCKED_PATTERNS = [
      /\brm\s+(-rf?\s+)?\//i,
      /\bdd\b.*\bof=\/dev\//i,
      /\b(mkfs|fdisk|wipefs)\b/i,
      /\bcurl\b.*\|.*\b(sh|bash)\b/i,
      /\bwget\b.*\|.*\b(sh|bash)\b/i,
    ];
    for (const pat of BLOCKED_PATTERNS) {
      if (pat.test(command)) {
        throw new Error("Blocked: command matches a dangerous pattern and cannot be executed remotely.");
      }
    }

    return new Promise((resolve) => {
      const conn = new SSHClient();
      let stdoutData = "";
      let stderrData = "";
      let exitCode = 0;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        conn.end();
      }, NET_SSH_TIMEOUT_MS);

      conn.on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            conn.end();
            resolve({
              host, username, port, command,
              exitCode: 1,
              stdout: "",
              stderr: err.message,
              error: err.message,
            });
            return;
          }

          stream.on("data", (data: Buffer) => {
            stdoutData += data.toString();
            if (stdoutData.length > NET_MAX_OUTPUT) {
              stdoutData = stdoutData.slice(0, NET_MAX_OUTPUT);
            }
          });

          stream.stderr.on("data", (data: Buffer) => {
            stderrData += data.toString();
            if (stderrData.length > NET_MAX_OUTPUT) {
              stderrData = stderrData.slice(0, NET_MAX_OUTPUT);
            }
          });

          stream.on("close", (code: number) => {
            exitCode = code ?? 0;
            clearTimeout(timer);
            conn.end();
          });
        });
      });

      conn.on("close", () => {
        resolve({
          host, username, port, command,
          exitCode: timedOut ? 124 : exitCode,
          stdout: stdoutData.slice(0, NET_MAX_OUTPUT),
          stderr: stderrData.slice(0, NET_MAX_OUTPUT),
          error: timedOut ? "Connection timed out" : undefined,
        });
      });

      conn.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          host, username, port, command,
          exitCode: 1,
          stdout: stdoutData.slice(0, NET_MAX_OUTPUT),
          stderr: err.message,
          error: err.message,
        });
      });

      // Build connection config — password never appears in any process list
      const connConfig: Record<string, unknown> = {
        host,
        port,
        username,
        readyTimeout: 10_000,
      };

      if (keyPath) {
        try {
          connConfig.privateKey = fs.readFileSync(keyPath);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          clearTimeout(timer);
          resolve({
            host, username, port, command,
            exitCode: 1, stdout: "", stderr: `Failed to read key file: ${errMsg}`,
            error: `Failed to read key file: ${errMsg}`,
          });
          return;
        }
        if (password) {
          connConfig.passphrase = password; // key passphrase
        }
      } else if (password) {
        connConfig.password = password;
      }

      conn.connect(connConfig as any);
    });
  }

  // ── 5. HTTP Request ─────────────────────────────────────────

  private static async netHttpRequest(args: Record<string, unknown>): Promise<unknown> {
    const url = args.url as string;
    const method = ((args.method as string) || "GET").toUpperCase();
    const headers = (args.headers as Record<string, string>) || {};
    const body = args.body as string | undefined;
    const timeout = Math.min((args.timeout as number) || NET_HTTP_TIMEOUT_MS, 120_000);

    if (!url || typeof url !== "string") {
      throw new Error("URL is required.");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`Invalid URL: "${url}".`);
    }

    const isHttps = parsedUrl.protocol === "https:";
    const requestModule = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const reqOptions: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers: {
          ...headers,
          "User-Agent": "Nexus-Agent/1.0",
        },
        timeout,
      };

      // Allow self-signed certs on local devices
      if (isHttps) {
        (reqOptions as https.RequestOptions).rejectUnauthorized = false;
      }

      const req = requestModule.request(reqOptions, (res) => {
        const chunks: Buffer[] = [];
        let totalSize = 0;

        res.on("data", (chunk: Buffer) => {
          totalSize += chunk.length;
          if (totalSize <= NET_MAX_HTTP_BODY) {
            chunks.push(chunk);
          }
        });

        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          const contentType = res.headers["content-type"] || "";

          // Try to parse JSON responses
          let parsedBody: unknown = rawBody;
          if (contentType.includes("application/json")) {
            try {
              parsedBody = JSON.parse(rawBody);
            } catch {
              // Return as string
            }
          }

          resolve({
            url,
            method,
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            body: typeof parsedBody === "string"
              ? parsedBody.slice(0, NET_MAX_HTTP_BODY)
              : parsedBody,
            truncated: totalSize > NET_MAX_HTTP_BODY,
          });
        });
      });

      req.on("error", (err) => {
        reject(new Error(`HTTP request failed: ${err.message}`));
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`HTTP request timed out after ${timeout}ms.`));
      });

      if (body && ["POST", "PUT", "PATCH"].includes(method)) {
        req.write(body);
      }
      req.end();
    });
  }

  // ── 6. Wake-on-LAN ──────────────────────────────────────────

  private static async netWakeOnLan(args: Record<string, unknown>): Promise<unknown> {
    const macAddress = args.macAddress as string;
    const broadcastAddr = (args.broadcastAddress as string) || "255.255.255.255";
    const port = (args.port as number) || 9;

    if (!macAddress || typeof macAddress !== "string") {
      throw new Error("MAC address is required.");
    }

    // Parse and validate MAC address
    const cleanMac = macAddress.replace(/[:-]/g, "").toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(cleanMac)) {
      throw new Error(
        `Invalid MAC address: "${macAddress}". Expected format: AA:BB:CC:DD:EE:FF or AA-BB-CC-DD-EE-FF.`
      );
    }

    // Build magic packet: 6 bytes of 0xFF followed by MAC address repeated 16 times
    const macBytes = Buffer.from(cleanMac, "hex");
    const magicPacket = Buffer.alloc(6 + 16 * 6);
    // Fill first 6 bytes with 0xFF
    for (let i = 0; i < 6; i++) magicPacket[i] = 0xff;
    // Repeat MAC address 16 times
    for (let i = 0; i < 16; i++) {
      macBytes.copy(magicPacket, 6 + i * 6);
    }

    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket("udp4");

      socket.once("error", (err) => {
        socket.close();
        reject(new Error(`WOL failed: ${err.message}`));
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(magicPacket, 0, magicPacket.length, port, broadcastAddr, (err) => {
          socket.close();
          if (err) {
            reject(new Error(`WOL failed: ${err.message}`));
          } else {
            resolve({
              macAddress: macAddress.toUpperCase(),
              broadcastAddress: broadcastAddr,
              port,
              packetSent: true,
              message: `Wake-on-LAN magic packet sent to ${macAddress.toUpperCase()} via ${broadcastAddr}:${port}. Device should wake up if WOL is enabled.`,
            });
          }
        });
      });
    });
  }
}

export const isNetworkTool = NetworkTools.isNetworkTool.bind(NetworkTools);
export const executeBuiltinNetworkTool = NetworkTools.executeBuiltinNetworkTool.bind(NetworkTools);

export const networkTools = new NetworkTools();
registerToolCategory(networkTools);
