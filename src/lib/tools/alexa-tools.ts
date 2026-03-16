/**
 * Alexa Smart Home Built-in Tools
 *
 * Native integration with Amazon Alexa smart home APIs.
 * Ported from sijan2/alexa-mcp-server (Cloudflare Worker)
 * into Nexus as direct built-in tools.
 *
 * Credentials (UBID_MAIN, AT_MAIN) are stored encrypted in app_config
 * and configurable via Settings → Alexa.
 */

import type { ToolDefinition } from "@/lib/llm";
import { getAppConfig, setAppConfig } from "@/lib/db/queries";
import { encryptField, decryptField } from "@/lib/db/crypto";
import { BaseTool, type ToolExecutionContext, registerToolCategory } from "./base-tool";

/* ══════════════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════════════ */

const PHOENIX_ENDPOINT = "https://alexa.amazon.com/api/phoenix/state";
const GRAPHQL_ENDPOINT = "https://alexa.amazon.com/nexus/v1/graphql";
const DEVICES_ENDPOINT = "https://alexa.amazon.com/api/devices-v2/device?cached=true";
const VOLUMES_ENDPOINT = "https://alexa.amazon.com/api/devices/deviceType/dsn/audio/v1/allDeviceVolumes";
const DND_LIST_ENDPOINT = "https://alexa.amazon.com/api/dnd/device-status-list";
const DND_STATUS_ENDPOINT = "https://alexa.amazon.com/api/dnd/status";
const COMMS_ACCOUNTS_ENDPOINT = "https://alexa-comms-mobile-service.amazon.com/accounts";

const USER_AGENT =
  "PitanguiBridge/2.2.629941.0-[PLATFORM=Android][MANUFACTURER=samsung][RELEASE=12][BRAND=Redmi][SDK=31][MODEL=SM-S928B]";

const SUPPORTED_COLORS = [
  "warm_white", "soft_white", "white", "daylight_white", "cool_white",
  "red", "crimson", "salmon", "orange", "gold", "yellow", "green",
  "turquoise", "cyan", "sky_blue", "blue", "purple", "magenta", "pink", "lavender",
];
const WHITE_COLORS = ["warm_white", "soft_white", "white", "daylight_white", "cool_white"];

/* ══════════════════════════════════════════════════════════════════
   In-memory cache (5-minute TTL)
   ══════════════════════════════════════════════════════════════════ */

const cache = new Map<string, { value: unknown; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const c = cache.get(key);
  if (c && Date.now() - c.ts < CACHE_TTL) return c.value as T;
  return null;
}
function setCache(key: string, value: unknown) {
  cache.set(key, { value, ts: Date.now() });
}

/* ══════════════════════════════════════════════════════════════════
   Credential helpers
   ══════════════════════════════════════════════════════════════════ */

interface AlexaCreds { ubidMain: string; atMain: string }

export function getAlexaConfig(): AlexaCreds | null {
  const raw1 = getAppConfig("alexa.ubid_main");
  const raw2 = getAppConfig("alexa.at_main");
  if (!raw1 || !raw2) return null;
  const ubidMain = decryptField(raw1);
  const atMain = decryptField(raw2);
  if (!ubidMain || !atMain) return null;
  return { ubidMain, atMain };
}

export function saveAlexaConfig(ubidMain: string, atMain: string): void {
  setAppConfig("alexa.ubid_main", encryptField(ubidMain)!);
  setAppConfig("alexa.at_main", encryptField(atMain)!);
}

function requireCreds(): AlexaCreds {
  const c = getAlexaConfig();
  if (!c) throw new Error("Alexa credentials not configured. Go to Settings → Alexa to set UBID_MAIN and AT_MAIN.");
  return c;
}

/* ══════════════════════════════════════════════════════════════════
   Alexa API helpers
   ══════════════════════════════════════════════════════════════════ */

function buildHeaders(creds: AlexaCreds, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Cookie: `csrf=1; ubid-main=${creds.ubidMain}; at-main=${creds.atMain}`,
    Csrf: "1",
    Accept: "application/json; charset=utf-8",
    "Accept-Language": "en-US",
    "User-Agent": USER_AGENT,
    ...extra,
  };
}

