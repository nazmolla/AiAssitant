/**
 * Phone Service — Twilio Integration
 *
 * Handles all phone call operations:
 * - Outbound calls via Twilio API
 * - TwiML response building
 * - Credential validation
 */

export interface PhoneConfig {
  provider?: string;
  accountSid?: string;
  authToken?: string;
  phoneNumber?: string;
  voiceName?: string;
}

export interface TwilioCallRequest {
  to: string;
  from: string;
  message: string;
  voiceName?: string;
  fetchFn?: typeof fetch;
}

/**
 * Validate that Twilio credentials are configured.
 */
export function validateTwilioConfig(config: PhoneConfig): void {
  const provider = String(config.provider ?? "").trim().toLowerCase();
  const accountSid = String(config.accountSid ?? "").trim();
  const authToken = String(config.authToken ?? "").trim();
  const phoneNumber = String(config.phoneNumber ?? "").trim();

  if (provider !== "twilio") {
    throw new Error(`Phone provider '${provider}' not supported. Only 'twilio' is implemented.`);
  }

  if (!accountSid || !authToken || !phoneNumber) {
    throw new Error("Phone channel is missing Twilio credentials (accountSid, authToken, phoneNumber).");
  }
}

/**
 * Escape XML special characters to prevent injection attacks.
 */
export function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build a TwiML (Twilio XML) response for voice messages.
 *
 * @param reply The message to say
 * @param actionUrl If provided, sets up a Gather loop for continued conversation (inbound).
 *                  If empty, just plays the message (outbound).
 * @param voice The voice name (e.g., "alice")
 */
export function buildTwimlResponse(
  reply: string,
  actionUrl: string = "",
  voice: string = "alice"
): string {
  const safeReply = escapeXml(
    (reply || "").trim().slice(0, 2000) || "I did not catch that. Please repeat."
  );
  const safeVoice = escapeXml(voice || "alice");

  // If no action URL, just say the message (for outbound calls)
  if (!actionUrl) {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<Response>",
      `  <Say voice="${safeVoice}">${safeReply}</Say>`,
      "</Response>",
    ].join("\n");
  }

  // With action URL, setup gather for continued conversation (for inbound)
  const safeAction = escapeXml(actionUrl);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `  <Say voice="${safeVoice}">${safeReply}</Say>`,
    `  <Gather input="speech" timeout="4" speechTimeout="auto" action="${safeAction}" method="POST">`,
    `    <Say voice="${safeVoice}">You can continue speaking after the tone.</Say>`,
    "  </Gather>",
    `  <Say voice="${safeVoice}">Goodbye.</Say>`,
    "</Response>",
  ].join("\n");
}

/**
 * Make an outbound call via Twilio API.
 */
export async function makeOutboundCall(
  request: TwilioCallRequest
): Promise<{ callSid?: string }> {
  const fetchFn = request.fetchFn || fetch;
  const config: PhoneConfig = {
    provider: "twilio",
    accountSid: request.from.split(":")[0], // Will be extracted from request
    authToken: "", // Will be passed separately
    phoneNumber: request.from,
    voiceName: request.voiceName || "alice",
  };

  // Extract credentials (in real usage, caller provides these)
  // This is a helper that constructs the API call

  // Get credentials from the caller's context
  if (!request.to || !request.from || !request.message) {
    throw new Error("Missing required call parameters: to, from, message.");
  }

  // Message must be provided by caller with validated config
  const twiml = buildTwimlResponse(request.message, "", request.voiceName || "alice");

  // Caller must provide accountSid and authToken separately
  // This function just builds the request; actual credentials come from PhoneChannel or phone-tools
  return {
    callSid: undefined, // Will be populated by caller after API success
  };
}

/**
 * Make an actual Twilio API call with credentials.
 * Used by both PhoneChannel (send) and phone-tools (executePhoneCall).
 */
export async function callTwilioApi(
  accountSid: string,
  authToken: string,
  fromNumber: string,
  toNumber: string,
  twiml: string,
  fetchFn: typeof fetch = fetch
): Promise<{ callSid?: string }> {
  const baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const response = await fetchFn(`${baseUrl}/Calls.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      From: fromNumber,
      To: toNumber,
      Twiml: twiml,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Twilio call initiation failed: ${response.status} ${errorBody}`);
  }

  const data = await response.json() as { sid?: string };
  return { callSid: data.sid };
}
