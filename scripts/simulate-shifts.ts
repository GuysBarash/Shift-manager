/**
 * Offline run of the real shift planner, with an Excel file as the output.
 *
 *   node scripts/simulate-shifts.ts
 *   node scripts/simulate-shifts.ts --from 2026-10-01 --shift 6 --stagger 3
 *
 * Imports `src/lib/shift-plan.ts` directly — the same code the app runs, not a
 * copy. Nothing here touches Supabase, so a plan can be inspected in Excel
 * before anything is written to the database.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import {
  readRosterWorkbook,
  rosterRange,
  extractPresence,
  buildSlots,
  planShifts,
  DEFAULT_COLUMNS,
  type PlanResult,
  type Person,
} from "../src/lib/shift-plan.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const ROSTER = "C:/Users/Barash/Documents/Roster/output/סבב ג - בית מינ 4 - מומלץ.xlsx";
const OUT = resolve(HERE, "..", "shift-plan-simulation.xlsx");

// The shift pool: every sambatz profile in the app, which is מבצעים + אש +
// מודיעין. Anyone with no days at base in the roster simply drops out.
const SAMBATZ = [
  "עומר גדיש", "יניר מזרחי", "ידידה פויכטנגר", "אורן הירשהורן", "גיא ברש",
  "אלון קלנגל", "אביב אגוזי", "שקד פפר", "יפית בלגזאל", "אילון אביאור",
  "חיים כהן", "עזרא פינקל", "אלישיב מרמור", "יאיר נגר", "נריה יעקב",
];

// The duty window. Earlier dated columns in the workbook are the run-up, and
// carry presence but no shifts.
const WINDOW_START = "2026-09-14";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function fmt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => `${n}`.padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function sheetFromRows(rows: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

/** Days down, slot start times across, names in the cells. */
function gridSheet(result: PlanResult, starts: string[]): XLSX.WorkSheet {
  const byDay = new Map<string, Map<string, string>>();
  for (const a of result.assignments) {
    const day = byDay.get(a.slot.dateIso) ?? new Map<string, string>();
    day.set(a.slot.startTime, a.person ?? "— לא מאויש —");
    byDay.set(a.slot.dateIso, day);
  }
  const header = ["תאריך", "יום", ...starts.map((s) => s.slice(0, 5))];
  const dow = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
  const rows: unknown[][] = [header];
  for (const [day, slots] of [...byDay.entries()].sort()) {
    const [y, m, d] = day.split("-").map(Number);
    rows.push([
      day,
      dow[new Date(y, m - 1, d).getDay()],
      ...starts.map((s) => slots.get(s) ?? ""),
    ]);
  }
  return sheetFromRows(rows);
}

function loadSheet(result: PlanResult, people: Person[]): XLSX.WorkSheet {
  const rows: unknown[][] = [["שם", "משמרות", "שעות", "ימים בבסיס", "שעות ליום בבסיס"]];
  const daysAtBase = new Map(
    people.map((p) => [
      p.name,
      p.windows.reduce((sum, w) => sum + (w.until - w.from) / 86_400_000, 0),
    ])
  );
  for (const l of result.load) {
    const days = daysAtBase.get(l.person) ?? 0;
    rows.push([
      l.person, l.shifts, l.hours,
      Math.round(days * 10) / 10,
      days > 0 ? Math.round((l.hours / days) * 10) / 10 : "",
    ]);
  }
  return sheetFromRows(rows);
}

function restSheet(result: PlanResult): XLSX.WorkSheet {
  const rows: unknown[][] = [
    ["שם", "הגעה", "עזיבה", "מנוחה אחרי הגעה (שעות)", "מנוחה לפני עזיבה (שעות)"],
  ];
  const sorted = [...result.gaps].sort((a, b) => {
    const av = Math.min(a.arrivalRestH ?? 999, a.departureRestH ?? 999);
    const bv = Math.min(b.arrivalRestH ?? 999, b.departureRestH ?? 999);
    return av - bv;
  });
  for (const g of sorted) {
    rows.push([
      g.person, fmt(g.windowFrom), fmt(g.windowUntil),
      g.arrivalRestH ?? "", g.departureRestH ?? "",
    ]);
  }
  return sheetFromRows(rows);
}

function issuesSheet(result: PlanResult): XLSX.WorkSheet {
  const rows: unknown[][] = [["סוג", "פירוט"]];
  for (const c of result.conflicts) rows.push(["התנגשות עוגן", c]);
  for (const s of result.unfilled) rows.push(["משבצת לא מאוישת", `${s.dateIso} ${s.startTime} ${s.column}`]);
  if (rows.length === 1) rows.push(["", "אין בעיות"]);
  return sheetFromRows(rows);
}

function main(): void {
  const shiftHours = Number(arg("--shift") ?? 6);
  const staggerHours = Number(arg("--stagger") ?? 3);
  const from = arg("--from") ?? WINDOW_START;

  const ws = readRosterWorkbook(readFileSync(ROSTER));
  const range = rosterRange(ws);
  const to = arg("--to") ?? range.end;

  const opts = { shiftHours, staggerHours, include: SAMBATZ };
  const people = extractPresence(ws, opts);
  const slots = buildSlots(from, to, opts);
  const result = planShifts(people, slots, [], opts);

  const starts = [...new Set(slots.map((s) => s.startTime))].sort();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, gridSheet(result, starts), "סבב משמרות");
  XLSX.utils.book_append_sheet(wb, loadSheet(result, people), "עומס");
  XLSX.utils.book_append_sheet(wb, restSheet(result), "מנוחה");
  XLSX.utils.book_append_sheet(wb, issuesSheet(result), "בעיות");
  // The ESM build of SheetJS has no fs bound, so emit a buffer and write it.
  writeFileSync(OUT, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

  const restValues = result.gaps
    .flatMap((g) => [g.arrivalRestH, g.departureRestH])
    .filter((v): v is number => v !== null);
  const avgRest = restValues.reduce((a, b) => a + b, 0) / (restValues.length || 1);

  console.log(`roster    ${ROSTER.split("/").pop()}`);
  console.log(`window    ${from} .. ${to}`);
  console.log(`shifts    ${shiftHours}h every ${staggerHours}h  ->  ${slots.length} slots, ` +
              `${DEFAULT_COLUMNS.length} lanes`);
  console.log(`pool      ${people.length} people`);
  console.log(`planned   ${result.elapsedMs} ms`);
  console.log(`unfilled  ${result.unfilled.length}`);
  console.log(`conflicts ${result.conflicts.length}`);
  console.log(`rest      worst ${result.worstRestH}h, average ${Math.round(avgRest * 10) / 10}h`);
  console.log(`hours     ${result.load[result.load.length - 1].hours} .. ${result.load[0].hours}`);
  console.log(`rows      ${result.rows.length}`);
  console.log(`\nwrote ${OUT}`);
}

main();
