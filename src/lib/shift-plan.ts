import * as XLSX from "xlsx";

/**
 * Turns the roster workbook (who is at base each day) into shift assignments.
 *
 * Pure: no Supabase, no React, no `@/` aliases — so `scripts/simulate-shifts.ts`
 * can run this exact file under plain Node, and the app imports the same code.
 * The database write lives in `shift-apply.ts`.
 *
 * # Notes
 *   PRESENCE IS NOT THE V/X GRID. You are expected at base by 10:00 on your
 *   first day, and you leave at 10:00 on the day AFTER your last one. So a run
 *   of V days becomes [firstDay 10:00, lastDay+1 10:00) and a person is still
 *   at base until 10:00 on the first X day - long enough to finish a 21:00
 *   shift, or take an 03:00 one. Reading the cells literally would ban both.
 *
 *   ANCHORS ARE READ, NEVER WRITTEN. Anything already in `shifts` is somebody's
 *   decision. An anchor fills its slot, consumes that person's time, and shifts
 *   the rest arithmetic around it. If one breaks a rule it is reported, not
 *   corrected.
 *
 *   `fromDate` REPLANS FORWARD ONLY. A shift belongs to "before" if it STARTS
 *   before the boundary, so a 21:00->03:00 shift is never cut in half. History
 *   is still read, because the last shift before the boundary sets the rest
 *   baseline for the first one after it.
 *
 *   SPEED. Greedy over slots in time order, then a bounded repair pass. For a
 *   3-month range that is ~650 slots x 13 people, a few milliseconds - fast
 *   enough to re-plan on every keystroke if that is ever wanted.
 */

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type PresenceWindow = { from: number; until: number };   // epoch ms

export type Person = { name: string; windows: PresenceWindow[] };

export type Slot = {
  startMs: number;
  endMs: number;
  column: string;
  dateIso: string;      // the day the slot STARTS on
  startTime: string;    // "HH:MM:SS"
  /** Actual length. Normally shiftHours; 1 less or 1 more while realigning. */
  lengthH: number;
  /** Hours off the nominal length: -1 shortened, 0 normal, +1 lengthened. */
  adjusted: number;
};

export type Assignment = {
  slot: Slot;
  person: string | null;
  anchored: boolean;
};

export type ShiftRow = {
  shift_date: string;
  start_time: string;
  end_time: string;
  position: string;
  person: string;
  source: "auto";
};

/** An existing `shifts` row, resolved to a person name. */
export type Anchor = {
  dateIso: string;
  startTime: string;
  endTime: string;
  column: string;
  person: string | null;
};

export type PlanOptions = {
  shiftHours?: number;      // default 6
  staggerHours?: number;    // default shiftHours/2 — two columns, one changeover per half shift
  columns?: string[];       // default the app's two slots
  arriveHour?: number;      // default 10 — expected at base by
  departHour?: number;      // default 10 — leave the morning after the last day
  fromDate?: string | null; // replan boundary; slots starting earlier are left alone
  toDate?: string | null;
  /** Only these people take shifts (the app passes sambatz profiles). */
  include?: string[];
  /**
   * Where each column's chain resumes, as epoch ms. Used when replanning from
   * a date: the shift already in the book may end off-grid, and the new plan
   * has to pick up from there and walk back onto the grid.
   */
  resumeAt?: Record<string, number>;
  /**
   * Rest threshold in hours. A gap of at least this counts as REST; anything
   * less is a "no-rest" event and is minimised. Default 1.5 shifts - 9h on
   * a 6h shift, 12h on an 8h shift.
   */
  restThresholdH?: number;
  /**
   * HARD floor on the gap between two shifts, in hours. Default shiftHours:
   * half a shift counts the same as back to back, so a full shift off is the
   * shortest legal gap. A slot goes unfilled rather than break it.
   */
  minRestH?: number;
};

export type RestGap = {
  person: string;
  windowFrom: number;
  windowUntil: number;
  arrivalRestH: number | null;    // first shift start - arrival
  departureRestH: number | null;  // departure - last shift end
  /**
   * Rest measured as a sliding window AFTER each shift: from the end of one
   * shift to the start of the next, within the same stay. One entry per gap,
   * so a stay with 4 shifts has 3 of them.
   */
  interRestH: number[];
};

