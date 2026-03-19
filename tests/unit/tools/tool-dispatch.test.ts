/**
 * Unit tests — class-first command-map dispatch for BaseTool subclasses (#161).
 *
 * Verifies that each refactored tool class dispatches to named instance methods
 * via its internal command map, and rejects unknown tool names.
 */

// ── NetworkTools ────────────────────────────────────────────────────────────

const mockNetPing = jest.fn(async () => ({ alive: true }));
const mockNetScanNetwork = jest.fn(async () => ({ hosts: [] }));
const mockNetScanPorts = jest.fn(async () => ({ ports: [] }));
const mockNetConnectSsh = jest.fn(async () => ({ output: "" }));
const mockNetHttpRequest = jest.fn(async () => ({ status: 200 }));
const mockNetWakeOnLan = jest.fn(async () => ({ sent: true }));

jest.mock("@/lib/tools/network-tools", () => {
  const actual = jest.requireActual("@/lib/tools/network-tools");
  return {
    ...actual,
    // Override internal runtime classes used by the instance methods
  };
});

// Patch the NetworkRuntime/NetworkPingRuntime statics before tests
jest.mock("net", () => ({}));
jest.mock("node:net", () => ({}));

// We test dispatch via mocking at the class method level
describe("NetworkTools — command-map dispatch", () => {
  let NetworkTools: typeof import("@/lib/tools/network-tools").NetworkTools;
  let NET_TOOL_NAMES: typeof import("@/lib/tools/network-tools").NET_TOOL_NAMES;

  beforeAll(async () => {
    ({ NetworkTools, NET_TOOL_NAMES } = await import("@/lib/tools/network-tools"));
  });

  test("dispatches each tool name to its named instance method", async () => {
    const tool = new NetworkTools();

    // Spy on each named method
    const spies = {
      ping: jest.spyOn(tool as any, "ping").mockResolvedValue({ alive: true }),
      scanNetwork: jest.spyOn(tool as any, "scanNetwork").mockResolvedValue({}),
      scanPorts: jest.spyOn(tool as any, "scanPorts").mockResolvedValue({}),
      connectSsh: jest.spyOn(tool as any, "connectSsh").mockResolvedValue({}),
      httpRequest: jest.spyOn(tool as any, "httpRequest").mockResolvedValue({}),
      wakeOnLan: jest.spyOn(tool as any, "wakeOnLan").mockResolvedValue({}),
    };

    const ctx = {} as any;

    await tool.execute(NET_TOOL_NAMES.PING, {}, ctx);
    await tool.execute(NET_TOOL_NAMES.SCAN_NETWORK, {}, ctx);
    await tool.execute(NET_TOOL_NAMES.SCAN_PORTS, {}, ctx);
    await tool.execute(NET_TOOL_NAMES.CONNECT_SSH, {}, ctx);
    await tool.execute(NET_TOOL_NAMES.HTTP_REQUEST, {}, ctx);
    await tool.execute(NET_TOOL_NAMES.WAKE_ON_LAN, {}, ctx);

    expect(spies.ping).toHaveBeenCalledTimes(1);
    expect(spies.scanNetwork).toHaveBeenCalledTimes(1);
    expect(spies.scanPorts).toHaveBeenCalledTimes(1);
    expect(spies.connectSsh).toHaveBeenCalledTimes(1);
    expect(spies.httpRequest).toHaveBeenCalledTimes(1);
    expect(spies.wakeOnLan).toHaveBeenCalledTimes(1);
  });

  test("throws for unknown tool name", async () => {
    const tool = new NetworkTools();
    await expect(tool.execute("builtin.net_unknown", {}, {} as any))
      .rejects.toThrow("Unknown built-in network tool");
  });
});

// ── FsTools ────────────────────────────────────────────────────────────────

