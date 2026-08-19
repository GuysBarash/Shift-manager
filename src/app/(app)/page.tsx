"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { addDays, formatDDMMYYYY, formatDow, startOfDay, toISODate } from "@/lib/dates";
import { buildColorAssignments } from "@/lib/person-color";
import { useDemoIdentity } from "@/lib/demo-identity";
import { scheduleRangeDays } from "@/lib/schedule-range";
import { buildDateRange, isOnTimeOff, buildTimeOffIndex, sambatzProfiles as selectSambatz, TIME_OFF_COLOR } from "@/lib/roster";
import { buildDayGrid, buildPersonHourGrid } from "@/lib/shift-grid";
import { BrushToolbar, type Brush } from "@/components/brush-toolbar";
import { FragmentDay } from "@/components/shift-day-rows";
import type { Profile, Shift, TimeOff } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ActivityPanel } from "@/components/activity-panel";

// Two fixed slots per hour rather than positions derived from existing
// shifts — that made an empty board a dead end (no columns meant nowhere to
// paint a first shift).
const SHIFT_COLUMNS = ["משמרת א׳", "משמרת ב׳"];

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
  const [editMode, setEditMode] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
  const isPaintingRef = useRef(false);
  // Mirrors `shifts`, but mutated as plain synchronous JS instead of through
  // React state — a setShifts *updater function* only actually runs when
  // React flushes the batch, which is too late for a fast drag stroke
  // (several mousedown/mouseenter events can fire before that flush, so an
  // updater-based ref would still read stale data across all of them). This
  // ref is always current the instant applyShifts returns.
  const shiftsRef = useRef<Shift[]>([]);
  // Snapshot taken the moment edit mode is entered, restored verbatim on
  // discard. Every paint/erase during edit mode only ever touches local
  // state (see paintCell) — nothing reaches the DB until Save, so this one
  // snapshot is the entire undo story.
  const editSnapshotRef = useRef<Shift[] | null>(null);

  function applyShifts(updater: (prev: Shift[]) => Shift[]) {
    const next = updater(shiftsRef.current);
    shiftsRef.current = next;
    setShifts(next);
  }

  const rangeStart = useMemo(() => startOfDay(new Date()), []);
  const RANGE_DAYS = useMemo(() => scheduleRangeDays(rangeStart), [rangeStart]);
  const days = useMemo(() => buildDateRange(rangeStart, RANGE_DAYS), [rangeStart, RANGE_DAYS]);

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  // Only Sambatz can actually be assigned to shifts — the paint palette and
  // the per-person extended table are scoped to them.
  const sambatzProfiles = useMemo(() => selectSambatz(profiles), [profiles]);

  const colorAssignments = useMemo(() => buildColorAssignments(profiles), [profiles]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, Shift[]>();
    shifts.forEach((s) => {
      const list = map.get(s.shift_date) ?? [];
      list.push(s);
      map.set(s.shift_date, list);
    });
    return map;
  }, [shifts]);

  const timeOffIndex = useMemo(() => buildTimeOffIndex(timeOff), [timeOff]);

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

    applyShifts(() => shiftRows ?? []);
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
    applyShifts(() => data ?? []);
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
      isPaintingRef.current = false;
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const todayIso = toISODate(now);
  const currentHour = now.getHours();

  function scrollToRow(dateIso: string, hour: number) {
    document.getElementById(`row-${dateIso}-${hour}`)?.scrollIntoView({ behavior: "auto", block: "center" });
  }

  function scrollToNow() {
    scrollToRow(todayIso, currentHour);
  }

  function enterEditMode() {
    if (editMode) return;
    editSnapshotRef.current = shiftsRef.current;
    setEditMode(true);
  }

  function discardEdits() {
    if (editSnapshotRef.current) {
      applyShifts(() => editSnapshotRef.current!);
    }
    editSnapshotRef.current = null;
    setEditMode(false);
    setBrush(null);
  }

  async function saveEdits() {
    if (!editSnapshotRef.current) {
      setEditMode(false);
      return;
    }
    setSavingEdits(true);
    const supabase = createClient();

    // Diff against the snapshot rather than replacing the whole visible
    // range — only what actually changed during this edit session touches
    // the DB, and unrelated rows (and their audit history) are untouched.
    const originalIds = new Set(editSnapshotRef.current.map((s) => s.id));
    const currentIds = new Set(shiftsRef.current.map((s) => s.id));
    const toDeleteIds = [...originalIds].filter((id) => !currentIds.has(id));
    const toInsert = shiftsRef.current.filter((s) => s.id.startsWith("temp-"));

    if (toDeleteIds.length > 0) {
      const { error } = await supabase.from("shifts").delete().in("id", toDeleteIds);
      if (error) {
        toast.error(error.message);
        setSavingEdits(false);
        return;
      }
    }
    if (toInsert.length > 0) {
      const { error } = await supabase.from("shifts").insert(
        toInsert.map((s) => ({
          shift_date: s.shift_date,
          start_time: s.start_time,
          end_time: s.end_time,
          position: s.position,
          assigned_to: s.assigned_to,
          notes: s.notes,
          created_by: userId,
        }))
      );
      if (error) {
        toast.error(error.message);
        setSavingEdits(false);
        return;
      }
    }

    await syncShifts();
    editSnapshotRef.current = null;
    setEditMode(false);
    setBrush(null);
    setSavingEdits(false);
    toast.success("השינויים נשמרו.");
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

  // Purely local — no network call. Edit mode batches every change into one
  // Save, so nothing reaches the DB until then.
  function createLocalPiece(
    shiftDate: string,
    col: string,
    start: string,
    end: string,
    assignedTo: string | null,
    notes: string | null
  ) {
    const tempId = `temp-${Math.random().toString(36).slice(2)}`;
    const piece: Shift = {
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
    applyShifts((prev) => [...prev, piece]);
  }

  // Each hour cell is independent: painting/erasing one hour of a longer
  // shift splits it, leaving the untouched hours as separate rows instead of
  // affecting the whole block. Everything here is local-only (edit mode) —
  // no async DB round-trips, so no race between rapid strokes is possible.
  function paintCell(day: Date, hour: number, col: string) {
    if (!brush) return;
    const shiftDate = toISODate(day);
    const hourStart = `${String(hour).padStart(2, "0")}:00:00`;
    const hourEnd = hour === 23 ? "23:59:59" : `${String(hour + 1).padStart(2, "0")}:00:00`;

    const existingShift =
      shiftsRef.current.find(
        (s) =>
          s.shift_date === shiftDate &&
          (s.position ?? "") === col &&
          s.start_time < hourEnd &&
          hourStart < s.end_time
      ) ?? null;

    if (!existingShift) {
      if (brush === "erase") return;
      createLocalPiece(shiftDate, col, hourStart, hourEnd, brush, null);
      return;
    }

    if (brush !== "erase" && existingShift.assigned_to === brush) return;

    const hasBefore = existingShift.start_time < hourStart;
    const hasAfter = hourEnd < existingShift.end_time;

    applyShifts((prev) => prev.filter((s) => s.id !== existingShift.id));
    if (hasBefore) {
      createLocalPiece(shiftDate, col, existingShift.start_time, hourStart, existingShift.assigned_to, existingShift.notes);
    }
    if (hasAfter) {
      createLocalPiece(shiftDate, col, hourEnd, existingShift.end_time, existingShift.assigned_to, existingShift.notes);
    }
    if (brush !== "erase") {
      createLocalPiece(shiftDate, col, hourStart, hourEnd, brush, null);
    }
  }

  function handlePaintDown(day: Date, hour: number, col: string) {
    if (!brush || !editMode) return;
    isPaintingRef.current = true;
    paintCell(day, hour, col);
  }

  function handlePaintEnter(day: Date, hour: number, col: string) {
    if (!brush || !editMode || !isPaintingRef.current) return;
    paintCell(day, hour, col);
  }

  return (
    <div className="space-y-2 sm:space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold tracking-wide glow-text sm:text-lg">
          לוח משמרות{" "}
          <span className="hidden text-muted-foreground sm:inline">
            — החל מ{formatDow(rangeStart)} {formatDDMMYYYY(rangeStart)}
          </span>
        </h1>
        <ActivityPanel profiles={profiles} />
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
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
      ) : (
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-3">
          <BrushToolbar
            profiles={sambatzProfiles}
            colorAssignments={colorAssignments}
            brush={brush}
            onSelect={(b) => {
              setBrush(b);
              if (b) enterEditMode();
            }}
            editMode={editMode}
            onToggleEditMode={(on) => (on ? enterEditMode() : discardEdits())}
            onSave={saveEdits}
            onDiscard={discardEdits}
            saving={savingEdits}
          />

          <div className="max-h-[68vh] flex-1 overflow-auto rounded-md border border-border/60 glow-border md:max-h-[75vh]">
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
                    {SHIFT_COLUMNS.map((col) => (
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
                    const dayGrid = buildDayGrid(shiftsByDay.get(iso) ?? [], SHIFT_COLUMNS);
                    return (
                      <FragmentDay
                        key={iso}
                        iso={iso}
                        day={day}
                        dayGrid={dayGrid}
                        columns={SHIFT_COLUMNS}
                        isToday={iso === todayIso}
                        currentHour={currentHour}
                        profileById={profileById}
                        colorAssignments={colorAssignments}
                        userId={userId}
                        brushActive={!!brush}
                        onPaintDown={(hour, col) => handlePaintDown(day, hour, col)}
                        onPaintEnter={(hour, col) => handlePaintEnter(day, hour, col)}
                      />
                    );
                  })}
                </tbody>
              </table>

              {extended && sambatzProfiles.length > 0 && (
                <table className="shrink-0 border-collapse text-sm">
                  <thead className="sticky top-0 z-20 bg-card">
                    <tr>
                      {sambatzProfiles.map((p) => {
                        const color = colorAssignments.get(p.id);
                        return (
                          <th
                            key={p.id}
                            className="min-w-24 border-b border-s border-border/60 bg-card px-2 py-2 text-center font-medium tracking-wide uppercase glow-text"
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
                        sambatzProfiles.map((p) => p.id)
                      );
                      return personGrid.map((row, hour) => (
                        <tr key={`${iso}-people-${hour}`}>
                          {sambatzProfiles.map((p) => {
                            const onShift = row[p.id];
                            const atHome = isOnTimeOff(timeOffIndex, p.id, iso);
                            // Home but still on shift is a real scheduling
                            // conflict (allowed, but should be unmistakable
                            // at a glance) — stripe the two states together
                            // instead of picking one silently.
                            const conflict = !!onShift && atHome;
                            const color = colorAssignments.get(p.id);
                            const cellStyle: React.CSSProperties = conflict
                              ? {
                                  backgroundImage: `repeating-linear-gradient(45deg, ${color?.hex}88 0px, ${color?.hex}88 6px, ${TIME_OFF_COLOR} 6px, ${TIME_OFF_COLOR} 12px)`,
                                  border: "2px solid var(--destructive)",
                                  boxShadow: color ? `0 0 6px ${color.hex}` : undefined,
                                }
                              : onShift
                                ? { backgroundColor: `${color?.hex}55` }
                                : atHome
                                  ? { backgroundColor: TIME_OFF_COLOR }
                                  : {};
                            return (
                              <td
                                key={p.id}
                                className="border-b border-s border-border/60 px-2 py-1.5 text-center font-mono"
                                style={cellStyle}
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