async function alexaFetch(url: string, creds: AlexaCreds, opts: { method?: string; body?: string; extra?: Record<string, string> } = {}) {
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: buildHeaders(creds, opts.extra ?? {}),
    ...(opts.body ? { body: opts.body } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Alexa API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/* ── Dynamic discovery helpers ─────────────────────────────────── */

async function getAccountInfo(creds: AlexaCreds) {
  const ck = "account_info";
  const c = getCached<{ customerId: string }>(ck);
  if (c) return c;

  const data = await alexaFetch(COMMS_ACCOUNTS_ENDPOINT, creds) as Array<{ directedId: string; signedInUser: boolean }>;
  const primary = data.find((a) => a.signedInUser) || data[0];
  if (!primary) throw new Error("No Alexa account found");
  const info = { customerId: primary.directedId };
  setCache(ck, info);
  return info;
}

async function getAlexaDevices(creds: AlexaCreds) {
  const ck = "alexa_devices";
  const c = getCached<{ devices: unknown[] }>(ck);
  if (c) return c.devices;

  const data = await alexaFetch(DEVICES_ENDPOINT, creds) as { devices: unknown[] };
  setCache(ck, data);
  return data.devices;
}

async function getCustomerSmartHomeEndpoints(creds: AlexaCreds) {
  const ck = "customer_shm_endpoints";
  const c = getCached<unknown[]>(ck);
  if (c) return c;

  const query = `
    query CustomerSmartHome {
      endpoints(endpointsQueryParams: { paginationParams: { disablePagination: true } }) {
        items {
          endpointId
          id
          friendlyName
          displayCategories { all { value } primary { value } }
          legacyIdentifiers {
            chrsIdentifier { entityId }
            dmsIdentifier {
              deviceType { type value { text } }
              deviceSerialNumber { type value { text } }
            }
          }
          legacyAppliance { applianceId applianceTypes friendlyName entityId mergedApplianceIds capabilities }
        }
      }
    }`;
  const data = await alexaFetch(GRAPHQL_ENDPOINT, creds, {
    method: "POST",
    body: JSON.stringify({ query }),
    extra: { "Content-Type": "application/json", "X-Amzn-Marketplace-Id": "ATVPDKIKX0DER", "X-Amzn-Client": "AlexaApp", "X-Amzn-Os-Name": "android" },
  }) as { data?: { endpoints?: { items?: unknown[] } } };
  const items = data.data?.endpoints?.items ?? [];
  setCache(ck, items);
  return items;
}

async function getSmartHomeFavorites(creds: AlexaCreds) {
  const ck = "shm_favorites";
  const c = getCached<unknown[]>(ck);
  if (c) return c;

  const query = `
    fragment FavoriteMetadata on Favorite {
      resource { id __typename }
      favoriteFriendlyName
      displayInfo {
        displayCategories {
          primary { isCustomerSpecified isDiscovered value sources __typename }
          all { isCustomerSpecified isDiscovered value sources __typename }
          __typename
        }
        __typename
      }
      alternateIdentifiers {
        legacyIdentifiers {
          chrsIdentifier { entityId __typename }
          dmsIdentifier {
            deviceSerialNumber { type value { text __typename } __typename }
            deviceType { type value { text __typename } __typename }
            __typename
          }
          __typename
        }
        __typename
      }
      type rank active variant __typename
    }
    query ListFavoritesForHomeChannel($requestedTypes: [String!]) {
      favorites(listFavoritesInput: {requestedTypes: $requestedTypes}) {
        favorites { ...FavoriteMetadata __typename }
        __typename
      }
    }`;
  const data = await alexaFetch(GRAPHQL_ENDPOINT, creds, {
    method: "POST",
    body: JSON.stringify({
      operationName: "ListFavoritesForHomeChannel",
      variables: { requestedTypes: ["AEA", "ALEXA_LIST", "AWAY_LIGHTING", "DEVICE_SHORTCUT", "DTG", "ENDPOINT", "SHORTCUT", "STATIC_ENTERTAINMENT"] },
      query,
    }),
    extra: { "Content-Type": "application/json", "X-Amzn-Marketplace-Id": "ATVPDKIKX0DER", "X-Amzn-Client": "AlexaApp", "X-Amzn-Os-Name": "android" },
  }) as { data?: { favorites?: { favorites?: unknown[] } } };
  const favs = data.data?.favorites?.favorites ?? [];
  setCache(ck, favs);
  return favs;
}

async function getSmartHomeEntities(creds: AlexaCreds) {
  const favs = await getSmartHomeFavorites(creds) as Array<{ active: boolean; type: string }>;
  return favs.filter((f) => f.active && f.type === "ENDPOINT");
}

function extractEntityId(device: Record<string, unknown>): string {
  const alt = device.alternateIdentifiers as Record<string, unknown> | undefined;
  const leg = alt?.legacyIdentifiers as Record<string, unknown> | undefined;
  const chrs = leg?.chrsIdentifier as { entityId?: string } | undefined;
  if (chrs?.entityId) return chrs.entityId;
  const ident = device.identifier as { entityId?: string } | undefined;
  if (ident?.entityId) return ident.entityId;
  const res = device.resource as { id?: string } | undefined;
  if (res?.id?.includes("endpoint.")) return res.id.replace("amzn1.alexa.endpoint.", "");
  return (device.serialNumber as string) || res?.id || "";
}

function buildEndpointId(entityId: string): string {
  return entityId.startsWith("amzn1.alexa.endpoint.") ? entityId : `amzn1.alexa.endpoint.${entityId}`;
}

async function getPrimaryLight(creds: AlexaCreds) {
  const entities = await getSmartHomeEntities(creds) as Array<Record<string, unknown>>;
  const lights = entities.filter((d) => {
    const di = d.displayInfo as { displayCategories?: { primary?: { value?: string } } } | undefined;
    return di?.displayCategories?.primary?.value === "LIGHT";
  });
  if (lights.length === 0) throw new Error("No smart home light devices found");
  return lights[0];
}

async function getLightApplianceId(creds: AlexaCreds): Promise<string> {
  const endpoints = await getCustomerSmartHomeEndpoints(creds) as Array<Record<string, unknown>>;
  const lightDevice = endpoints.find((ep) => {
    const dc = ep.displayCategories as { primary?: { value?: string } } | undefined;
    return dc?.primary?.value === "LIGHT";
  });
  if (!lightDevice) throw new Error("No light device found");
  const la = lightDevice.legacyAppliance as { applianceId?: string } | undefined;
  return la?.applianceId ?? "";
}

async function getEchoDeviceEntityId(creds: AlexaCreds): Promise<string> {
  const endpoints = await getCustomerSmartHomeEndpoints(creds) as Array<Record<string, unknown>>;
  const echo = endpoints.find((ep) => {
    const dc = ep.displayCategories as { primary?: { value?: string } } | undefined;
    return dc?.primary?.value === "ALEXA_VOICE_ENABLED";
  });
  if (!echo) throw new Error("No Echo device found");
  const leg = echo.legacyIdentifiers as { chrsIdentifier?: { entityId?: string } } | undefined;
  return leg?.chrsIdentifier?.entityId || (echo.entityId as string) || "";
}

/* ══════════════════════════════════════════════════════════════════
   Tool Definitions
   ══════════════════════════════════════════════════════════════════ */

export const BUILTIN_ALEXA_TOOLS: ToolDefinition[] = [
  {
    name: "builtin.alexa_announce",
    description:
      "Make an announcement on Alexa devices. Sends a text-to-speech message to the specified Echo device or all devices ('everywhere'). " +
      "Blocked during quiet hours (10 PM–8 AM) when called by the scheduler.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Target device name or 'everywhere' for all devices." },
        message: { type: "string", description: "The message to announce (max 145 characters)." },
      },
      required: ["name", "message"],
    },
  },
  {
    name: "builtin.alexa_get_bedroom_state",
    description:
      "Get the current state of bedroom sensors and devices. Returns temperature, illuminance, motion state, and light state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "builtin.alexa_list_lights",
    description: "List all smart home light devices connected to Alexa with their IDs and capabilities.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "builtin.alexa_set_light_power",
    description: "Turn a smart light on or off.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Light entity ID (optional — auto-detected if only one light)." },
        on: { type: "boolean", description: "true to turn on, false to turn off." },
      },
      required: ["on"],
    },
  },
  {
    name: "builtin.alexa_set_light_brightness",
    description: "Set the brightness level of a smart light.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Light entity ID (optional — auto-detected if only one light)." },
        level: { type: "number", description: "Brightness level from 0 to 100." },
      },
      required: ["level"],
    },
  },
  {
    name: "builtin.alexa_set_light_color",
    description: "Set the color of a smart light by color name or Kelvin temperature.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Light entity ID (optional — auto-detected if only one light)." },
        mode: { type: "string", enum: ["name", "tempK"], description: "'name' for color name or 'tempK' for Kelvin temperature." },
        value: {
          description: "Color name (e.g. 'warm_white', 'blue', 'red') or Kelvin temperature number (2200–6500).",
        },
      },
      required: ["mode", "value"],
    },
  },
  {
    name: "builtin.alexa_get_music_status",
    description: "Get the currently playing music status from the primary Alexa device. Shows track, artist, provider, and progress.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "builtin.alexa_get_device_volumes",
    description: "Get the volume levels of all Alexa devices.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "builtin.alexa_set_device_volume",
    description: "Set the volume of an Alexa device to a specific level.",
    inputSchema: {
      type: "object",
      properties: {
        deviceType: { type: "string", description: "Device type (optional — auto-detected if only one device)." },
        dsn: { type: "string", description: "Device serial number (optional — auto-detected if only one device)." },
        volume: { type: "number", description: "Volume level from 0 to 100." },
      },
      required: ["volume"],
    },
  },
  {
    name: "builtin.alexa_adjust_device_volume",
    description: "Adjust the volume of an Alexa device by a relative amount.",
    inputSchema: {
      type: "object",
      properties: {
        deviceType: { type: "string", description: "Device type (optional — auto-detected if only one device)." },
        dsn: { type: "string", description: "Device serial number (optional — auto-detected if only one device)." },
        amount: { type: "number", description: "Volume adjustment amount (-100 to +100)." },
      },
      required: ["amount"],
    },
  },
  {
    name: "builtin.alexa_get_all_sensor_data",
    description: "Get data from all Alexa sensors including temperature, illuminance, and motion detection.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "builtin.alexa_list_smarthome_devices",
    description: "List all smart home devices connected to Alexa with their capabilities, categories, and endpoint details.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "builtin.alexa_get_dnd_status",
    description: "Get the Do Not Disturb status for all Alexa devices.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "builtin.alexa_set_dnd_status",
    description: "Enable or disable Do Not Disturb on an Alexa device.",
    inputSchema: {
      type: "object",
      properties: {
        deviceSerialNumber: { type: "string", description: "Device serial number." },
        deviceType: { type: "string", description: "Device type identifier." },
        enabled: { type: "boolean", description: "true to enable DND, false to disable." },
      },
      required: ["deviceSerialNumber", "deviceType", "enabled"],
    },
  },
];

