export interface EveningSchedule {
  hour: number;
  minute: number;
}

export function getLocalDateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shouldRunEveningMaintenance(
  now: Date,
  lastRunDate: string | null | undefined,
  schedule: EveningSchedule
): boolean {
  const today = getLocalDateKey(now);
  if (lastRunDate === today) return false;

  const afterHour = now.getHours() > schedule.hour;
  const inHourAfterMinute = now.getHours() === schedule.hour && now.getMinutes() >= schedule.minute;
  return afterHour || inHourAfterMinute;
}

export function createOverlapGuard() {
  let running = false;

  return async function runGuarded(task: () => Promise<void>): Promise<boolean> {
    if (running) return false;
    running = true;
    try {
      await task();
      return true;
    } finally {
      running = false;
    }
  };
}
