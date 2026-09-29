// Everything in The Tower runs on Dubai time (UTC plus 4, no daylight saving).

export const DUBAI_OFFSET_MINUTES = 240;
const MIN = 60_000;

export interface DubaiParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 Sunday to 6 Saturday
  dayKey: string; // YYYY-MM-DD in Dubai
}

export function dubaiParts(d: Date): DubaiParts {
  const local = new Date(d.getTime() + DUBAI_OFFSET_MINUTES * MIN);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const day = local.getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    year,
    month,
    day,
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    weekday: local.getUTCDay(),
    dayKey: `${year}-${pad(month)}-${pad(day)}`,
  };
}

// The UTC instant when the current Dubai day started.
export function dubaiDayStartUtc(d: Date): Date {
  const p = dubaiParts(d);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - DUBAI_OFFSET_MINUTES * MIN);
}

// Monday 00:00 Dubai of the current week, as a UTC instant.
export function dubaiWeekStartUtc(d: Date): Date {
  const dayStart = dubaiDayStartUtc(d);
  const weekday = dubaiParts(d).weekday; // 0 Sunday
  const daysSinceMonday = (weekday + 6) % 7;
  return new Date(dayStart.getTime() - daysSinceMonday * 24 * 60 * MIN);
}

export function isNightInDubai(d: Date): boolean {
  const h = dubaiParts(d).hour;
  return h >= 19 || h < 6;
}

export function formatDubai(d: Date): string {
  const p = dubaiParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.dayKey} ${pad(p.hour)}:${pad(p.minute)} Dubai`;
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * MIN);
}