const ALEXA_TOOL_NAMES = new Set(BUILTIN_ALEXA_TOOLS.map((t) => t.name));

export const ALEXA_TOOLS_REQUIRING_APPROVAL: string[] = [
  "builtin.alexa_announce",
  "builtin.alexa_set_light_power",
  "builtin.alexa_set_light_brightness",
  "builtin.alexa_set_light_color",
  "builtin.alexa_set_device_volume",
  "builtin.alexa_adjust_device_volume",
  "builtin.alexa_set_dnd_status",
];

/* ══════════════════════════════════════════════════════════════════
   Public API (follows existing tool-module pattern)
   ══════════════════════════════════════════════════════════════════ */

export function isAlexaTool(name: string): boolean {
  return ALEXA_TOOL_NAMES.has(name);
}

export async function executeAlexaTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const creds = requireCreds();

  switch (name) {
    case "builtin.alexa_announce":
      return handleAnnounce(creds, args);
    case "builtin.alexa_get_bedroom_state":
      return handleGetBedroomState(creds);
    case "builtin.alexa_list_lights":
      return handleListLights(creds);
    case "builtin.alexa_set_light_power":
      return handleSetLightPower(creds, args);
    case "builtin.alexa_set_light_brightness":
      return handleSetLightBrightness(creds, args);
    case "builtin.alexa_set_light_color":
      return handleSetLightColor(creds, args);
    case "builtin.alexa_get_music_status":
      return handleGetMusicStatus(creds);
    case "builtin.alexa_get_device_volumes":
      return handleGetDeviceVolumes(creds);
    case "builtin.alexa_set_device_volume":
      return handleSetDeviceVolume(creds, args);
    case "builtin.alexa_adjust_device_volume":
      return handleAdjustDeviceVolume(creds, args);
    case "builtin.alexa_get_all_sensor_data":
      return handleGetAllSensorData(creds);
    case "builtin.alexa_list_smarthome_devices":
      return handleListSmarthomeDevices(creds);
    case "builtin.alexa_get_dnd_status":
      return handleGetDndStatus(creds);
    case "builtin.alexa_set_dnd_status":
      return handleSetDndStatus(creds, args);
    default:
      throw new Error(`Unknown Alexa tool: ${name}`);
  }
}

