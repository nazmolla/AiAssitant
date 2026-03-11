export function normalizeSchedulerIntervalExpr(triggerExpr: string): string | null {
  const input = (triggerExpr || "").trim().toLowerCase();
  if (!input) return null;

  const strict = /^every:(\d+):(second|minute|hour|day|week|month)$/i.exec(input);
  if (strict) return `every:${Math.max(1, Number(strict[1]))}:${strict[2]}`;

  const missingColon = /^every:(\d+)(second|minute|hour|day|week|month)$/i.exec(input);
  if (missingColon) return `every:${Math.max(1, Number(missingColon[1]))}:${missingColon[2]}`;

  const spaced = /^every\s+(\d+)\s*(second|minute|hour|day|week|month)s?$/i.exec(input);
  if (spaced) return `every:${Math.max(1, Number(spaced[1]))}:${spaced[2]}`;

  const short = /^(\d+)\s*(second|minute|hour|day|week|month)s?$/i.exec(input);
  if (short) return `every:${Math.max(1, Number(short[1]))}:${short[2]}`;

  return null;
}

export function isValidSchedulerIntervalExpr(triggerExpr: string): boolean {
  return normalizeSchedulerIntervalExpr(triggerExpr) !== null;
}

export function computeSchedulerNextRunAt(triggerType: "cron" | "interval" | "once", triggerExpr: string): string | null {
  if (triggerType === "once") return null;

  if (triggerType === "interval") {
    const normalized = normalizeSchedulerIntervalExpr(triggerExpr || "");
    const match = /^every:(\d+):(second|minute|hour|day|week|month)$/.exec(normalized || "");
    if (!match) return null;

    const interval = Math.max(1, Number(match[1] || 1));
    const unit = match[2];
    const now = new Date();

    if (unit === "second") now.setSeconds(now.getSeconds() + interval);
    if (unit === "minute") now.setMinutes(now.getMinutes() + interval);
    if (unit === "hour") now.setHours(now.getHours() + interval);
    if (unit === "day") now.setDate(now.getDate() + interval);
    if (unit === "week") now.setDate(now.getDate() + interval * 7);
    if (unit === "month") now.setMonth(now.getMonth() + interval);
    return now.toISOString();
  }

  return null;
}