export type PlanResult = {
  assignments: Assignment[];
  rows: ShiftRow[];
  unfilled: Slot[];
  conflicts: string[];
  gaps: RestGap[];
  load: { person: string; shifts: number; hours: number }[];
  worstRestH: number | null;
  /** Every gap below the rest threshold: shift, off, shift with no real break. */
  noRest: NoRestEvent[];
  /** Shifts run short or long to walk the column back onto the grid. */
  adjusted: AdjustedShift[];
  elapsedMs: number;
};

/**
 * A gap that did not reach the rest threshold - "shift on, shift off, shift
 * on". Not forbidden, but minimised: `gotH` is the actual break, `wantedH` the
 * threshold it fell short of.
 */
/** A shift given an hour less or more so its column returns to the grid. */
export type AdjustedShift = {
  person: string;
  dateIso: string;
  startTime: string;
  lengthH: number;
};

export type NoRestEvent = {
  person: string;
  dateIso: string;
  startTime: string;
  gotH: number;
  wantedH: number;
};

export const DEFAULT_COLUMNS = ["משמרת א׳", "משמרת ב׳"];
const HOUR = 3600_000;

// Scoring weights, in the priority order the rules were given:
//   A  avoid no-rest        - dominates everything
//   B  rest before leaving  - as much as possible
//   C  rest after arriving  - as much as possible
// Load balance sits underneath as a tiebreak, so the rotation stays even
// without ever outvoting a no-rest event.
const W_NOREST = 400;      // A: penalty per no-rest, scaled by how short it was
const W_RESTED = 12;       // A: prefer the most-rested candidate (saturates)
const W_TRAVEL = 10;       // B and C
const W_LOAD = 15;
const W_SPREAD = 6;        // spread unavoidable no-rest across people
const W_REUSE = 60;        // a 5h/7h shift should not land on the same person twice

// --------------------------------------------------------------------------
// Small date helpers
//
// The planner reasons about INSTANTS (a 10:00 boundary, a 6-hour span), while
// src/lib/dates.ts is calendar and Hebrew-formatting helpers for the UI. Almost
// nothing overlaps, and keeping this file import-free is what lets the
// simulator run it directly.
// --------------------------------------------------------------------------

function isoOf(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function atHour(dayIso: string, hour: number): number {
  const [y, m, d] = dayIso.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).getTime();
}

function hhmmss(ms: number): string {
  const d = new Date(ms);
  return `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}:00`;
}

function addDaysIso(dayIso: string, n: number): string {
  const [y, m, d] = dayIso.split("-").map(Number);
  return isoOf(new Date(y, m - 1, d + n));
}

// --------------------------------------------------------------------------
// 1. Reading the roster
// --------------------------------------------------------------------------

const SHEET_NAME = "מכלול כללי חדש";
const DATE_ROW = 2;
const DATE_ROW_LABEL = "תאריך";
const FIRST_DATA_ROW = 6;
// Same convention as offtime-import.ts: only an explicit "V" is at-base.
// Blank, "X" and a greyed-out cell all mean not at base, which is exactly
// what presence needs - so no cell-style reading is required here.
const BASE_MARK = "V";

function cell(ws: XLSX.WorkSheet, row1: number, col1: number): unknown {
  return ws[XLSX.utils.encode_cell({ r: row1 - 1, c: col1 - 1 })]?.v;
}

/**
 * People and their presence windows, from the roster worksheet.
 *
 * Reads the whole grid, not just the planning range, so a stretch that began
 * before `fromDate` is seen as one continuous stay rather than an arrival on
 * the boundary.
 */