/* ══════════════════════════════════════════════════════════════════
   Tool Handlers
   ══════════════════════════════════════════════════════════════════ */

// ── Announce ─────────────────────────────────────────────────────

async function handleAnnounce(creds: AlexaCreds, args: Record<string, unknown>) {
  const name = ((args.name as string) ?? "").trim();
  const message = ((args.message as string) ?? "").trim();
  if (!name || !message) throw new Error('Both "name" and "message" are required.');
  if (name.length > 40) throw new Error("Name must be 40 characters or fewer.");
  if (message.length > 145) throw new Error("Message must be 145 characters or fewer.");

  const accountInfo = await getAccountInfo(creds);
  const url = `https://alexa-comms-mobile-service.amazon.com/users/${accountInfo.customerId}/announcements`;

  const data = await alexaFetch(url, creds, {
    method: "POST",
    body: JSON.stringify({
      type: "announcement/text",
      messageText: message,
      senderFirstName: name,
      senderLastName: "",
      announcementPrefix: "",
    }),
    extra: { "Content-Type": "application/json; charset=utf-8" },
  }) as { statuses?: Array<{ playbackStatus?: string; deliveredTime?: string }> };

  const first = data.statuses?.[0] ?? {};
  return { playbackStatus: first.playbackStatus ?? null, deliveredTime: first.deliveredTime ?? null };
}

// ── Bedroom State ────────────────────────────────────────────────

