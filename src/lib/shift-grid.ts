import type { Shift } from "@/types/database";

export function buildDayGrid(dayShifts: Shift[], columns: string[]): Record<string, Shift | null>[] {
  const hourOwner: Record<string, (Shift | null)[]> = {};
  for (const col of columns) {
    hourOwner[col] = new Array(24).fill(null);
  }
  for (const shift of dayShifts) {
    const col = shift.position ?? "";
    if (!hourOwner[col]) continue;
    const [startH] = shift.start_time.split(":").map(Number);
    const [endH, endM, endS] = shift.end_time.split(":").map(Number);
    const lastHour = endM === 0 && (endS ?? 0) === 0 ? endH - 1 : endH;
    for (let h = startH; h <= lastHour && h < 24; h++) {
      hourOwner[col][h] = shift;
    }
  }

  const rows: Record<string, Shift | null>[] = [];
  for (let h = 0; h < 24; h++) {
    const row: Record<string, Shift | null> = {};
    for (const col of columns) {
      row[col] = hourOwner[col][h];
    }
    rows.push(row);
  }
  return rows;
}

// Same idea as buildDayGrid, but keyed by person (across all positions) instead
// of by position — powers the "extended" per-person status table.
export function buildPersonHourGrid(dayShifts: Shift[], personIds: string[]): Record<string, boolean>[] {
  const hourOwner: Record<string, boolean[]> = {};
  for (const pid of personIds) {
    hourOwner[pid] = new Array(24).fill(false);
  }
  for (const shift of dayShifts) {
    if (!shift.assigned_to || !hourOwner[shift.assigned_to]) continue;
    const [startH] = shift.start_time.split(":").map(Number);
    const [endH, endM, endS] = shift.end_time.split(":").map(Number);
    const lastHour = endM === 0 && (endS ?? 0) === 0 ? endH - 1 : endH;
    for (let h = startH; h <= lastHour && h < 24; h++) {
      hourOwner[shift.assigned_to][h] = true;
    }
  }

  const rows: Record<string, boolean>[] = [];
  for (let h = 0; h < 24; h++) {
    const row: Record<string, boolean> = {};
    for (const pid of personIds) {
      row[pid] = hourOwner[pid][h];
    }
    rows.push(row);
  }
  return rows;
}