export function extractPresence(ws: XLSX.WorkSheet, opts: PlanOptions = {}): Person[] {
  const arriveHour = opts.arriveHour ?? 10;
  const departHour = opts.departHour ?? 10;
  // The sheet holds officers too; only the shift pool is wanted here.
  const only = opts.include ? new Set(opts.include) : null;

  const ref = ws["!ref"];
  if (!ref) throw new Error("הגיליון ריק.");
  const range = XLSX.utils.decode_range(ref);
  const maxRow = range.e.r + 1;
  const maxCol = range.e.c + 1;

  let nameCol: number | null = null;
  for (let c = 1; c <= maxCol; c++) {
    if (cell(ws, DATE_ROW, c) === DATE_ROW_LABEL) {
      nameCol = c;
      break;
    }
  }
  if (nameCol === null) {
    throw new Error(`לא נמצאה התווית "${DATE_ROW_LABEL}" בשורה ${DATE_ROW}.`);
  }

  const dateCols: { col: number; iso: string }[] = [];
  for (let c = nameCol + 1; c <= maxCol; c++) {
    const v = cell(ws, DATE_ROW, c);
    if (v instanceof Date) dateCols.push({ col: c, iso: isoOf(v) });
  }

  const people: Person[] = [];
  for (let r = FIRST_DATA_ROW; r <= maxRow; r++) {
    const name = cell(ws, r, nameCol);
    if (typeof name !== "string" || !name.trim()) continue;
    if (only && !only.has(name.trim())) continue;

    const windows: PresenceWindow[] = [];
    let runStart: string | null = null;
    let runEnd: string | null = null;
    for (const { col, iso } of dateCols) {
      const atBase = cell(ws, r, col) === BASE_MARK;
      if (atBase) {
        if (runStart === null) runStart = iso;
        runEnd = iso;
      } else if (runStart !== null && runEnd !== null) {
        windows.push({
          from: atHour(runStart, arriveHour),
          until: atHour(addDaysIso(runEnd, 1), departHour),
        });
        runStart = runEnd = null;
      }
    }
    if (runStart !== null && runEnd !== null) {
      windows.push({
        from: atHour(runStart, arriveHour),
        until: atHour(addDaysIso(runEnd, 1), departHour),
      });
    }

    if (windows.length > 0) people.push({ name: name.trim(), windows });
  }
  return people;
}

export function readRosterWorkbook(buffer: ArrayBuffer | Buffer): XLSX.WorkSheet {
  const wb = XLSX.read(buffer, { cellDates: true });
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`לא נמצא גיליון בשם "${SHEET_NAME}".`);
  return ws;
}

/** First and last dated column in the sheet. */
export function rosterRange(ws: XLSX.WorkSheet): { start: string; end: string } {
  const ref = ws["!ref"];
  if (!ref) throw new Error("הגיליון ריק.");
  const range = XLSX.utils.decode_range(ref);
  let nameCol = 1;
  for (let c = 1; c <= range.e.c + 1; c++) {
    if (cell(ws, DATE_ROW, c) === DATE_ROW_LABEL) { nameCol = c; break; }
  }
  const dates: string[] = [];
  for (let c = nameCol + 1; c <= range.e.c + 1; c++) {
    const v = cell(ws, DATE_ROW, c);
    if (v instanceof Date) dates.push(isoOf(v));
  }
  return { start: dates[0], end: dates[dates.length - 1] };
}

// --------------------------------------------------------------------------
// 2. The slots
// --------------------------------------------------------------------------

/**
 * Build the slot chain for each column.
 *
 * The start times are a fixed grid: with a 6h shift, 00 03 06 09 12 15 18 21;
 * with an 8h shift, 00 04 08 12 16 20. Column A sits on the even multiples of
 * the shift, column B is offset by half a shift, which is what puts two people
 * on duty with a half-shift overlap.
 *
 * REALIGNMENT. A column is a contiguous chain, so anything that ends off-grid
 * - an anchored shift at an odd hour, or a replan boundary - would otherwise
 * push every later slot off with it. Instead the next slot gives back an hour
 * (5h instead of 6h) or takes one (7h), walking the chain back onto the grid
 * one hour at a time. Shortening is preferred, so a boundary exactly half a
 * shift out is treated as late and caught up rather than stretched.
 */
export function buildSlots(startIso: string, endIso: string, opts: PlanOptions = {}): Slot[] {
  const shiftHours = opts.shiftHours ?? 6;
  const staggerHours = opts.staggerHours ?? shiftHours / 2;
  const lanes = Math.max(1, Math.round(shiftHours / staggerHours));
  const columns = opts.columns ?? DEFAULT_COLUMNS;
  if (columns.length < lanes) {
    throw new Error(
      `משמרת של ${shiftHours} שעות כל ${staggerHours} שעות דורשת ${lanes} עמודות, יש ${columns.length}.`
    );
  }

  // Local wall-clock hour. Never derive this from a millisecond offset: Israel
  // puts the clocks back on the last Sunday of October, so that day has 25
  // hours and a fixed offset lands an hour early for the rest of it.
  const hourOf = (ms: number): number => {
    const d = new Date(ms);
    return d.getHours() + d.getMinutes() / 60;
  };

  const limit = atHour(addDaysIso(endIso, 1), 0);
  const slots: Slot[] = [];

  for (let lane = 0; lane < lanes; lane++) {
    const column = columns[lane];
    const offset = lane * staggerHours;
    let cursor = opts.resumeAt?.[column] ?? atHour(startIso, offset);

    while (cursor < limit) {
      // How far past a grid point we are. Ties go to "late", so the chain is
      // pulled back with a short shift rather than pushed out with a long one.
      const rel = (((hourOf(cursor) - offset) % shiftHours) + shiftHours) % shiftHours;
      const drift = rel <= shiftHours / 2 ? rel : rel - shiftHours;

      let lengthH = shiftHours;
      if (drift > 0) lengthH = shiftHours - Math.min(1, drift);
      else if (drift < 0) lengthH = shiftHours + Math.min(1, -drift);

      const dateIso = isoOf(new Date(cursor));
      const endMs = atHour(dateIso, hourOf(cursor) + lengthH);
      slots.push({
        startMs: cursor,
        endMs,
        column,
        dateIso,
        startTime: hhmmss(cursor),
        lengthH,
        adjusted: lengthH - shiftHours,
      });
      cursor = endMs;
    }
  }
  return slots.sort((a, b) => a.startMs - b.startMs || a.column.localeCompare(b.column));
}

