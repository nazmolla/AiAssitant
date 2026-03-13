/**
 * Unit tests — Built-in Alexa Smart Home tools
 *
 * Tests:
 * - Tool definition correctness (14 tools, naming, schemas)
 * - Credential helpers (get/save/require)
 * - isAlexaTool detection
 * - ALEXA_TOOLS_REQUIRING_APPROVAL list
 * - executeAlexaTool routing and error handling
 * - Individual tool handler validation
 */

jest.mock("@/lib/db/queries", () => {
  const store = new Map<string, string>();
  return {
    getAppConfig: jest.fn((key: string) => store.get(key)),
    setAppConfig: jest.fn((key: string, val: string) => { store.set(key, val); }),
    __store: store,
  };
});

jest.mock("@/lib/db/crypto", () => ({
  encryptField: jest.fn((v: string) => `ENC:${v}`),
  decryptField: jest.fn((v: string) => v.startsWith("ENC:") ? v.slice(4) : null),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { getAppConfig, setAppConfig } from "@/lib/db/queries";
import { encryptField, decryptField } from "@/lib/db/crypto";
import {
  BUILTIN_ALEXA_TOOLS,
  ALEXA_TOOLS_REQUIRING_APPROVAL,
  isAlexaTool,
  getAlexaConfig,
  saveAlexaConfig,
  executeAlexaTool,
} from "@/lib/tools/alexa-tools";

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the in-memory store
  const { __store } = require("@/lib/db/queries");
  __store.clear();
  mockFetch.mockReset();
});

/* ══════════════════════════════════════════════════════════════════
   Tool Definitions
   ══════════════════════════════════════════════════════════════════ */

describe("BUILTIN_ALEXA_TOOLS", () => {
  test("contains exactly 14 tools", () => {
    expect(BUILTIN_ALEXA_TOOLS).toHaveLength(14);
  });

  test("all tool names start with 'builtin.alexa_'", () => {
    for (const tool of BUILTIN_ALEXA_TOOLS) {
      expect(tool.name).toMatch(/^builtin\.alexa_/);
    }
  });

  test("each tool has name, description, and inputSchema", () => {
    for (const tool of BUILTIN_ALEXA_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  test("expected tool names are present", () => {
    const names = BUILTIN_ALEXA_TOOLS.map((t) => t.name);
    expect(names).toContain("builtin.alexa_announce");
    expect(names).toContain("builtin.alexa_get_bedroom_state");
    expect(names).toContain("builtin.alexa_list_lights");
    expect(names).toContain("builtin.alexa_set_light_power");
    expect(names).toContain("builtin.alexa_set_light_brightness");
    expect(names).toContain("builtin.alexa_set_light_color");
    expect(names).toContain("builtin.alexa_get_music_status");
    expect(names).toContain("builtin.alexa_get_device_volumes");
    expect(names).toContain("builtin.alexa_set_device_volume");
    expect(names).toContain("builtin.alexa_adjust_device_volume");
    expect(names).toContain("builtin.alexa_get_all_sensor_data");
    expect(names).toContain("builtin.alexa_list_smarthome_devices");
    expect(names).toContain("builtin.alexa_get_dnd_status");
    expect(names).toContain("builtin.alexa_set_dnd_status");
  });

  test("announce tool requires 'name' and 'message' parameters", () => {
    const announce = BUILTIN_ALEXA_TOOLS.find((t) => t.name === "builtin.alexa_announce");
    expect(announce?.inputSchema.required).toContain("name");
    expect(announce?.inputSchema.required).toContain("message");
  });

  test("set_light_power requires 'on' parameter", () => {
    const tool = BUILTIN_ALEXA_TOOLS.find((t) => t.name === "builtin.alexa_set_light_power");
    expect(tool?.inputSchema.required).toContain("on");
  });

  test("set_light_brightness requires 'level' parameter", () => {
    const tool = BUILTIN_ALEXA_TOOLS.find((t) => t.name === "builtin.alexa_set_light_brightness");
    expect(tool?.inputSchema.required).toContain("level");
  });

  test("set_light_color requires 'mode' and 'value' parameters", () => {
    const tool = BUILTIN_ALEXA_TOOLS.find((t) => t.name === "builtin.alexa_set_light_color");
    expect(tool?.inputSchema.required).toContain("mode");
    expect(tool?.inputSchema.required).toContain("value");
  });

  test("set_dnd_status requires deviceSerialNumber, deviceType, and enabled", () => {
    const tool = BUILTIN_ALEXA_TOOLS.find((t) => t.name === "builtin.alexa_set_dnd_status");
    expect(tool?.inputSchema.required).toContain("deviceSerialNumber");
    expect(tool?.inputSchema.required).toContain("deviceType");
    expect(tool?.inputSchema.required).toContain("enabled");
  });
});

/* ══════════════════════════════════════════════════════════════════
   ALEXA_TOOLS_REQUIRING_APPROVAL
   ══════════════════════════════════════════════════════════════════ */

describe("ALEXA_TOOLS_REQUIRING_APPROVAL", () => {
  test("contains exactly 7 tools", () => {
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toHaveLength(7);
  });

  test("includes control/mutating tools", () => {
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_announce");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_set_light_power");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_set_light_brightness");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_set_light_color");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_set_device_volume");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_adjust_device_volume");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_set_dnd_status");
  });

  test("excludes read-only tools", () => {
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.alexa_get_bedroom_state");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.alexa_list_lights");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.alexa_get_music_status");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.alexa_get_device_volumes");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.alexa_get_all_sensor_data");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.alexa_list_smarthome_devices");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.alexa_get_dnd_status");
  });
});

