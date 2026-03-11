export function computeSchedulerNextRunAt(triggerType: "cron" | "interval" | "once", triggerExpr: string): string | null {
  if (triggerType === "once") return null;

  if (triggerType === "interval") {
    const match = /^every:(\d+):(second|minute|hour|day|week|month)$/.exec(triggerExpr || "");
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