// --------------------------------------------------------------------------
// 3. Planning
// --------------------------------------------------------------------------

type Busy = { start: number; end: number };

function windowFor(person: Person, slot: Slot): PresenceWindow | null {
  for (const w of person.windows) {
    if (slot.startMs >= w.from && slot.endMs <= w.until) return w;
  }
  return null;
}

/** How many of the pool are at base for this slot. */
function presentAt(people: Person[], slot: Slot): number {
  let n = 0;
  for (const p of people) if (windowFor(p, slot)) n++;
  return n;
}

function overlaps(busy: Busy[], slot: Slot): boolean {
  for (const b of busy) {
    if (slot.startMs < b.end && b.start < slot.endMs) return true;
  }
  return false;
}

/**
 * Assign a person to every slot.
 *
 * The objective is rest around travel: as long as possible between arriving at
 * 10:00 and your first shift, and between your last shift and leaving at 10:00
 * the next morning. So the score rewards people who are mid-stay and penalises
 * grabbing somebody who has only just walked in or is about to leave. Load is a
 * lighter term - it keeps the split even without overriding the rest goal.
 */
export function planShifts(
  people: Person[],
  slots: Slot[],
  anchors: Anchor[] = [],
  opts: PlanOptions = {}
): PlanResult {
  const t0 = Date.now();
  const shiftHours = opts.shiftHours ?? 6;
  const staggerHours = opts.staggerHours ?? shiftHours / 2;
  // REST is one and a half shifts off. One shift off is "no-rest" - allowed
  // but minimised. Half a shift counts the same as back to back and is
  // forbidden, so the hard floor is a full shift.
  const restThresholdH = opts.restThresholdH ?? 1.5 * shiftHours;
  const minRestH = opts.minRestH ?? shiftHours;
  const lanes = Math.max(1, Math.round(shiftHours / staggerHours));
  const boundary = opts.fromDate ? atHour(opts.fromDate, 0) : -Infinity;

  const byName = new Map(people.map((p) => [p.name, p] as const));
  const busy = new Map<string, Busy[]>(people.map((p) => [p.name, []] as const));
  const hours = new Map<string, number>(people.map((p) => [p.name, 0] as const));
  const conflicts: string[] = [];

  // Balance HOURS PER DAY AT BASE, not total hours. Somebody who is only here
  // for 30 days would otherwise be handed the same total as someone here for
  // 46 and end up working half as long again each day.
  const daysAtBase = new Map<string, number>(
    people.map((p) => [
      p.name,
      Math.max(1, p.windows.reduce((sum, w) => sum + (w.until - w.from) / 86_400_000, 0)),
    ] as const)
  );

  // -- anchors first: they own their slot and their person's time ----------
  const anchorAt = new Map<string, Anchor>();
  for (const a of anchors) {
    anchorAt.set(`${a.dateIso}|${a.startTime}|${a.column}`, a);
    if (!a.person) continue;
    const p = byName.get(a.person);
    const start = atHour(a.dateIso, 0) + hmsToMs(a.startTime);
    const end = start + shiftHours * HOUR;
    if (!p) {
      conflicts.push(`${a.person} משובץ ב-${a.dateIso} אך אינו ברשימת הסבב`);
      continue;
    }
    if (!p.windows.some((w) => start >= w.from && end <= w.until)) {
      conflicts.push(`${a.person}: משמרת מעוגנת ב-${a.dateIso} ${a.startTime} כשאינו בבסיס`);
    }
    const list = busy.get(a.person)!;
    if (list.some((b) => start < b.end && b.start < end)) {
      conflicts.push(`${a.person}: שתי משמרות מעוגנות חופפות ב-${a.dateIso}`);
    }
    list.push({ start, end });
    hours.set(a.person, (hours.get(a.person) ?? 0) + shiftHours);
  }

  // -- the rest model -------------------------------------------------------
  //
  // A gap of restThresholdH or more is REST. Less than that is a "no-rest"
  // event - shift on, shift off, shift on - allowed but minimised. Genuinely
  // back to back is forbidden outright by minRestH.
  //
  // With `lanes` on duty and N people present, each person starts a shift
  // every staggerHours * N hours, so the natural gap is
  //     staggerHours * N - shiftHours
  // = 12h at N=6 and 18h at N=8, both at or above the threshold. So a perfectly
  // even rotation has NO no-rest events at all, and every one that appears
  // comes from an arrival, a departure or an anchor - not from the rotation.
  //
  // NOTE: an earlier version targeted "6 work, 6 rest, 6 work, long rest" and
  // built the plan out of paired blocks. That 6h inner gap is a no-rest event
  // under this definition, so the pairing is gone: the rotation now falls out
  // of always picking the most-rested candidate.

  const assignments: Assignment[] = [];
  const unfilled: Slot[] = [];
  const noRest: NoRestEvent[] = [];
  const ordered = [...slots].sort((a, b) => a.startMs - b.startMs);

  // no-rest events already carried, so unavoidable ones spread around instead
  // of always landing on the same person
  const misses = new Map<string, number>(people.map((p) => [p.name, 0] as const));
  // Realignment shifts already carried. Shortening is preferred over
  // lengthening, but either way one person should not absorb two of them.
  const adjustedCount = new Map<string, number>(people.map((p) => [p.name, 0] as const));
  const adjusted: AdjustedShift[] = [];

  for (const slot of ordered) {
    const key = `${slot.dateIso}|${slot.startTime}|${slot.column}`;
    const anchor = anchorAt.get(key);
    if (anchor) {
      assignments.push({ slot, person: anchor.person, anchored: true });
      continue;
    }
    if (slot.startMs < boundary) {
      // before the replan boundary and not anchored: leave it as it is
      continue;
    }

    let best: string | null = null;
    let bestScore = -Infinity;
    let bestGap = Number.POSITIVE_INFINITY;

    for (const p of people) {
      const w = windowFor(p, slot);
      if (!w) continue;
      const list = busy.get(p.name)!;
      if (overlaps(list, slot)) continue;

      // Rest is the sliding window after their previous shift in this stay.
      let prevEnd = Number.NEGATIVE_INFINITY;
      let hasPrev = false;
      for (const b of list) {
        if (b.start >= w.from && b.end <= w.until && b.end <= slot.startMs) {
          hasPrev = true;
          if (b.end > prevEnd) prevEnd = b.end;
        }
      }
      const gapH = hasPrev ? (slot.startMs - prevEnd) / HOUR : Number.POSITIVE_INFINITY;

      // HARD: never back to back.
      if (hasPrev && gapH < minRestH) continue;

      // A: how far short of a real rest this would be, 0 when it is fine.
      const shortBy = hasPrev ? Math.max(0, restThresholdH - gapH) : 0;
      const rested = Math.min(hasPrev ? gapH : restThresholdH, restThresholdH);

      // B and C: rest either side of travel. Infinite mid-stay, so it only
      // bites at the edges. Capped - past a day more is not worth trading for.
      const firstOfStay = !list.some((b) => b.start >= w.from && b.end <= w.until);
      const sinceArrival = (slot.startMs - w.from) / HOUR;
      const untilDeparture = (w.until - slot.endMs) / HOUR;
      const bindingRest = Math.min(
        firstOfStay ? sinceArrival : Number.POSITIVE_INFINITY,
        untilDeparture
      );

      const perDay = (hours.get(p.name) ?? 0) / daysAtBase.get(p.name)!;
      const expectedPerDay = (24 * lanes) / Math.max(1, presentAt(people, slot));
      const loadRatio = perDay / Math.max(1, expectedPerDay);

      const score =
        -W_NOREST * (shortBy / restThresholdH) +
        W_RESTED * rested +
        W_TRAVEL * Math.min(bindingRest, 18) -
        W_LOAD * loadRatio -
        (shortBy > 0 ? W_SPREAD * (misses.get(p.name) ?? 0) : 0) -
        (slot.adjusted !== 0 ? W_REUSE * (adjustedCount.get(p.name) ?? 0) : 0);

      if (score > bestScore) {
        bestScore = score;
        best = p.name;
        bestGap = gapH;
      }
    }

    if (best === null) {
      unfilled.push(slot);
      assignments.push({ slot, person: null, anchored: false });
      continue;
    }
    if (Number.isFinite(bestGap) && bestGap < restThresholdH) {
      misses.set(best, (misses.get(best) ?? 0) + 1);
      noRest.push({
        person: best,
        dateIso: slot.dateIso,
        startTime: slot.startTime,
        gotH: Math.round(bestGap * 10) / 10,
        wantedH: restThresholdH,
      });
    }
    if (slot.adjusted !== 0) {
      adjustedCount.set(best, (adjustedCount.get(best) ?? 0) + 1);
      adjusted.push({
        person: best,
        dateIso: slot.dateIso,
        startTime: slot.startTime,
        lengthH: slot.lengthH,
      });
    }
    busy.get(best)!.push({ start: slot.startMs, end: slot.endMs });
    hours.set(best, (hours.get(best) ?? 0) + slot.lengthH);
    assignments.push({ slot, person: best, anchored: false });
  }

  const gaps = restGaps(people, busy);
  const worst = gaps.reduce<number | null>((min, g) => {
    const local = [g.arrivalRestH, g.departureRestH].filter((v): v is number => v !== null);
    if (local.length === 0) return min;
    const here = Math.min(...local);
    return min === null || here < min ? here : min;
  }, null);

  return {
    assignments,
    rows: toShiftRows(assignments),
    unfilled,
    conflicts,
    gaps,
    load: people
      .map((p) => ({
        person: p.name,
        shifts: (busy.get(p.name) ?? []).length,
        hours: hours.get(p.name) ?? 0,
      }))
      .sort((a, b) => b.hours - a.hours),
    worstRestH: worst,
    noRest,
    adjusted,
    elapsedMs: Date.now() - t0,
  };
}