/* ══════════════════════════════════════════════════════════════════
   isAlexaTool
   ══════════════════════════════════════════════════════════════════ */

describe("isAlexaTool", () => {
  test("returns true for all Alexa tool names", () => {
    for (const tool of BUILTIN_ALEXA_TOOLS) {
      expect(isAlexaTool(tool.name)).toBe(true);
    }
  });

  test("returns false for non-Alexa tools", () => {
    expect(isAlexaTool("builtin.web_search")).toBe(false);
    expect(isAlexaTool("builtin.fs_read_file")).toBe(false);
    expect(isAlexaTool("mcp_tool_1")).toBe(false);
    expect(isAlexaTool("")).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════
   Credential Helpers
   ══════════════════════════════════════════════════════════════════ */

describe("getAlexaConfig", () => {
  test("returns null when credentials are not configured", () => {
    (getAppConfig as jest.Mock).mockReturnValue(undefined);
    expect(getAlexaConfig()).toBeNull();
  });

  test("returns null when only one credential is set", () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:some-ubid";
      return undefined;
    });
    expect(getAlexaConfig()).toBeNull();
  });

  test("returns decrypted credentials when both are configured", () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:my-ubid-value";
      if (key === "alexa.at_main") return "ENC:my-at-value";
      return undefined;
    });

    const result = getAlexaConfig();
    expect(result).toEqual({ ubidMain: "my-ubid-value", atMain: "my-at-value" });
    expect(decryptField).toHaveBeenCalledWith("ENC:my-ubid-value");
    expect(decryptField).toHaveBeenCalledWith("ENC:my-at-value");
  });

  test("returns null when decryption fails", () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "INVALID_CIPHER";
      if (key === "alexa.at_main") return "INVALID_CIPHER";
      return undefined;
    });

    expect(getAlexaConfig()).toBeNull();
  });
});

describe("saveAlexaConfig", () => {
  test("encrypts and stores both credentials", () => {
    saveAlexaConfig("ubid-value-123", "at-value-456");

    expect(encryptField).toHaveBeenCalledWith("ubid-value-123");
    expect(encryptField).toHaveBeenCalledWith("at-value-456");
    expect(setAppConfig).toHaveBeenCalledWith("alexa.ubid_main", "ENC:ubid-value-123");
    expect(setAppConfig).toHaveBeenCalledWith("alexa.at_main", "ENC:at-value-456");
  });
});