async function handleGetBedroomState(creds: AlexaCreds) {
  const stateRequests: Array<{ entityId: string; entityType: string }> = [];
  const added = new Set<string>();

  // Strategy 1: Echo device entity ID
  try {
    const echoId = await getEchoDeviceEntityId(creds);
    if (echoId && !added.has(echoId)) { stateRequests.push({ entityId: echoId, entityType: "ENTITY" }); added.add(echoId); }
  } catch { /* skip */ }

  // Strategy 2: Light appliance ID
  try {
    const lightId = await getLightApplianceId(creds);
    if (lightId && !added.has(lightId)) { stateRequests.push({ entityId: lightId, entityType: "APPLIANCE" }); added.add(lightId); }
  } catch { /* skip */ }

  // Strategy 3: All smart home endpoints
  try {
    const endpoints = await getCustomerSmartHomeEndpoints(creds) as Array<Record<string, unknown>>;
    for (const ep of endpoints) {
      const leg = ep.legacyIdentifiers as Record<string, unknown> | undefined;
      const entityId = (leg?.chrsIdentifier as { entityId?: string })?.entityId || (ep.entityId as string);
      if (entityId && !added.has(entityId)) { stateRequests.push({ entityId, entityType: "ENTITY" }); added.add(entityId); }
      const la = ep.legacyAppliance as { applianceId?: string; mergedApplianceIds?: string[] } | undefined;
      if (la?.applianceId && !added.has(la.applianceId)) { stateRequests.push({ entityId: la.applianceId, entityType: "APPLIANCE" }); added.add(la.applianceId); }
      for (const mid of la?.mergedApplianceIds ?? []) {
        if (mid && !added.has(mid)) { stateRequests.push({ entityId: mid, entityType: "APPLIANCE" }); added.add(mid); }
      }
    }
  } catch { /* skip */ }

  // Strategy 4: AlexaBridge entities from devices API
  try {
    const devices = await getAlexaDevices(creds) as Array<Record<string, unknown>>;
    for (const d of devices) {
      const sn = d.serialNumber as string; const dt = d.deviceType as string;
      if (sn && dt) {
        const bid = `AlexaBridge_${sn}@${dt}_${sn}`;
        if (!added.has(bid)) { stateRequests.push({ entityId: bid, entityType: "APPLIANCE" }); added.add(bid); }
      }
    }
  } catch { /* skip */ }

  if (stateRequests.length === 0) return { error: "No devices found" };

  const rawData = await alexaFetch(PHOENIX_ENDPOINT, creds, {
    method: "POST",
    body: JSON.stringify({ stateRequests }),
    extra: { "Content-Type": "application/json; charset=utf-8" },
  }) as Record<string, unknown>;

  // Parse stringified capability states
  const deviceStates = (rawData.deviceStates ?? []) as Array<{ entity: { entityId: string; entityType: string }; capabilityStates: unknown[] }>;
  for (const ds of deviceStates) {
    ds.capabilityStates = ds.capabilityStates.map((cap) => {
      if (typeof cap === "string") try { return JSON.parse(cap); } catch { return cap; }
      return cap;
    });
  }

  let temp: Record<string, unknown> | null = null;
  let lightPower: Record<string, unknown> | null = null;
  let illuminance: Record<string, unknown> | null = null;
  let motionDetection: Record<string, unknown> | null = null;

  for (const ds of deviceStates) {
    for (const cap of ds.capabilityStates as Array<Record<string, unknown>>) {
      if (!cap || typeof cap !== "object") continue;
      if (cap.namespace === "Alexa.TemperatureSensor" && cap.name === "temperature") temp = cap;
      if (cap.namespace === "Alexa.LightSensor" && cap.name === "illuminance") illuminance = cap;
      if (cap.namespace === "Alexa.PowerController" && cap.name === "powerState") lightPower = cap;
      if (cap.namespace === "Alexa.MotionSensor" && cap.name === "detectionState") motionDetection = cap;
    }
  }

  let temperatureCelsius: number | undefined;
  let temperatureFahrenheit: number | undefined;
  if (temp?.value && typeof temp.value === "object") {
    const tv = temp.value as { value: number; scale: string };
    if (tv.scale === "CELSIUS") { temperatureCelsius = tv.value; temperatureFahrenheit = (tv.value * 9) / 5 + 32; }
    else if (tv.scale === "FAHRENHEIT") { temperatureFahrenheit = tv.value; temperatureCelsius = ((tv.value - 32) * 5) / 9; }
  }

  return {
    temperature: { celsius: temperatureCelsius ?? null, fahrenheit: temperatureFahrenheit ?? null },
    illuminance: (illuminance?.value as number) ?? null,
    motion: { detected: motionDetection ? motionDetection.value === "DETECTED" : false, timestamp: (motionDetection?.timeOfSample as string) ?? null },
    light: { on: lightPower ? lightPower.value === "ON" : false },
    lastUpdate: new Date().toISOString(),
    summary: `Temperature: ${temperatureFahrenheit ? `${Math.round(temperatureFahrenheit)}°F` : "N/A"}, Illuminance: ${(illuminance?.value as number) ?? "N/A"} lux, Motion: ${motionDetection ? (motionDetection.value === "DETECTED" ? "Detected" : "Not detected") : "N/A"}, Light: ${lightPower ? (lightPower.value === "ON" ? "On" : "Off") : "Off"}`,
  };
}

// ── List Lights ──────────────────────────────────────────────────

async function handleListLights(creds: AlexaCreds) {
  const entities = await getSmartHomeEntities(creds) as Array<Record<string, unknown>>;
  const lights = entities.filter((d) => {
    const di = d.displayInfo as { displayCategories?: { primary?: { value?: string } } } | undefined;
    return di?.displayCategories?.primary?.value === "LIGHT";
  });
  return {
    lights: lights.map((d) => ({
      id: extractEntityId(d),
      name: (d.favoriteFriendlyName as string) || "Smart Light",
      capabilities: ["power", "brightness", "color", "colorTemperature"],
    })),
  };
}

// ── Set Light Power ──────────────────────────────────────────────

