export interface ApprovalPreferenceSignature {
  request_key: string;
  device_key: string;
  reason_key: string;
}

function parseArgs(argsRaw: string): Record<string, unknown> {
  try {
    return JSON.parse(argsRaw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function pickString(args: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeKey(value: string | null | undefined, fallback = "*"): string {
  const cleaned = (value || "").trim().toLowerCase();
  return cleaned || fallback;
}

export function buildApprovalPreferenceSignature(input: {
  toolName: string;
  argsRaw: string;
  reasoning: string | null;
  nlRequest?: string | null;
}): ApprovalPreferenceSignature {
  const args = parseArgs(input.argsRaw);

  const request =
    input.nlRequest?.trim() ||
    pickString(args, ["intent", "action", "service", "command", "mode"]) ||
    input.toolName;

  const device = pickString(args, ["name", "deviceName", "entityName", "entity_id", "id", "target", "device", "light"]);

  const reason =
    input.reasoning?.trim() ||
    pickString(args, ["reason", "because", "why"]) ||
    null;

  return {
    request_key: normalizeKey(request),
    device_key: normalizeKey(device),
    reason_key: normalizeKey(reason),
  };
}
