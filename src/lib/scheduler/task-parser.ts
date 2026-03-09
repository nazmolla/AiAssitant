import type { ScheduledTaskFrequency } from "@/lib/db";

interface ParsedSchedule {
  frequency: ScheduledTaskFrequency;
  intervalValue: number;
  nextRunAt: Date;
}

export interface ParsedScheduledTaskInput {
  taskName: string;
  schedule: ParsedSchedule;
}

const SCHEDULE_HINT_RE = /\b(remind|schedule|recurr|every|daily|weekly|monthly|hourly|tomorrow|next\s+(day|week|month)|in\s+\d+\s+(minute|hour|day|week|month)s?)\b/i;

function normalizeTaskName(raw: string): string {
  const cleaned = raw
    .replace(/^\s*(please\s+)?(remind me|schedule|add|create)\s+/i, "")
    .replace(/^\s*(scheduled\s*task\s*:\s*)+/i, "")
    .replace(/^\s*to\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Scheduled task";
}

function parseScheduleFromText(text: string, now: Date): ParsedSchedule {
  const lower = text.toLowerCase();

  const inMatch = lower.match(/\bin\s+(\d+)\s+(minute|hour|day|week|month)s?\b/);
  if (inMatch) {
    const amount = Number(inMatch[1]);
    const unit = inMatch[2];
    const d = new Date(now);
    if (unit === "minute") d.setMinutes(d.getMinutes() + amount);
    if (unit === "hour") d.setHours(d.getHours() + amount);
    if (unit === "day") d.setDate(d.getDate() + amount);
    if (unit === "week") d.setDate(d.getDate() + amount * 7);
    if (unit === "month") d.setMonth(d.getMonth() + amount);
    return { frequency: "once", intervalValue: 1, nextRunAt: d };
  }

  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { frequency: "once", intervalValue: 1, nextRunAt: d };
  }

  if (/\bnext\s+week\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return { frequency: "once", intervalValue: 1, nextRunAt: d };
  }

  if (/\bnext\s+month\b/.test(lower)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    return { frequency: "once", intervalValue: 1, nextRunAt: d };
  }

  const everyMatch = lower.match(/\bevery\s+(\d+)\s+(hour|day|week|month)s?\b/);
  if (everyMatch) {
    const intervalValue = Math.max(1, Number(everyMatch[1]));
    const unit = everyMatch[2];
    const frequency: ScheduledTaskFrequency =
      unit === "hour" ? "hourly" : unit === "day" ? "daily" : unit === "week" ? "weekly" : "monthly";
    return { frequency, intervalValue, nextRunAt: now };
  }

  if (/\b(every\s+hour|hourly)\b/.test(lower)) return { frequency: "hourly", intervalValue: 1, nextRunAt: now };
  if (/\b(every\s+day|daily)\b/.test(lower)) return { frequency: "daily", intervalValue: 1, nextRunAt: now };
  if (/\b(every\s+week|weekly)\b/.test(lower)) return { frequency: "weekly", intervalValue: 1, nextRunAt: now };
  if (/\b(every\s+month|monthly)\b/.test(lower)) return { frequency: "monthly", intervalValue: 1, nextRunAt: now };

  return { frequency: "once", intervalValue: 1, nextRunAt: now };
}

function extractTaskName(line: string): string {
  const toMatch = line.match(/\bto\s+(.+)$/i);
  if (toMatch?.[1]) return normalizeTaskName(toMatch[1]);
  return normalizeTaskName(line);
}

export function parseScheduledTasksFromUserMessage(message: string, now = new Date()): ParsedScheduledTaskInput[] {
  if (!SCHEDULE_HINT_RE.test(message)) return [];

  const segments = message
    .split(/\n|;|\band also\b|\balso\b/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const items = segments.length > 0 ? segments : [message];
  const parsed: ParsedScheduledTaskInput[] = [];

  for (const item of items) {
    if (!SCHEDULE_HINT_RE.test(item)) continue;
    parsed.push({
      taskName: extractTaskName(item),
      schedule: parseScheduleFromText(item, now),
    });
  }

  return parsed;
}
