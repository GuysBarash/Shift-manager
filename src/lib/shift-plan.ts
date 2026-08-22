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
};

/**
 * A work block: "6 work, 6 rest, 6 work". Two shifts 12h apart in the SAME
 * column, which is what the rotation is built from. A block of one slot is an
 * edge break - the start or end of a chain, where there is nothing to pair to.
 */
export type Block = {
  slots: Slot[];
  startMs: number;
  endMs: number;
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
  staggerHours?: number;    // default 3 — a new person starts every 3h
  columns?: string[];       // default the app's two slots
  arriveHour?: number;      // default 10 — expected at base by
  departHour?: number;      // default 10 — leave the morning after the last day
  fromDate?: string | null; // replan boundary; slots starting earlier are left alone
  toDate?: string | null;
  /** Only these people take shifts (the app passes sambatz profiles). */
  include?: string[];
  /** Shifts taken back-to-back before the long rest. Default 2 (the pair). */
  pairSize?: number;
  /**
   * HARD floor on the gap between one block and the next, in hours. Default
   * shiftHours. Nobody is ever scheduled closer than this - see the note in
   * planShifts. A slot goes unfilled rather than break it.
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
  /** Every gap that missed the cycle pattern, with what was wanted. */
  patternDeviations: PatternNote[];
  elapsedMs: number;
};

/**
 * One gap that did not match the rotation. `wantedH` is what the cycle called
 * for at that moment - `shiftHours` mid-pair, the long rest after it.
 */
export type PatternNote = {
  person: string;
  dateIso: string;
  startTime: string;
  gotH: number;
  wantedH: number;
};

export const DEFAULT_COLUMNS = ["משמרת א׳", "משמרת ב׳"];
const HOUR = 3600_000;

// Scoring weights. Pattern adherence leads mid-stay; travel rest leads at the
// edges of a stay, where there is no previous shift to pattern against.
const W_PATTERN = 40;
const W_TRAVEL = 10;
const W_LOAD = 15;
const W_SPREAD = 4;

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
 * One slot every `staggerHours`, each `shiftHours` long. With 6 and 3 that is
 * eight slots a day and two people on duty at any moment, which is why the app
 * has exactly two columns. Columns cycle so each holds a contiguous chain.
 */
export function buildSlots(startIso: string, endIso: string, opts: PlanOptions = {}): Slot[] {
  const shiftHours = opts.shiftHours ?? 6;
  const staggerHours = opts.staggerHours ?? 3;
  const perDay = Math.round(24 / staggerHours);
  const lanes = Math.max(1, Math.round(shiftHours / staggerHours));
  const columns = opts.columns ?? DEFAULT_COLUMNS;
  if (columns.length < lanes) {
    throw new Error(
      `משמרת של ${shiftHours} שעות כל ${staggerHours} שעות דורשת ${lanes} עמודות, יש ${columns.length}.`
    );
  }

  const slots: Slot[] = [];
  let day = startIso;
  let k = 0;
  while (day <= endIso) {
    for (let i = 0; i < perDay; i++) {
      // Built from LOCAL calendar hours, never midnight + n milliseconds.
      // Israel's clocks go back on the last Sunday of October, so that day has
      // 25 hours and a fixed-ms offset lands an hour early for the rest of it.
      // src/lib/dates.ts carries the same warning - this broke once already.
      const startMs = atHour(day, i * staggerHours);
      const endMs = atHour(day, i * staggerHours + shiftHours);
      slots.push({
        startMs,
        endMs,
        column: columns[k % lanes],
        dateIso: day,
        startTime: hhmmss(startMs),
      });
      k++;
    }
    day = addDaysIso(day, 1);
  }
  return slots;
}

// --------------------------------------------------------------------------
// 3. Planning
// --------------------------------------------------------------------------

