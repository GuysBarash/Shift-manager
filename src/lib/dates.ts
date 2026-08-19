import { addDays as addDaysFns, format, parse, startOfDay as startOfDayFns } from "date-fns";

// Pure numeric tokens (yyyy/MM/dd) — date-fns doesn't consult locale for
// these, so this stays safe for SSR/client hydration the same way the old
// hand-rolled version was.
export function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function startOfDay(date: Date): Date {
  return startOfDayFns(date);
}

// date-fns parses "yyyy-MM-dd" into local-time date fields, unlike
// `new Date("yyyy-MM-dd")` which parses as UTC midnight and can shift the
// displayed day backward in timezones behind UTC.
export function parseISODate(iso: string): Date {
  return parse(iso, "yyyy-MM-dd", new Date());
}

// date-fns adds calendar days (not a fixed 24h offset), so this is safe
// across DST transitions — a fixed-offset version broke across Israel's
// autumn clock change once the shifts/off-time range grew past a week.
export function addDays(date: Date, days: number): Date {
  return addDaysFns(date, days);
}

// Hardcoded (not Intl-derived) so server and client always render identical
// text — locale-dependent formatting caused a real hydration mismatch before.
const HE_DOW = ["יום א׳", "יום ב׳", "יום ג׳", "יום ד׳", "יום ה׳", "יום ו׳", "שבת"];
const HE_DOW_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

export function formatDow(date: Date): string {
  return HE_DOW[date.getDay()];
}

export function formatDowShort(date: Date): string {
  return HE_DOW_SHORT[date.getDay()];
}

export function formatDDMMYYYY(date: Date): string {
  return format(date, "dd.MM.yyyy");
}

export function formatTime(time: string): string {
  return time.slice(0, 5);
}

export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