function hmsToMs(hms: string): number {
  const [h, m] = hms.split(":").map(Number);
  return h * HOUR + m * 60_000;
}

/** Rest either side of every stay that actually had a shift in it. */
export function restGaps(people: Person[], busy: Map<string, Busy[]>): RestGap[] {
  const out: RestGap[] = [];
  for (const p of people) {
    const list = (busy.get(p.name) ?? []).slice().sort((a, b) => a.start - b.start);
    for (const w of p.windows) {
      const mine = list.filter((b) => b.start >= w.from && b.end <= w.until);
      out.push({
        person: p.name,
        windowFrom: w.from,
        windowUntil: w.until,
        arrivalRestH: mine.length ? (mine[0].start - w.from) / HOUR : null,
        departureRestH: mine.length ? (w.until - mine[mine.length - 1].end) / HOUR : null,
        interRestH: mine.slice(1).map((b, i) => (b.start - mine[i].end) / HOUR),
      });
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// 4. Rows for the database
// --------------------------------------------------------------------------

/**
 * A slot crossing midnight becomes two rows, because the app's grid is keyed by
 * day and hour. Splitting is a storage detail - the person works one block.
 */
export function toShiftRows(assignments: Assignment[]): ShiftRow[] {
  const rows: ShiftRow[] = [];
  for (const a of assignments) {
    if (!a.person || a.anchored) continue;
    const start = a.slot.startMs;
    const end = a.slot.endMs;
    const midnight = atHour(addDaysIso(a.slot.dateIso, 1), 0);

    if (end <= midnight) {
      rows.push({
        shift_date: a.slot.dateIso,
        start_time: hhmmss(start),
        end_time: end === midnight ? "23:59:59" : hhmmss(end),
        position: a.slot.column,
        person: a.person,
        source: "auto",
      });
    } else {
      rows.push({
        shift_date: a.slot.dateIso,
        start_time: hhmmss(start),
        end_time: "23:59:59",
        position: a.slot.column,
        person: a.person,
        source: "auto",
      });
      rows.push({
        shift_date: addDaysIso(a.slot.dateIso, 1),
        start_time: "00:00:00",
        end_time: hhmmss(end),
        position: a.slot.column,
        person: a.person,
        source: "auto",
      });
    }
  }
  return rows;
}