/* ══════════════════════════════════════════════════════════════════
   executeAlexaTool — error cases
   ══════════════════════════════════════════════════════════════════ */

describe("executeAlexaTool", () => {
  test("throws when credentials are not configured", async () => {
    (getAppConfig as jest.Mock).mockReturnValue(undefined);

    await expect(
      executeAlexaTool("builtin.alexa_list_lights", {})
    ).rejects.toThrow("Alexa credentials not configured");
  });

  test("throws for unknown tool name", async () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid";
      if (key === "alexa.at_main") return "ENC:at";
      return undefined;
    });

    await expect(
      executeAlexaTool("builtin.alexa_nonexistent", {})
    ).rejects.toThrow("Unknown Alexa tool");
  });

  test("routes to announce handler and validates missing args", async () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid";
      if (key === "alexa.at_main") return "ENC:at";
      return undefined;
    });

    await expect(
      executeAlexaTool("builtin.alexa_announce", {})
    ).rejects.toThrow('"name" and "message" are required');
  });

  test("announce validates message length (>145 chars)", async () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid";
      if (key === "alexa.at_main") return "ENC:at";
      return undefined;
    });

    await expect(
      executeAlexaTool("builtin.alexa_announce", {
        name: "TestDevice",
        message: "x".repeat(146),
      })
    ).rejects.toThrow("145 characters");
  });

  test("announce validates name length (>40 chars)", async () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid";
      if (key === "alexa.at_main") return "ENC:at";
      return undefined;
    });

    await expect(
      executeAlexaTool("builtin.alexa_announce", {
        name: "x".repeat(41),
        message: "Hello",
      })
    ).rejects.toThrow("40 characters");
  });

  test("set_light_power validates 'on' is boolean", async () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid";
      if (key === "alexa.at_main") return "ENC:at";
      return undefined;
    });

    await expect(
      executeAlexaTool("builtin.alexa_set_light_power", { on: "yes" })
    ).rejects.toThrow("'on' must be a boolean");
  });

  test("set_light_brightness validates range", async () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid";
      if (key === "alexa.at_main") return "ENC:at";
      return undefined;
    });

    await expect(
      executeAlexaTool("builtin.alexa_set_light_brightness", { level: 150 })
    ).rejects.toThrow("Brightness must be 0–100");
  });

  test("set_light_color validates mode/value required", async () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid";
      if (key === "alexa.at_main") return "ENC:at";
      return undefined;
    });

    await expect(
      executeAlexaTool("builtin.alexa_set_light_color", {})
    ).rejects.toThrow("mode and value are required");
  });

  test("set_light_color validates Kelvin range", async () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid";
      if (key === "alexa.at_main") return "ENC:at";
      return undefined;
    });

    // Mock the GraphQL endpoint to return a light device (getLightApplianceId)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          endpoints: {
            items: [{
              displayCategories: { primary: { value: "LIGHT" } },
              legacyAppliance: { applianceId: "LIGHT-001" },
            }],
          },
        },
      }),
    });

    await expect(
      executeAlexaTool("builtin.alexa_set_light_color", {
        mode: "tempK",
        value: 1000,
      })
    ).rejects.toThrow("Kelvin must be 2200–6500");
  });

  test("set_device_volume validates range", async () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid";
      if (key === "alexa.at_main") return "ENC:at";
      return undefined;
    });

    await expect(
      executeAlexaTool("builtin.alexa_set_device_volume", { volume: -1 })
    ).rejects.toThrow("Volume must be 0–100");
  });

  test("adjust_device_volume validates range", async () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid";
      if (key === "alexa.at_main") return "ENC:at";
      return undefined;
    });

    await expect(
      executeAlexaTool("builtin.alexa_adjust_device_volume", { amount: 200 })
    ).rejects.toThrow("Amount must be -100 to +100");
  });

  test("set_dnd_status validates required args", async () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid";
      if (key === "alexa.at_main") return "ENC:at";
      return undefined;
    });

    await expect(
      executeAlexaTool("builtin.alexa_set_dnd_status", { enabled: true })
    ).rejects.toThrow("deviceSerialNumber and deviceType are required");
  });

  test("set_dnd_status validates 'enabled' is boolean", async () => {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid";
      if (key === "alexa.at_main") return "ENC:at";
      return undefined;
    });

    await expect(
      executeAlexaTool("builtin.alexa_set_dnd_status", {
        deviceSerialNumber: "DSN123",
        deviceType: "TYPE1",
        enabled: "yes",
      })
    ).rejects.toThrow("enabled must be a boolean");
  });
});