describe("FsTools — command-map dispatch", () => {
  let FsTools: typeof import("@/lib/tools/fs-tools").FsTools;
  let FS_TOOL_NAMES: typeof import("@/lib/tools/fs-tools").FS_TOOL_NAMES;

  beforeAll(async () => {
    ({ FsTools, FS_TOOL_NAMES } = await import("@/lib/tools/fs-tools"));
  });

  test("dispatches each FS tool to its named instance method", async () => {
    const tool = new FsTools();
    const methodNames = [
      "readFile", "extractText", "readDirectory", "fileInfo",
      "searchFiles", "createFile", "updateFile", "deleteFile",
      "deleteDirectory", "executeScript",
    ];
    const spies: jest.SpyInstance[] = methodNames.map((m) =>
      jest.spyOn(tool as any, m).mockResolvedValue({})
    );

    const ctx = {} as any;
    await tool.execute(FS_TOOL_NAMES.READ_FILE, {}, ctx);
    await tool.execute(FS_TOOL_NAMES.EXTRACT_TEXT, {}, ctx);
    await tool.execute(FS_TOOL_NAMES.READ_DIR, {}, ctx);
    await tool.execute(FS_TOOL_NAMES.FILE_INFO, {}, ctx);
    await tool.execute(FS_TOOL_NAMES.SEARCH_FILES, {}, ctx);
    await tool.execute(FS_TOOL_NAMES.CREATE_FILE, {}, ctx);
    await tool.execute(FS_TOOL_NAMES.UPDATE_FILE, {}, ctx);
    await tool.execute(FS_TOOL_NAMES.DELETE_FILE, {}, ctx);
    await tool.execute(FS_TOOL_NAMES.DELETE_DIR, {}, ctx);
    await tool.execute(FS_TOOL_NAMES.EXECUTE_SCRIPT, {}, ctx);

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  test("throws for unknown FS tool name", async () => {
    const tool = new FsTools();
    await expect(tool.execute("builtin.fs_unknown", {}, {} as any))
      .rejects.toThrow("Unknown built-in fs tool");
  });
});

// ── AlexaTools ─────────────────────────────────────────────────────────────

jest.mock("@/lib/db/log-queries", () => ({ getAppConfig: jest.fn(() => null) }));

describe("AlexaTools — command-map dispatch", () => {
  let AlexaTools: typeof import("@/lib/tools/alexa-tools").AlexaTools;

  beforeAll(async () => {
    ({ AlexaTools } = await import("@/lib/tools/alexa-tools"));
  });

  test("dispatches all 14 Alexa tool names to named instance methods", async () => {
    const tool = new AlexaTools();
    const toolNames = [
      "builtin.alexa_announce",
      "builtin.alexa_get_bedroom_state",
      "builtin.alexa_list_lights",
      "builtin.alexa_set_light_power",
      "builtin.alexa_set_light_brightness",
      "builtin.alexa_set_light_color",
      "builtin.alexa_get_music_status",
      "builtin.alexa_get_device_volumes",
      "builtin.alexa_set_device_volume",
      "builtin.alexa_adjust_device_volume",
      "builtin.alexa_get_all_sensor_data",
      "builtin.alexa_list_smarthome_devices",
      "builtin.alexa_get_dnd_status",
      "builtin.alexa_set_dnd_status",
    ];
    const methodNames = [
      "announce", "getBedroomState", "listLights", "setLightPower",
      "setLightBrightness", "setLightColor", "getMusicStatus", "getDeviceVolumes",
      "setDeviceVolume", "adjustDeviceVolume", "getAllSensorData", "listSmarthomeDevices",
      "getDndStatus", "setDndStatus",
    ];

    const spies: jest.SpyInstance[] = methodNames.map((m) =>
      jest.spyOn(tool as any, m).mockResolvedValue({})
    );

    const ctx = {} as any;
    for (const name of toolNames) {
      await tool.execute(name, {}, ctx);
    }

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  test("throws for unknown Alexa tool name", async () => {
    const tool = new AlexaTools();
    await expect(tool.execute("builtin.alexa_unknown", {}, {} as any))
      .rejects.toThrow("Unknown Alexa tool");
  });
});

// ── WebTools ───────────────────────────────────────────────────────────────

jest.mock("@/lib/db/search-provider-queries", () => ({
  getWebSearchProviderConfig: jest.fn(() => []),
}));

jest.mock("@/lib/agent/ssrf", () => ({
  assertExternalUrlWithResolve: jest.fn().mockResolvedValue(undefined),
}));

describe("WebTools — command-map dispatch", () => {
  let WebTools: typeof import("@/lib/tools/web-tools").WebTools;

  beforeAll(async () => {
    ({ WebTools } = await import("@/lib/tools/web-tools"));
  });

  test("dispatches all 3 web tool names to named instance methods", async () => {
    const tool = new WebTools();
    const spies = {
      webSearchCmd: jest.spyOn(tool as any, "webSearchCmd").mockResolvedValue({ results: [] }),
      webFetchCmd: jest.spyOn(tool as any, "webFetchCmd").mockResolvedValue({ content: "" }),
      webExtractCmd: jest.spyOn(tool as any, "webExtractCmd").mockResolvedValue({ content: "" }),
    };

    const ctx = {} as any;
    await tool.execute("builtin.web_search", { query: "test" }, ctx);
    await tool.execute("builtin.web_fetch", { url: "http://test.com" }, ctx);
    await tool.execute("builtin.web_extract", { url: "http://test.com" }, ctx);

    expect(spies.webSearchCmd).toHaveBeenCalledTimes(1);
    expect(spies.webFetchCmd).toHaveBeenCalledTimes(1);
    expect(spies.webExtractCmd).toHaveBeenCalledTimes(1);
  });

  test("throws for unknown web tool name", async () => {
    const tool = new WebTools();
    await expect(tool.execute("builtin.web_unknown", {}, {} as any))
      .rejects.toThrow("Unknown built-in web tool");
  });
});
