import type { NotificationLevel } from "@/lib/channels/notify";

export interface InboundUnknownEmailSummary {
  summary: string;
  level: NotificationLevel;
  category: "security" | "system" | "general";
}

const SECURITY_KEYWORDS = [
  "2fa",
  "two-factor",
  "two factor",
  "2-step",
  "verification",
  "security alert",
  "new sign-in",
  "new sign in",
  "password",
  "account recovery",
  "suspicious",
  "locked",
  "signin",
  "sign in",
];

const SYSTEM_SENDER_HINTS = ["no-reply", "noreply", "notification", "security", "alert"];

function compactText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectSecuritySignal(text: string): boolean {
  const lower = text.toLowerCase();
  return SECURITY_KEYWORDS.some((token) => lower.includes(token));
}

function detectSystemSender(sender: string): boolean {
  const lower = sender.toLowerCase();
  return SYSTEM_SENDER_HINTS.some((token) => lower.includes(token));
}

function snippet(value: string, max = 280): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export function summarizeInboundUnknownEmail(
  fromAddress: string,
  subject: string,
  rawBody: string
): InboundUnknownEmailSummary {
  const normalizedSubject = compactText(subject || "(no subject)");
  const normalizedBody = compactText(rawBody || "");
  const joined = `${normalizedSubject}\n${normalizedBody}`;

  const securitySignal = detectSecuritySignal(joined);
  const systemSender = detectSystemSender(fromAddress);

  // System senders (no-reply@, noreply@, etc.) send automated notifications,
  // not real threats — keep them low-priority even with security keywords.
  const category: InboundUnknownEmailSummary["category"] = systemSender
    ? "system"
    : securitySignal
      ? "security"
      : "general";
  const level: NotificationLevel = systemSender ? "low" : securitySignal ? "high" : "medium";

  const headline =
    category === "security"
      ? "Security/account alert detected from unregistered sender."
      : category === "system"
        ? "Automated system email from unregistered sender."
        : "General email from unregistered sender.";

  const summary = [
    headline,
    `From: ${fromAddress}`,
    `Subject: ${normalizedSubject}`,
    `Excerpt: ${snippet(normalizedBody || "(empty body)")}`,
  ].join("\n");

  return {
    summary,
    level,
    category,
  };
}