import "server-only";

/** All business dates/cutoffs are evaluated in this zone, never the server's. */
export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? "Asia/Colombo";

/**
 * Current instant. When DEMO_CLOCK is set (ISO timestamp, demo only) time is
 * frozen there so judges can see cutoff behaviour deterministically.
 */
export function now(): Date {
  const demo = process.env.DEMO_CLOCK;
  if (demo) {
    const d = new Date(demo);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function isDemoClock() {
  return Boolean(process.env.DEMO_CLOCK);
}

/** Calendar date (YYYY-MM-DD) of an instant in APP_TIMEZONE. */
export function localDate(at: Date = now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Local wall-clock minutes since midnight in APP_TIMEZONE. */
export function localMinutes(at: Date = now()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  return h * 60 + m;
}

/** "HH:MM" -> minutes since midnight. */
export function parseHhMm(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Invalid HH:MM time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatHhMm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * UTC instant for a local date + HH:MM in APP_TIMEZONE. Handles any fixed or
 * DST offset by measuring the zone offset at that instant.
 */
export function zonedInstant(date: string, hhmm: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const mins = parseHhMm(hhmm);
  const guess = Date.UTC(y, mo - 1, d, Math.floor(mins / 60), mins % 60);
  const offset = zoneOffsetMinutes(new Date(guess));
  return new Date(guess - offset * 60_000);
}

function zoneOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Add whole days to a YYYY-MM-DD string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** True when `at` is strictly before the local cutoff time on `date`. */
export function isBeforeCutoff(date: string, cutoffHhMm: string, at: Date = now()): boolean {
  return at.getTime() < zonedInstant(date, cutoffHhMm).getTime();
}