/**
 * Pair the slots into work blocks.
 *
 * Inside one column the starts are shiftHours apart (col A 00,06,12,18), so
 * two shifts 12h apart are slot i and slot i+2. That splits each column into
 * two independent chains - even index and odd index - and each chain is paired
 * end to end. A chain of odd length leaves a single-slot block at its tail.
 *
 * NOTE: pairing FIRST is what makes the 6h intra-pair rest exact. Scoring it
 * per-slot instead lets the greedy wander, which is what produced back-to-back
 * shifts with 0h between them.
 */
export function buildBlocks(slots: Slot[], loose: Set<string> = new Set()): Block[] {
  const byColumn = new Map<string, Slot[]>();
  for (const s of slots) {
    const list = byColumn.get(s.column) ?? [];
    list.push(s);
    byColumn.set(s.column, list);
  }

  const blocks: Block[] = [];
  for (const list of byColumn.values()) {
    list.sort((a, b) => a.startMs - b.startMs);
    for (const parity of [0, 1]) {
      const chain = list.filter((_, i) => i % 2 === parity);
      let i = 0;
      while (i < chain.length) {
        const a = chain[i];
        const b = chain[i + 1];
        const keyA = `${a.dateIso}|${a.startTime}|${a.column}`;
        const keyB = b ? `${b.dateIso}|${b.startTime}|${b.column}` : "";
        // An anchored slot owns itself, so never fold it into a pair.
        if (b && !loose.has(keyA) && !loose.has(keyB)) {
          blocks.push({ slots: [a, b], startMs: a.startMs, endMs: b.endMs });
          i += 2;
        } else {
          blocks.push({ slots: [a], startMs: a.startMs, endMs: a.endMs });
          i += 1;
        }
      }
    }
  }
  return blocks.sort((a, b) => a.startMs - b.startMs);
}

type Busy = { start: number; end: number };

