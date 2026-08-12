const DAY_MS = 24 * 60 * 60 * 1000;

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// `new Date("YYYY-MM-DD")` parses as UTC midnight, which can shift the
// displayed day backward in local timezones behind UTC — parse the parts
// directly into a local-time Date instead.
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
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
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function formatTime(time: string): string {
  return time.slice(0, 5);
}

export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
