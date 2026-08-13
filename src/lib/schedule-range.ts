import { startOfDay } from "./dates";

// Shared by the shifts and off-time pages so their timelines always end on
// the same date — a page-local constant here would silently drift from the
// other page's.
//
// The current reserve-duty term (per the imported roster) runs through
// 2026-12-03. Deriving the day-count from that fixed end date — rather than
// hard-coding a day-count like 120 — keeps the range landing exactly on
// 03.12 regardless of what day "today" is when the page loads.
const SCHEDULE_END_DATE = new Date(2026, 11, 3);

export function scheduleRangeDays(from: Date): number {
  const start = startOfDay(from);
  const diffMs = SCHEDULE_END_DATE.getTime() - start.getTime();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(days, 1);
}