function windowFor(person: Person, slot: Slot): PresenceWindow | null {
  for (const w of person.windows) {
    if (slot.startMs >= w.from && slot.endMs <= w.until) return w;
  }
  return null;
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
  const staggerHours = opts.staggerHours ?? 3;
  const pairSize = opts.pairSize ?? 2;
  const minRestH = opts.minRestH ?? shiftHours;
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

  // -- rotation shape ------------------------------------------------------
  //
  // Slots are paired into blocks of "6 work, 6 rest, 6 work" first, so the 6h
  // intra-pair rest is exact by construction. What is left to choose is WHO
  // takes each block, and the gap between one person's blocks - the long rest.
  //
  // With `lanes` on duty at once and N people present, the cycle is
  //   pairSize * shiftHours * N / lanes
  // and the long rest is whatever is left after the pair and its inner gap.
  // N is counted per block because people arrive and leave.
  const lanes = Math.max(1, Math.round(shiftHours / staggerHours));

  function longRestFor(present: number): number {
    if (present <= 0) return shiftHours;
    const cycleH = (pairSize * shiftHours * present) / lanes;
    return Math.max(shiftHours, cycleH - (2 * pairSize - 1) * shiftHours);
  }

  // -- greedy over blocks, in time order -----------------------------------
  const assignments: Assignment[] = [];
  const unfilled: Slot[] = [];
  const patternDeviations: PatternNote[] = [];
  // Pattern misses already carried, so leftovers spread instead of always
  // landing on the same person.
  const misses = new Map<string, number>(people.map((p) => [p.name, 0] as const));

  const blocks = buildBlocks(slots, new Set(anchorAt.keys()));

  for (const block of blocks) {
    const first = block.slots[0];
    const key = `${first.dateIso}|${first.startTime}|${first.column}`;
    const anchor = block.slots.length === 1 ? anchorAt.get(key) : undefined;
    if (anchor) {
      assignments.push({ slot: first, person: anchor.person, anchored: true });
      continue;
    }
    if (block.startMs < boundary) {
      // before the replan boundary and not anchored: leave it as it is
      continue;
    }

    let present = 0;
    for (const p of people) if (block.slots.every((sl) => windowFor(p, sl))) present++;
    const longRestH = longRestFor(present);

    let best: string | null = null;
    let bestScore = -Infinity;
    let bestGap = Number.POSITIVE_INFINITY;

    for (const p of people) {
      // Must be at base for EVERY slot in the block, and free for all of them.
      const w = windowFor(p, block.slots[0]);
      if (!w) continue;
      if (!block.slots.every((sl) => windowFor(p, sl))) continue;
      const list = busy.get(p.name)!;
      if (block.slots.some((sl) => overlaps(list, sl))) continue;

      const done = list
        .filter((b) => b.start >= w.from && b.end <= w.until && b.end <= block.startMs)
        .sort((a, b) => a.start - b.start);
      const firstOfStay = done.length === 0 && !list.some((b) => b.start >= w.from && b.end <= w.until);

      // Rest as the sliding window after their last shift.
      const gapH = done.length
        ? (block.startMs - done[done.length - 1].end) / HOUR
        : Number.POSITIVE_INFINITY;

      // Rest is scored as "have they had their long rest yet", saturating at the
      // target. Overshooting must NOT be penalised: an earlier version scored
      // distance from the target in both directions, so somebody rested 30h
      // scored barely above somebody rested 0h and the load term decided it -
      // which is what produced blocks taken back to back.
      // HARD RULE: never back to back.
      //
      // Two blocks in the same column interleave perfectly - (03:00,15:00) and
      // (09:00,21:00) - so one person holding both works 03:00 straight
      // through to 03:00 the next day. Scoring alone did not stop it: the
      // travel term swings 180 while the pattern term swings 60, so protecting
      // somebody's departure rest outvoted a 24h marathon. It is a filter now,
      // not a penalty. If that leaves nobody, the slot is reported unfilled.
      if (Number.isFinite(gapH) && gapH < minRestH) continue;

      let patternFit = 1;
      if (Number.isFinite(gapH)) {
        patternFit = Math.min(gapH, longRestH) / longRestH;
        if (gapH < longRestH) patternFit -= 0.5 * (1 - gapH / longRestH);
      }

      const sinceArrival = (block.startMs - w.from) / HOUR;
      const untilDeparture = (w.until - block.endMs) / HOUR;
      const bindingRest = Math.min(
        firstOfStay ? sinceArrival : Number.POSITIVE_INFINITY,
        untilDeparture
      );
      // Load as a RATIO of what this pool size implies (48 h/day shared by N
      // people at 2 lanes), not raw hours. Raw hours/day sits near 8 and the
      // weighted term then swamps the pattern term, which is what produced
      // blocks taken back to back with 0h between them.
      const perDay = (hours.get(p.name) ?? 0) / daysAtBase.get(p.name)!;
      const expectedPerDay = (24 * lanes) / Math.max(1, present);
      const loadRatio = perDay / Math.max(1, expectedPerDay);
      const wouldMiss = Number.isFinite(gapH) && Math.abs(gapH - longRestH) > 1;

      const score =
        W_PATTERN * patternFit +
        W_TRAVEL * Math.min(bindingRest, 18) -
        W_LOAD * loadRatio -
        (wouldMiss ? W_SPREAD * (misses.get(p.name) ?? 0) : 0);

      if (score > bestScore) {
        bestScore = score;
        best = p.name;
        bestGap = gapH;
      }
    }

    if (best === null) {
      for (const sl of block.slots) {
        unfilled.push(sl);
        assignments.push({ slot: sl, person: null, anchored: false });
      }
      continue;
    }
    if (Number.isFinite(bestGap) && Math.abs(bestGap - longRestH) > 1) {
      misses.set(best, (misses.get(best) ?? 0) + 1);
      patternDeviations.push({
        person: best,
        dateIso: first.dateIso,
        startTime: first.startTime,
        gotH: Math.round(bestGap * 10) / 10,
        wantedH: Math.round(longRestH * 10) / 10,
      });
    }
    for (const sl of block.slots) {
      busy.get(best)!.push({ start: sl.startMs, end: sl.endMs });
      hours.set(best, (hours.get(best) ?? 0) + shiftHours);
      assignments.push({ slot: sl, person: best, anchored: false });
    }
  }
  assignments.sort((a, b) => a.slot.startMs - b.slot.startMs);

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
    patternDeviations,
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