async function handleSetLightPower(creds: AlexaCreds, args: Record<string, unknown>) {
  const on = args.on as boolean;
  if (typeof on !== "boolean") throw new Error("'on' must be a boolean.");

  const pl = await getPrimaryLight(creds);
  const entityId = extractEntityId(pl);
  const endpointId = buildEndpointId(entityId);
  const operation = on ? "turnOn" : "turnOff";

  // Use device info for GraphQL headers
  let deviceTypeId = "A2TF17PFR55MTB";
  try {
    const endpoints = await getCustomerSmartHomeEndpoints(creds) as Array<Record<string, unknown>>;
    const echo = endpoints.find((ep) => {
      const dc = ep.displayCategories as { primary?: { value?: string } } | undefined;
      return dc?.primary?.value === "ALEXA_VOICE_ENABLED";
    });
    if (echo) {
      const leg = echo.legacyIdentifiers as { dmsIdentifier?: { deviceType?: { value?: { text?: string } } } } | undefined;
      deviceTypeId = leg?.dmsIdentifier?.deviceType?.value?.text || deviceTypeId;
    }
  } catch { /* use default */ }

  const gqlQuery = `
    mutation togglePowerFeatureForEndpoint($endpointId: String, $featureOperationName: FeatureOperationName!) {
      setEndpointFeatures(
        setEndpointFeaturesInput: {featureControlRequests: [{endpointId: $endpointId, featureName: power, featureOperationName: $featureOperationName}]}
      ) {
        featureControlResponses { endpointId __typename }
        errors { endpointId code __typename }
        __typename
      }
    }`;

  const result = await alexaFetch(GRAPHQL_ENDPOINT, creds, {
    method: "POST",
    body: JSON.stringify({ operationName: "togglePowerFeatureForEndpoint", variables: { endpointId, featureOperationName: operation }, query: gqlQuery }),
    extra: {
      "Content-Type": "application/json",
      "X-Amzn-Marketplace-Id": "ATVPDKIKX0DER",
      "X-Amzn-Client": "AlexaApp",
      "X-Amzn-Os-Name": "android",
      "X-Amzn-Devicetype-Id": deviceTypeId,
      "X-Amzn-Build-Version": "953937113",
      "X-Amzn-Os-Version": "12",
      "X-Amzn-Devicetype": "phone",
    },
  });

  return { success: true, on, result };
}

// ── Set Light Brightness ─────────────────────────────────────────

async function handleSetLightBrightness(creds: AlexaCreds, args: Record<string, unknown>) {
  const level = args.level as number;
  if (typeof level !== "number" || level < 0 || level > 100) throw new Error("Brightness must be 0–100.");

  let entityId = args.id as string | undefined;
  if (!entityId) entityId = await getLightApplianceId(creds);

  const brightness = (level / 100).toString();
  const result = await alexaFetch(PHOENIX_ENDPOINT, creds, {
    method: "PUT",
    body: JSON.stringify({ controlRequests: [{ entityId, entityType: "APPLIANCE", parameters: { action: "setBrightness", brightness } }] }),
    extra: { "Content-Type": "application/json; charset=utf-8" },
  });

  return { success: true, brightness: level, result };
}

// ── Set Light Color ──────────────────────────────────────────────

async function handleSetLightColor(creds: AlexaCreds, args: Record<string, unknown>) {
  const mode = args.mode as string;
  const value = args.value as string | number;
  if (!mode || value === undefined) throw new Error("mode and value are required.");

  let entityId = args.id as string | undefined;
  if (!entityId) entityId = await getLightApplianceId(creds);

  let actionParams: Record<string, unknown>;

  if (mode === "name" && typeof value === "string" && SUPPORTED_COLORS.includes(value)) {
    if (WHITE_COLORS.includes(value)) {
      actionParams = { action: "setColorTemperature", colorTemperatureName: value };
    } else {
      actionParams = { action: "setColor", colorName: value };
    }
  } else if (mode === "tempK" && typeof value === "number") {
    if (value < 2200 || value > 6500) throw new Error("Kelvin must be 2200–6500.");
    actionParams = { action: "setColorTemperature", colorTemperatureInKelvin: value };
  } else {
    throw new Error(`Unsupported color. Supported names: ${SUPPORTED_COLORS.join(", ")}. Or use mode 'tempK' with 2200–6500.`);
  }

  const result = await alexaFetch(PHOENIX_ENDPOINT, creds, {
    method: "PUT",
    body: JSON.stringify({ controlRequests: [{ entityId, entityType: "APPLIANCE", parameters: actionParams }] }),
    extra: { "Content-Type": "application/json; charset=utf-8" },
  });

  return { success: true, color: { mode, value }, result };
}

// ── Music Status ─────────────────────────────────────────────────

