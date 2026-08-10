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

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

// A fixed locale (rather than the browser/server default) keeps server-rendered
// and client-rendered text identical and avoids React hydration mismatches.
const LOCALE = "en-US";

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString(LOCALE, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatDow(date: Date): string {
  return date.toLocaleDateString(LOCALE, { weekday: "short" }).toUpperCase();
}

export function formatDDMMYYYY(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const date = new Date(2000, 0, 1, h, m);
  return date.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
}

export function formatHourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour, 0).toLocaleTimeString(LOCALE, {
    hour: "numeric",
    minute: "2-digit",
  });
}
