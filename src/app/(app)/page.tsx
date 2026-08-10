"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  addDays,
  formatDDMMYYYY,
  formatDow,
  formatDowShort,
  formatHourLabel,
  startOfDay,
  toISODate,
} from "@/lib/dates";
import { personColor } from "@/lib/person-color";
import { useDemoIdentity } from "@/lib/demo-identity";
import type { Profile, Shift, TimeOff } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ActivityPanel } from "@/components/activity-panel";
import { Eraser } from "lucide-react";

const RANGE_DAYS = 7;
const TIME_OFF_COLOR = "rgba(148, 163, 184, 0.35)";

function buildDayGrid(dayShifts: Shift[], columns: string[]): Record<string, Shift | null>[] {
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
function buildPersonHourGrid(dayShifts: Shift[], personIds: string[]): Record<string, boolean>[] {
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

type Brush = "erase" | string | null;

export default function ShiftsPage() {
  const { identity } = useDemoIdentity();
  const userId = identity.userId;
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [extended, setExtended] = useState(false);
  const [brush, setBrush] = useState<Brush>(null);
  const isPaintingRef = useRef(false);
  const pendingPaintsRef = useRef<PromiseLike<void>[]>([]);

  const rangeStart = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(
    () => Array.from({ length: RANGE_DAYS }, (_, i) => addDays(rangeStart, i)),
    [rangeStart]
  );

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  const columns = useMemo(() => {
    const set = new Set<string>();
    shifts.forEach((s) => {
      if (s.position) set.add(s.position);
    });
    return [...set].sort();
  }, [shifts]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, Shift[]>();
    shifts.forEach((s) => {
      const list = map.get(s.shift_date) ?? [];
      list.push(s);
      map.set(s.shift_date, list);
    });
    return map;
  }, [shifts]);

  const timeOffByPerson = useMemo(() => {
    const map = new Map<string, TimeOff[]>();
    timeOff.forEach((t) => {
      const list = map.get(t.user_id) ?? [];
      list.push(t);
      map.set(t.user_id, list);
    });
    return map;
  }, [timeOff]);

  function isOnTimeOff(personId: string, dateIso: string): boolean {
    const entries = timeOffByPerson.get(personId);
    if (!entries) return false;
    return entries.some((t) => t.start_date <= dateIso && dateIso <= t.end_date);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const from = toISODate(rangeStart);
    const to = toISODate(addDays(rangeStart, RANGE_DAYS - 1));

    const [
      { data: shiftRows, error: shiftError },
      { data: profileRows, error: profileError },
      { data: timeOffRows, error: timeOffError },
    ] = await Promise.all([
      supabase
        .from("shifts")
        .select("*")
        .gte("shift_date", from)
        .lte("shift_date", to)
        .order("start_time", { ascending: true }),
      supabase.from("profiles").select("*").order("full_name", { ascending: true }),
      supabase.from("time_off").select("*").lte("start_date", to).gte("end_date", from),
    ]);

    if (shiftError) console.error(shiftError);
    if (profileError) console.error(profileError);
    if (timeOffError) console.error(timeOffError);

    setShifts(shiftRows ?? []);
    setProfiles(profileRows ?? []);
    setTimeOff(timeOffRows ?? []);
    setLoading(false);
  }, [rangeStart]);

  // Silent re-fetch of just the shifts (used to reconcile after a paint stroke,
  // without flashing the full-page loading state).
  const syncShifts = useCallback(async () => {
    const supabase = createClient();
    const from = toISODate(rangeStart);
    const to = toISODate(addDays(rangeStart, RANGE_DAYS - 1));
    const { data, error } = await supabase
      .from("shifts")
      .select("*")
      .gte("shift_date", from)
      .lte("shift_date", to)
      .order("start_time", { ascending: true });
    if (error) {
      console.error(error);
      return;
    }
    setShifts(data ?? []);
  }, [rangeStart]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleMouseUp() {
      if (isPaintingRef.current) {
        isPaintingRef.current = false;
        // Wait for every in-flight paint request to settle before reconciling —
        // syncing too early can clobber an optimistic row before its insert
        // response comes back and replaces the temp id with the real one.
        Promise.all(pendingPaintsRef.current).then(() => syncShifts());
        pendingPaintsRef.current = [];
      }
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [syncShifts]);

  const todayIso = toISODate(now);
  const currentHour = now.getHours();

  function scrollToRow(dateIso: string, hour: number) {
    document.getElementById(`row-${dateIso}-${hour}`)?.scrollIntoView({ behavior: "auto", block: "center" });
  }

  function scrollToNow() {
    scrollToRow(todayIso, currentHour);
  }

  function scrollToNextMine() {
    const nowKey = `${todayIso}T${String(currentHour).padStart(2, "0")}`;
    let best: { date: string; hour: number; key: string } | null = null;
    for (const s of shifts) {
      if (s.assigned_to !== userId) continue;
      const [h] = s.start_time.split(":").map(Number);
      const key = `${s.shift_date}T${String(h).padStart(2, "0")}`;
      if (key < nowKey) continue;
      if (!best || key < best.key) best = { date: s.shift_date, hour: h, key };
    }
    if (!best) {
      toast.info("אין לך משמרות קרובות בטווח המוצג.");
      return;
    }
    scrollToRow(best.date, best.hour);
  }

  // Inserts a single hour-aligned (or shorter) piece, optimistically first.
  async function createPiece(
    shiftDate: string,
    col: string,
    start: string,
    end: string,
    assignedTo: string | null,
    notes: string | null
  ) {
    const supabase = createClient();
    const tempId = `temp-${Math.random().toString(36).slice(2)}`;
    const optimistic: Shift = {
      id: tempId,
      shift_date: shiftDate,
      start_time: start,
      end_time: end,
      position: col,
      assigned_to: assignedTo,
      notes,
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    setShifts((prev) => [...prev, optimistic]);
    const { data, error } = await supabase
      .from("shifts")
      .insert({
        shift_date: shiftDate,
        start_time: start,
        end_time: end,
        position: col,
        assigned_to: assignedTo,
        notes,
        created_by: userId,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "שגיאה.");
      setShifts((prev) => prev.filter((s) => s.id !== tempId));
      return;
    }
    setShifts((prev) => prev.map((s) => (s.id === tempId ? data : s)));
  }

  // Each hour cell is independent: painting/erasing one hour of a longer
  // shift splits it, leaving the untouched hours as separate rows instead of
  // affecting the whole block.
  function paintCell(day: Date, hour: number, col: string, existingShift: Shift | null) {
    if (!brush) return;
    const supabase = createClient();
    const shiftDate = toISODate(day);
    const hourStart = `${String(hour).padStart(2, "0")}:00:00`;
    const hourEnd = hour === 23 ? "23:59:59" : `${String(hour + 1).padStart(2, "0")}:00:00`;

    if (!existingShift) {
      if (brush === "erase") return;
      pendingPaintsRef.current.push(createPiece(shiftDate, col, hourStart, hourEnd, brush, null));
      return;
    }

    if (brush !== "erase" && existingShift.assigned_to === brush) return;

    const hasBefore = existingShift.start_time < hourStart;
    const hasAfter = hourEnd < existingShift.end_time;

    setShifts((prev) => prev.filter((s) => s.id !== existingShift.id));
    const work: PromiseLike<void>[] = [
      supabase
        .from("shifts")
        .delete()
        .eq("id", existingShift.id)
        .then(({ error }) => {
          if (error) toast.error(error.message);
        }),
    ];
    if (hasBefore) {
      work.push(
        createPiece(shiftDate, col, existingShift.start_time, hourStart, existingShift.assigned_to, existingShift.notes)
      );
    }
    if (hasAfter) {
      work.push(
        createPiece(shiftDate, col, hourEnd, existingShift.end_time, existingShift.assigned_to, existingShift.notes)
      );
    }
    if (brush !== "erase") {
      work.push(createPiece(shiftDate, col, hourStart, hourEnd, brush, null));
    }
    pendingPaintsRef.current.push(Promise.all(work).then(() => {}));
  }

  function handlePaintDown(day: Date, hour: number, col: string, shift: Shift | null) {
    if (!brush) return;
    isPaintingRef.current = true;
    paintCell(day, hour, col, shift);
  }

  function handlePaintEnter(day: Date, hour: number, col: string, shift: Shift | null) {
    if (!brush || !isPaintingRef.current) return;
    paintCell(day, hour, col, shift);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-wide glow-text">
          לוח משמרות{" "}
          <span className="text-muted-foreground">
            — החל מ{formatDow(rangeStart)} {formatDDMMYYYY(rangeStart)}
          </span>
        </h1>
        <ActivityPanel profiles={profiles} />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="outline" size="sm" onClick={scrollToNow}>
          עכשיו!
        </Button>
        <Button variant="outline" size="sm" onClick={scrollToNextMine}>
          מתי אני
        </Button>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={extended} onCheckedChange={setExtended} />
          תצוגה מורחבת
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">טוען…</p>
      ) : columns.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          אין עדיין משמרות בלוח.
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <BrushToolbar profiles={profiles} brush={brush} onSelect={setBrush} />

          <div className="max-h-[75vh] overflow-auto rounded-md border border-border/60 glow-border">
            <div className="flex items-start">
              <table className="shrink-0 border-collapse text-sm select-none">
                <thead className="sticky top-0 z-20 bg-card">
                  <tr>
                    <th className="sticky start-0 z-30 w-14 min-w-14 max-w-14 border-b border-border/60 bg-card px-1.5 py-2 text-start text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      תאריך
                    </th>
                    <th className="sticky start-14 z-30 w-16 min-w-16 max-w-16 border-b border-s border-border/60 bg-card px-1.5 py-2 text-start text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      שעה
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col}
                        className="min-w-32 border-b border-s border-border/60 bg-card px-3 py-2 text-start font-medium tracking-wide text-primary uppercase glow-text"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => {
                    const iso = toISODate(day);
                    const dayGrid = buildDayGrid(shiftsByDay.get(iso) ?? [], columns);
                    return (
                      <FragmentDay
                        key={iso}
                        iso={iso}
                        day={day}
                        dayGrid={dayGrid}
                        columns={columns}
                        isToday={iso === todayIso}
                        currentHour={currentHour}
                        profileById={profileById}
                        userId={userId}
                        brushActive={!!brush}
                        onPaintDown={(hour, col, shift) => handlePaintDown(day, hour, col, shift)}
                        onPaintEnter={(hour, col, shift) => handlePaintEnter(day, hour, col, shift)}
                      />
                    );
                  })}
                </tbody>
              </table>

              {extended && profiles.length > 0 && (
                <table className="shrink-0 border-collapse text-sm">
                  <thead className="sticky top-0 z-20 bg-card">
                    <tr>
                      {profiles.map((p) => {
                        const color = personColor(p.id, p.color);
                        return (
                          <th
                            key={p.id}
                            className="min-w-24 border-b border-s border-border/60 bg-card px-2 py-2 text-center text-xs font-medium tracking-wide uppercase glow-text"
                            style={{ color: color?.hex }}
                          >
                            {p.full_name || "?"}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((day) => {
                      const iso = toISODate(day);
                      const personGrid = buildPersonHourGrid(
                        shiftsByDay.get(iso) ?? [],
                        profiles.map((p) => p.id)
                      );
                      return personGrid.map((row, hour) => (
                        <tr key={`${iso}-people-${hour}`}>
                          {profiles.map((p) => {
                            const onShift = row[p.id];
                            const offToday = !onShift && isOnTimeOff(p.id, iso);
                            const color = personColor(p.id, p.color);
                            return (
                              <td
                                key={p.id}
                                className="border-b border-s border-border/60 px-2 py-1.5 text-center font-mono text-xs"
                                style={{
                                  backgroundColor: onShift
                                    ? `${color?.hex}55`
                                    : offToday
                                      ? TIME_OFF_COLOR
                                      : undefined,
                                }}
                              >
                                {" "}
                              </td>
                            );
                          })}
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BrushToolbar({
  profiles,
  brush,
  onSelect,
}: {
  profiles: Profile[];
  brush: Brush;
  onSelect: (b: Brush) => void;
}) {
  return (
    <div className="sticky top-4 flex shrink-0 flex-col gap-1 self-start rounded-md border border-border/60 bg-card p-2">
      <button
        type="button"
        onClick={() => onSelect(brush === "erase" ? null : "erase")}
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs whitespace-nowrap transition-colors ${
          brush === "erase"
            ? "bg-destructive/15 text-destructive ring-1 ring-destructive/60"
            : "text-muted-foreground hover:bg-accent"
        }`}
      >
        <Eraser className="size-4" />
        מחיקה
      </button>
      <div className="my-1 h-px bg-border/60" />
      {profiles.map((p) => {
        const color = personColor(p.id, p.color);
        const selected = brush === p.id;
        return (
          <button
            type="button"
            key={p.id}
            onClick={() => onSelect(selected ? null : p.id)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs whitespace-nowrap transition-colors hover:bg-accent"
            style={{
              backgroundColor: selected && color ? `${color.hex}22` : undefined,
              boxShadow: selected && color ? `0 0 0 1px ${color.hex}` : undefined,
            }}
          >
            <span
              className="size-3 shrink-0 rounded-full"
              style={{
                backgroundColor: color?.hex,
                boxShadow: color ? `0 0 6px ${color.hex}` : undefined,
              }}
            />
            <span style={{ color: color?.hex }}>{p.full_name || "?"}</span>
          </button>
        );
      })}
    </div>
  );
}

function FragmentDay({
  iso,
  day,
  dayGrid,
  columns,
  isToday,
  currentHour,
  profileById,
  userId,
  brushActive,
  onPaintDown,
  onPaintEnter,
}: {
  iso: string;
  day: Date;
  dayGrid: Record<string, Shift | null>[];
  columns: string[];
  isToday: boolean;
  currentHour: number;
  profileById: Map<string, Profile>;
  userId: string;
  brushActive: boolean;
  onPaintDown: (hour: number, col: string, shift: Shift | null) => void;
  onPaintEnter: (hour: number, col: string, shift: Shift | null) => void;
}) {
  return (
    <>
      {dayGrid.map((row, hour) => {
        const isNowRow = isToday && hour === currentHour;
        return (
          <tr key={`${iso}-${hour}`} id={`row-${iso}-${hour}`}>
            {hour === 0 && (
              <td
                rowSpan={24}
                className={`sticky start-0 z-10 w-14 min-w-14 max-w-14 border-b border-e border-border/60 bg-secondary/40 px-1 py-1.5 align-top font-mono leading-tight ${
                  isToday ? "text-primary glow-text" : "text-secondary-foreground"
                }`}
              >
                <div className="text-xs font-bold">{formatDowShort(day)}</div>
                <div className="text-[10px]">{formatDDMMYYYY(day)}</div>
                {isToday && <div className="text-[9px] text-primary glow-text">היום</div>}
              </td>
            )}
            <td
              className={`sticky start-14 z-10 w-16 min-w-16 max-w-16 border-b border-border/60 bg-card px-1 py-1.5 font-mono text-xs leading-tight ${
                isNowRow ? "text-primary glow-text font-bold" : "text-muted-foreground"
              }`}
            >
              {formatHourLabel(hour)}
              {isNowRow && <div className="text-[9px] animate-pulse">◄ עכשיו</div>}
            </td>
            {columns.map((col) => {
              const shift = row[col];
              const assignee = shift?.assigned_to ? profileById.get(shift.assigned_to) : null;
              const color = shift?.assigned_to ? personColor(shift.assigned_to, assignee?.color) : null;
              const isMine = shift?.assigned_to === userId;

              return (
                <td
                  key={col}
                  onMouseDown={() => onPaintDown(hour, col, shift)}
                  onMouseEnter={() => onPaintEnter(hour, col, shift)}
                  className={`border-b border-s border-border/60 px-3 py-1.5 transition-colors hover:brightness-125 ${
                    brushActive ? "cursor-crosshair" : "cursor-default"
                  } ${isNowRow && !shift ? "bg-primary/10" : ""} ${
                    isMine ? "ring-1 ring-inset ring-primary/50" : ""
                  }`}
                  style={
                    shift
                      ? {
                          backgroundColor: color ? `${color.hex}22` : undefined,
                          borderInlineStart: color ? `3px solid ${color.hex}` : undefined,
                        }
                      : undefined
                  }
                >
                  {shift ? (
                    <span
                      className="font-medium"
                      style={{ color: color?.hex, textShadow: color ? `0 0 6px ${color.hex}66` : undefined }}
                    >
                      {assignee?.full_name || "לא משויך"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40">·</span>
                  )}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