async function handleGetMusicStatus(creds: AlexaCreds) {
  // Find primary Echo device serial + type
  const endpoints = await getCustomerSmartHomeEndpoints(creds) as Array<Record<string, unknown>>;
  const echo = endpoints.find((ep) => {
    const dc = ep.displayCategories as { primary?: { value?: string } } | undefined;
    return dc?.primary?.value === "ALEXA_VOICE_ENABLED";
  });

  if (!echo) return { isPlaying: false, error: "No Echo device found" };

  const leg = echo.legacyIdentifiers as { dmsIdentifier?: { deviceSerialNumber?: { value?: { text?: string } }; deviceType?: { value?: { text?: string } } } } | undefined;
  const deviceSerial = leg?.dmsIdentifier?.deviceSerialNumber?.value?.text;
  const deviceType = leg?.dmsIdentifier?.deviceType?.value?.text;
  if (!deviceSerial || !deviceType) return { isPlaying: false, error: "Missing device serial/type" };

  const npUrl = `https://alexa.amazon.com/api/np/list-media-sessions?deviceSerialNumber=${deviceSerial}&deviceType=${deviceType}`;
  const data = await alexaFetch(npUrl, creds) as {
    mediaSessionList?: Array<{
      playerState?: string;
      nowPlayingData?: {
        playerState?: string;
        infoText?: { title?: string; subText1?: string; subText2?: string };
        mainArt?: { mediumUrl?: string; largeUrl?: string; smallUrl?: string };
        provider?: { providerName?: string };
        progress?: { mediaLength?: number; mediaProgress?: number };
      };
    }>;
  };

  const session = data.mediaSessionList?.[0];
  if (!session?.nowPlayingData) return { isPlaying: false, trackName: null, artist: null };

  const { infoText, mainArt, provider, progress } = session.nowPlayingData;
  const state = session.playerState ?? session.nowPlayingData.playerState;

  return {
    isPlaying: state === "PLAYING",
    trackName: infoText?.title ?? null,
    artist: infoText?.subText1 ?? null,
    album: infoText?.subText2 ?? null,
    coverUrl: mainArt?.mediumUrl || mainArt?.largeUrl || mainArt?.smallUrl || null,
    provider: provider?.providerName ?? null,
    mediaLength: progress?.mediaLength ?? null,
    mediaProgress: progress?.mediaProgress ?? null,
    timeOfSample: new Date().toISOString(),
  };
}

// ── Device Volumes ───────────────────────────────────────────────

async function handleGetDeviceVolumes(creds: AlexaCreds) {
  return alexaFetch(VOLUMES_ENDPOINT, creds, { extra: { "Cache-Control": "no-cache" } });
}

// ── Set Device Volume ────────────────────────────────────────────

async function handleSetDeviceVolume(creds: AlexaCreds, args: Record<string, unknown>) {
  const volume = args.volume as number;
  if (typeof volume !== "number" || volume < 0 || volume > 100) throw new Error("Volume must be 0–100.");

  const volumesData = await alexaFetch(VOLUMES_ENDPOINT, creds, { extra: { "Cache-Control": "no-cache" } }) as {
    volumes?: Array<{ deviceType: string; dsn: string; speakerVolume: number }>;
  };
  if (!volumesData.volumes?.length) throw new Error("No devices found.");

  let target: { deviceType: string; dsn: string; speakerVolume: number };
  if (args.deviceType && args.dsn) {
    const found = volumesData.volumes.find((v) => v.deviceType === args.deviceType && v.dsn === args.dsn);
    if (!found) throw new Error("Specified device not found.");
    target = found;
  } else {
    target = volumesData.volumes[0];
  }

  const amount = volume - target.speakerVolume;
  const url = `https://alexa.amazon.com/api/devices/${target.deviceType}/${target.dsn}/audio/v2/speakerVolume`;
  const result = await alexaFetch(url, creds, {
    method: "PUT",
    body: JSON.stringify({ dsn: target.dsn, deviceType: target.deviceType, amount, volume: target.speakerVolume, muted: false, synchronous: true }),
    extra: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" },
  });

  return { success: true, volume, result };
}

// ── Adjust Device Volume ─────────────────────────────────────────

async function handleAdjustDeviceVolume(creds: AlexaCreds, args: Record<string, unknown>) {
  const amount = args.amount as number;
  if (typeof amount !== "number" || amount < -100 || amount > 100) throw new Error("Amount must be -100 to +100.");

  const volumesData = await alexaFetch(VOLUMES_ENDPOINT, creds, { extra: { "Cache-Control": "no-cache" } }) as {
    volumes?: Array<{ deviceType: string; dsn: string; speakerVolume: number }>;
  };
  if (!volumesData.volumes?.length) throw new Error("No devices found.");

  let target: { deviceType: string; dsn: string; speakerVolume: number };
  if (args.deviceType && args.dsn) {
    const found = volumesData.volumes.find((v) => v.deviceType === args.deviceType && v.dsn === args.dsn);
    if (!found) throw new Error("Specified device not found.");
    target = found;
  } else {
    target = volumesData.volumes[0];
  }

  const url = `https://alexa.amazon.com/api/devices/${target.deviceType}/${target.dsn}/audio/v2/speakerVolume`;
  const result = await alexaFetch(url, creds, {
    method: "PUT",
    body: JSON.stringify({ dsn: target.dsn, deviceType: target.deviceType, amount, volume: target.speakerVolume, muted: false, synchronous: true }),
    extra: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" },
  });

  return { success: true, adjustedBy: amount, result };
}

// ── All Sensor Data ──────────────────────────────────────────────

