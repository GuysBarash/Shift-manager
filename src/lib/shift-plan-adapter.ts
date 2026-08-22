// Bridges this app's Supabase-shaped data to the pure planner in
// shift-plan.ts (which deliberately knows nothing about Supabase, React, or
// this app's `time_off`/`shifts` schema — see its header comment).
import type { Profile, Shift, TimeOff } from "@/types/database";
import type { Anchor, Person, PresenceWindow } from "./shift-plan";
import { addDays, toISODate } from "./dates";

function atHour(dayIso: string, hour: number): number {
  const [y, m, d] = dayIso.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).getTime();
}

// Matches roster.ts's isOnTimeOffAtHour — the two systems must agree on what
// a time_off row's edges mean, or the off-time grid and the auto-fill would
// disagree about when someone is actually around.
const HOME_TRANSITION_HOUR = 10;

/**
 * Turns time_off rows into the planner's presence windows: away from 10:00
 * on a range's start_date, back from 10:00 on its end_date (a single-day
 * record has no edge to carve out, so it's away all day — same exception as
 * isOnTimeOffAtHour). Windows are clipped to [rangeStart, rangeStart+days),
 * the app's own loaded/visible window — the planner only ever needs to
 * reason about slots inside that range anyway.
 */
export function buildPresenceFromTimeOff(
  profiles: Profile[],
  timeOffIndex: Map<string, TimeOff[]>,
  rangeStart: Date,
  rangeDays: number
): Person[] {
  const rangeStartIso = toISODate(rangeStart);
  const rangeEndIso = toISODate(addDays(rangeStart, rangeDays - 1));
  const rangeStartMs = atHour(rangeStartIso, 0);
  const rangeEndMs = atHour(rangeEndIso, 24);

  const people: Person[] = [];
  for (const p of profiles) {
    const name = (p.full_name ?? "").trim();
    if (!name) continue;

    const away = (timeOffIndex.get(p.id) ?? [])
      .filter((t) => t.end_date >= rangeStartIso && t.start_date <= rangeEndIso)
      .slice()
      .sort((a, b) => a.start_date.localeCompare(b.start_date));

    const windows: PresenceWindow[] = [];
    let cursorMs = rangeStartMs;
    for (const t of away) {
      const singleDay = t.start_date === t.end_date;
      const departMs = singleDay ? atHour(t.start_date, 0) : atHour(t.start_date, HOME_TRANSITION_HOUR);
      const returnMs = singleDay ? atHour(t.end_date, 24) : atHour(t.end_date, HOME_TRANSITION_HOUR);
      if (departMs > cursorMs) {
        windows.push({ from: cursorMs, until: Math.min(departMs, rangeEndMs) });
      }
      cursorMs = Math.max(cursorMs, returnMs);
    }
    if (cursorMs < rangeEndMs) {
      windows.push({ from: cursorMs, until: rangeEndMs });
    }

    if (windows.length > 0) people.push({ name, windows });
  }
  return people;
}

/**
 * Existing shifts, read as the planner's anchors — "ANCHORS ARE READ, NEVER
 * WRITTEN" (shift-plan.ts). Every currently-loaded shift (manually painted
 * or from a previous auto-fill) is passed so the planner treats it as a
 * fixed decision and only fills genuinely open slots.
 */
export function buildAnchorsFromShifts(shifts: Shift[], profileById: Map<string, Profile>): Anchor[] {
  return shifts.map((s) => ({
    dateIso: s.shift_date,
    startTime: s.start_time,
    endTime: s.end_time,
    column: s.position ?? "",
    person: s.assigned_to ? (profileById.get(s.assigned_to)?.full_name?.trim() ?? null) : null,
  }));
}
