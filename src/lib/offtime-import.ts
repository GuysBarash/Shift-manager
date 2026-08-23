import * as XLSX from "xlsx";
import { addDays, parseISODate, toISODate } from "./dates";
import { createClient } from "./supabase/client";
import type { Profile } from "@/types/database";

// Mirrors scripts/import_offtime.py — keep the two in sync if the source
// workbook's layout or the home/base convention ever changes.
const SHEET_NAME = "מכלול כללי חדש";
const DATE_ROW = 2;
const DATE_ROW_LABEL = "תאריך";
const FIRST_DATA_ROW = 6;
// Only an explicit 'V' means at-base — blank, 'X', or anything else means
// at home (not-X-and-not-V is the same as X).
const BASE_MARK = "V";
// A row reserved for a role that hasn't been assigned to a real person yet
// — a placeholder, not someone to import (or warn about not finding).
const PLACEHOLDER_NAMES = new Set(["??"]);
// Safely before any realistic "today" the app will be viewed on, so the
// pre-term leave range always covers "now" regardless of when the term
// this workbook describes actually starts.
const PRE_TERM_ANCHOR = "2000-01-01";

export type OffTimeRange = { start: string; end: string };

export type OffTimeExtraction = {
  people: Map<string, OffTimeRange[]>;
  termStart: string | null;
};

function cellValue(ws: XLSX.WorkSheet, row1: number, col1: number): unknown {
  const addr = XLSX.utils.encode_cell({ r: row1 - 1, c: col1 - 1 });
  return ws[addr]?.v;
}

export function extractOffTime(ws: XLSX.WorkSheet): OffTimeExtraction {
  const ref = ws["!ref"];
  if (!ref) throw new Error("הגיליון ריק.");
  const range = XLSX.utils.decode_range(ref);
  const maxRow = range.e.r + 1;
  const maxCol = range.e.c + 1;

  let nameCol: number | null = null;
  for (let c = 1; c <= maxCol; c++) {
    if (cellValue(ws, DATE_ROW, c) === DATE_ROW_LABEL) {
      nameCol = c;
      break;
    }
  }
  if (nameCol === null) {
    throw new Error(`לא נמצאה התווית "${DATE_ROW_LABEL}" בשורה ${DATE_ROW} של הגיליון "${SHEET_NAME}".`);
  }
  const firstDateCol = nameCol + 1;

  const dateCols: { col: number; iso: string }[] = [];
  for (let c = firstDateCol; c <= maxCol; c++) {
    const v = cellValue(ws, DATE_ROW, c);
    if (v instanceof Date) dateCols.push({ col: c, iso: toISODate(v) });
  }

  const people = new Map<string, OffTimeRange[]>();
  for (let r = FIRST_DATA_ROW; r <= maxRow; r++) {
    const name = cellValue(ws, r, nameCol);
    if (typeof name !== "string" || !name.trim() || PLACEHOLDER_NAMES.has(name.trim())) continue;

    const homeDates: string[] = [];
    for (const { col, iso } of dateCols) {
      if (cellValue(ws, r, col) !== BASE_MARK) homeDates.push(iso);
    }
    homeDates.sort();

    const ranges: OffTimeRange[] = [];
    for (const iso of homeDates) {
      const last = ranges[ranges.length - 1];
      if (last && toISODate(addDays(parseISODate(last.end), 1)) === iso) {
        last.end = iso;
      } else {
        ranges.push({ start: iso, end: iso });
      }
    }
    people.set(name, ranges);
  }

  const termStart = dateCols.reduce<string | null>(
    (min, d) => (min === null || d.iso < min ? d.iso : min),
    null
  );

  return { people, termStart };
}

export function parseOffTimeWorkbook(buffer: ArrayBuffer): OffTimeExtraction {
  const wb = XLSX.read(buffer, { cellDates: true });
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`לא נמצא גיליון בשם "${SHEET_NAME}" בקובץ.`);
  return extractOffTime(ws);
}

export type ApplyOffTimeResult = {
  matchedCount: number;
  insertedCount: number;
  skipped: string[];
};

// Replaces public.time_off for every matched person (delete-then-insert),
// same semantics as scripts/import_offtime.py's generated SQL — safe to
// re-run any time the source workbook is revised.
export async function applyOffTimeImport(
  extraction: OffTimeExtraction,
  profiles: Profile[]
): Promise<ApplyOffTimeResult> {
  const byName = new Map(profiles.map((p) => [p.full_name, p] as const));
  const skipped: string[] = [];
  const matched: { profile: Profile; ranges: OffTimeRange[] }[] = [];

  const preTermEnd =
    extraction.termStart !== null
      ? toISODate(addDays(parseISODate(extraction.termStart), -1))
      : null;

  for (const [name, ranges] of extraction.people) {
    const profile = byName.get(name);
    if (!profile) {
      skipped.push(name);
      continue;
    }
    const finalRanges =
      preTermEnd !== null && preTermEnd >= PRE_TERM_ANCHOR
        ? [{ start: PRE_TERM_ANCHOR, end: preTermEnd }, ...ranges]
        : ranges;
    matched.push({ profile, ranges: finalRanges });
  }

  const supabase = createClient();

  if (matched.length > 0) {
    const { error: delError } = await supabase
      .from("time_off")
      .delete()
      .in(
        "user_id",
        matched.map((m) => m.profile.id)
      );
    if (delError) throw delError;
  }

  const rows = matched.flatMap((m) =>
    m.ranges.map((r) => ({ user_id: m.profile.id, start_date: r.start, end_date: r.end }))
  );
  if (rows.length > 0) {
    const { error: insError } = await supabase.from("time_off").insert(rows);
    if (insError) throw insError;
  }

  return { matchedCount: matched.length, insertedCount: rows.length, skipped };
}
