/**
 * Unit tests — Network tools
 */

import { executeBuiltinNetworkTool, NET_TOOL_NAMES } from "@/lib/agent/network-tools";

jest.mock("child_process", () => ({
  exec: jest.fn((command: string, _options: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
    if (command.startsWith("arp-scan")) {
      callback(new Error("arp-scan not available"), "", "");
      return;
    }
    if (command.startsWith("arp -a")) {
      callback(new Error("arp not available"), "", "");
      return;
    }
    if (command.startsWith("nmap -sn")) {
      callback(
        null,
        "Nmap scan report for 192.168.0.1\nHost is up (0.0020s latency).\n",
        ""
      );
      return;
    }
    callback(new Error(`Unexpected command: ${command}`), "", "");
  }),
}));

describe("network-tools", () => {
  test("net_scan_network accepts CIDR subnet", async () => {
    await expect(
      executeBuiltinNetworkTool(NET_TOOL_NAMES.SCAN_NETWORK, {
        subnet: "192.168.0.0/24",
        method: "nmap",
      })
    ).resolves.toMatchObject({
      subnet: "192.168.0.0/24",
    });
  });
});