async function handleGetAllSensorData(creds: AlexaCreds) {
  const devices = await getAlexaDevices(creds) as Array<Record<string, unknown>>;
  const stateRequests: Array<{ entityId: string; entityType: string }> = [];

  for (const device of devices) {
    if (device.online === false) continue;
    const caps = device.capabilities as string[] | undefined;
    if (!Array.isArray(caps)) continue;
    const hasSensors = caps.some((cap) =>
      typeof cap === "string" && (cap.includes("TemperatureSensor") || cap.includes("LightSensor") || cap.includes("MotionSensor") || cap.includes("AcousticEventSensor")),
    );
    if (hasSensors) {
      const sn = device.serialNumber as string;
      const dt = device.deviceType as string;
      stateRequests.push({ entityId: `AlexaBridge_${sn}@${dt}_${sn}`, entityType: "APPLIANCE" });
    }
  }

  if (stateRequests.length === 0) return { sensors: [], message: "No sensors found" };

  const data = await alexaFetch(PHOENIX_ENDPOINT, creds, {
    method: "POST",
    body: JSON.stringify({ stateRequests }),
    extra: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" },
  }) as { deviceStates?: Array<{ entity: { entityId: string; entityType: string }; capabilityStates: unknown[] }> };

  const sensors: Array<Record<string, unknown>> = [];
  for (const ds of data.deviceStates ?? []) {
    const sensorData: Record<string, unknown> = {
      entityId: ds.entity.entityId,
      entityType: ds.entity.entityType,
      capabilities: {} as Record<string, unknown>,
      lastUpdate: new Date().toISOString(),
    };
    const capMap = sensorData.capabilities as Record<string, unknown>;

    for (const capRaw of ds.capabilityStates) {
      const cap = typeof capRaw === "string" ? (() => { try { return JSON.parse(capRaw); } catch { return null; } })() : capRaw;
      if (!cap || typeof cap !== "object") continue;
      const c = cap as Record<string, unknown>;
      if (c.namespace === "Alexa.TemperatureSensor" && c.name === "temperature") {
        const v = c.value as { value?: number; scale?: string } | undefined;
        capMap.temperature = { value: v?.value, scale: v?.scale, timestamp: c.timeOfSample };
      } else if (c.namespace === "Alexa.LightSensor" && c.name === "illuminance") {
        capMap.illuminance = { value: c.value, timestamp: c.timeOfSample };
      } else if (c.namespace === "Alexa.MotionSensor" && c.name === "detectionState") {
        capMap.motion = { detected: c.value === "DETECTED", timestamp: c.timeOfSample };
      }
    }

    if (Object.keys(capMap).length > 0) sensors.push(sensorData);
  }

  return { sensors, totalCount: sensors.length, lastUpdate: new Date().toISOString() };
}

// ── List Smart Home Devices ──────────────────────────────────────

async function handleListSmarthomeDevices(creds: AlexaCreds) {
  const endpoints = await getCustomerSmartHomeEndpoints(creds) as Array<Record<string, unknown>>;
  return {
    devices: endpoints.map((ep) => ({
      endpointId: ep.endpointId,
      id: ep.id,
      friendlyName: ep.friendlyName,
      categories: ep.displayCategories,
      legacyAppliance: ep.legacyAppliance,
    })),
    totalCount: endpoints.length,
  };
}

// ── DND Status ───────────────────────────────────────────────────

async function handleGetDndStatus(creds: AlexaCreds) {
  const data = await alexaFetch(DND_LIST_ENDPOINT, creds, {
    extra: { "Cache-Control": "no-cache" },
  }) as { doNotDisturbDeviceStatusList: Array<{ deviceSerialNumber: string; deviceType: string; enabled: boolean }> };

  return {
    devices: data.doNotDisturbDeviceStatusList.map((d) => ({
      deviceSerialNumber: d.deviceSerialNumber,
      deviceType: d.deviceType,
      dndEnabled: d.enabled,
    })),
    totalDevices: data.doNotDisturbDeviceStatusList.length,
    enabledCount: data.doNotDisturbDeviceStatusList.filter((d) => d.enabled).length,
    lastUpdate: new Date().toISOString(),
  };
}

// ── Set DND Status ───────────────────────────────────────────────

async function handleSetDndStatus(creds: AlexaCreds, args: Record<string, unknown>) {
  const dsn = args.deviceSerialNumber as string;
  const deviceType = args.deviceType as string;
  const enabled = args.enabled as boolean;
  if (!dsn || !deviceType) throw new Error("deviceSerialNumber and deviceType are required.");
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean.");

  const result = await alexaFetch(DND_STATUS_ENDPOINT, creds, {
    method: "PUT",
    body: JSON.stringify({ deviceSerialNumber: dsn, deviceType, enabled }),
    extra: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" },
  }) as { deviceSerialNumber: string; deviceType: string; enabled: boolean };

  return {
    deviceSerialNumber: result.deviceSerialNumber,
    deviceType: result.deviceType,
    dndEnabled: result.enabled,
    success: true,
    message: `DND ${result.enabled ? "enabled" : "disabled"} successfully`,
    lastUpdate: new Date().toISOString(),
  };
}

// ── BaseTool class wrapper ────────────────────────────────────

export class AlexaTools extends BaseTool {
  readonly name = "alexa";
  readonly toolNamePrefix = "builtin.alexa_";
  readonly registrationOrder = 60;
  readonly tools = BUILTIN_ALEXA_TOOLS;
  readonly toolsRequiringApproval = [...ALEXA_TOOLS_REQUIRING_APPROVAL];

  async execute(toolName: string, args: Record<string, unknown>, _context: ToolExecutionContext): Promise<unknown> {
    return executeAlexaTool(toolName, args);
  }
}

export const alexaTools = new AlexaTools();
registerToolCategory(alexaTools);