/* ══════════════════════════════════════════════════════════════════
   executeAlexaTool — successful API calls
   ══════════════════════════════════════════════════════════════════ */

describe("executeAlexaTool — API calls", () => {
  function setupCreds() {
    (getAppConfig as jest.Mock).mockImplementation((key: string) => {
      if (key === "alexa.ubid_main") return "ENC:ubid-test";
      if (key === "alexa.at_main") return "ENC:at-test";
      return undefined;
    });
  }

  test("get_device_volumes calls the volumes endpoint", async () => {
    setupCreds();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ volumes: [{ deviceType: "A1", dsn: "DSN1", speakerVolume: 50 }] }),
    });

    const result = await executeAlexaTool("builtin.alexa_get_device_volumes", {});
    expect(result).toEqual({ volumes: [{ deviceType: "A1", dsn: "DSN1", speakerVolume: 50 }] });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain("allDeviceVolumes");
  });

  test("get_dnd_status returns device DND list", async () => {
    setupCreds();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        doNotDisturbDeviceStatusList: [
          { deviceSerialNumber: "DSN1", deviceType: "TYPE1", enabled: false },
          { deviceSerialNumber: "DSN2", deviceType: "TYPE2", enabled: true },
        ],
      }),
    });

    const result = (await executeAlexaTool("builtin.alexa_get_dnd_status", {})) as {
      devices: Array<{ deviceSerialNumber: string; dndEnabled: boolean }>;
      totalDevices: number;
      enabledCount: number;
    };

    expect(result.totalDevices).toBe(2);
    expect(result.enabledCount).toBe(1);
    expect(result.devices[0].dndEnabled).toBe(false);
    expect(result.devices[1].dndEnabled).toBe(true);
  });

  test("set_dnd_status sends PUT request", async () => {
    setupCreds();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceSerialNumber: "DSN1", deviceType: "TYPE1", enabled: true }),
    });

    const result = (await executeAlexaTool("builtin.alexa_set_dnd_status", {
      deviceSerialNumber: "DSN1",
      deviceType: "TYPE1",
      enabled: true,
    })) as { success: boolean; dndEnabled: boolean };

    expect(result.success).toBe(true);
    expect(result.dndEnabled).toBe(true);
    expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
  });

  test("announce sends POST to comms endpoint", async () => {
    setupCreds();
    // First call: getAccountInfo
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ directedId: "CUST123", signedInUser: true }],
    });
    // Second call: announcement POST
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        statuses: [{ playbackStatus: "SUCCESS", deliveredTime: "2024-01-01T00:00:00Z" }],
      }),
    });

    const result = (await executeAlexaTool("builtin.alexa_announce", {
      name: "Kitchen",
      message: "Dinner is ready",
    })) as { playbackStatus: string; deliveredTime: string };

    expect(result.playbackStatus).toBe("SUCCESS");
    expect(result.deliveredTime).toBe("2024-01-01T00:00:00Z");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test("API error surfaces with status code", async () => {
    setupCreds();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(
      executeAlexaTool("builtin.alexa_get_device_volumes", {})
    ).rejects.toThrow("Alexa API 401");
  });
});
