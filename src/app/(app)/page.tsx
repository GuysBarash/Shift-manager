"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { addDays, formatDDMMYYYY, formatDow, startOfDay, toISODate } from "@/lib/dates";
import { buildColorAssignments } from "@/lib/person-color";
import { useDemoIdentity } from "@/lib/demo-identity";
import { scheduleRangeDays } from "@/lib/schedule-range";
import {
  buildDateRange,
  isAdmin as selectIsAdmin,
  isOnTimeOffAtHour,
  buildTimeOffIndex,
  sambatzProfiles as selectSambatz,
  TIME_OFF_COLOR,
} from "@/lib/roster";
import { buildDayGrid, buildPersonHourGrid } from "@/lib/shift-grid";
import { buildSlots, planShifts, type PlanResult } from "@/lib/shift-plan";
import { buildAnchorsFromShifts, buildPresenceFromTimeOff } from "@/lib/shift-plan-adapter";
import { BrushToolbar, type Brush } from "@/components/brush-toolbar";
import { FragmentDay } from "@/components/shift-day-rows";
import type { Profile, Shift, TimeOff } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ActivityPanel } from "@/components/activity-panel";
import { FileJson } from "lucide-react";

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
  // A short history of what the board has been PUT THROUGH this session, so a
  // debug export can explain how it got into its current state. One snapshot
  // of the result is not enough - "it filled backwards" only makes sense next
  // to the window and resume points the fill was given.
  type PlanRun = {
    at: string;
    kind: "autofill" | "delete-from-here";
    fromIso: string;
    toIso: string;
    clickedAtMs: number;
    resumeAt: Record<string, number>;
    slots: number;
    result: PlanResult | null;
  };
  const planHistoryRef = useRef<PlanRun[]>([]);
  const rememberRun = (run: PlanRun) => {
    planHistoryRef.current = [...planHistoryRef.current, run].slice(-8);
  };
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

  const isAdmin = selectIsAdmin(profiles, userId);

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

  // Admin-only debug export: the raw shifts for the visible range, plus who
  // is actually present when (sambatz only) — the same presence windows
  // "השלם מכאן" itself plans against, so this is the quickest way to see
  // why the auto-fill did or didn't do something.
  function downloadDebugJson() {
    const presence = buildPresenceFromTimeOff(sambatzProfiles, timeOffIndex, rangeStart, RANGE_DAYS).map(
      (p) => ({
        name: p.name,
        windows: p.windows.map((w) => ({
          from: new Date(w.from).toISOString(),
          until: new Date(w.until).toISOString(),
        })),
      })
    );

    const shiftsOut = shifts.map((s) => ({
      id: s.id,
      shift_date: s.shift_date,
      start_time: s.start_time,
      end_time: s.end_time,
      position: s.position,
      assigned_to: s.assigned_to,
      assigned_to_name: s.assigned_to ? (profileById.get(s.assigned_to)?.full_name ?? null) : null,
      notes: s.notes,
    }));

    // What the planner was ASKED and what it DECIDED, not just the board after
    // the fact. A report of "it filled backwards" is unanswerable without the
    // window, the per-column resume points, and which anchors failed to land
    // on the start grid - so all of that goes in.
    const iso = (ms: number) => new Date(ms).toISOString();
    const gridOf = (col: string, i: number) => {
      const step = 6;                       // shift length; half-shift stagger
      const offset = i * (step / 2);
      return Array.from({ length: 24 / step }, (_, k) =>
        `${String((offset + k * step) % 24).padStart(2, "0")}:00`
      );
    };

    const offGrid = shifts
      .filter((s) => {
        if (!s.position || !s.start_time) return false;
        const i = SHIFT_COLUMNS.indexOf(s.position);
        if (i < 0) return false;
        return !gridOf(s.position, i).includes(s.start_time.slice(0, 5));
      })
      .map((s) => ({
        shift_date: s.shift_date,
        position: s.position,
        start_time: s.start_time,
        end_time: s.end_time,
        who: s.assigned_to ? (profileById.get(s.assigned_to)?.full_name ?? null) : null,
        why: "start time is not on this column's grid, so the planner cannot match it to a slot",
      }));

    const payload = {
      generatedAt: new Date().toISOString(),
      range: { start: toISODate(rangeStart), end: toISODate(addDays(rangeStart, RANGE_DAYS - 1)) },
      columns: SHIFT_COLUMNS,
      startGrid: Object.fromEntries(SHIFT_COLUMNS.map((c, i) => [c, gridOf(c, i)])),
      // Oldest first. Empty means the board was not touched by an auto-fill in
      // this session, so anything odd about it came from somewhere else.
      history: planHistoryRef.current.map((run) => ({
        at: run.at,
        kind: run.kind,
        window: { from: run.fromIso, to: run.toIso },
        clickedAt: iso(run.clickedAtMs),
        resumeAt: Object.fromEntries(
          Object.entries(run.resumeAt).map(([c, ms]) => [c, iso(ms)])
        ),
        slotsConsidered: run.slots,
        rowsWritten: run.result?.rows.length ?? 0,
        unfilled: (run.result?.unfilled ?? []).map((u) => ({
          date: u.dateIso, start: u.startTime, column: u.column,
        })),
        conflicts: run.result?.conflicts ?? [],
        noRest: run.result?.noRest ?? [],
        overRested: run.result?.overRested ?? [],
        adjusted: run.result?.adjusted ?? [],
        load: run.result?.load ?? [],
      })),
      offGridShifts: offGrid,
      shifts: shiftsOut,
      presenceSambatz: presence,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shifts-debug-${toISODate(rangeStart)}.json`;
    a.click();
    URL.revokeObjectURL(url);
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

  // Groundwork for the auto-shift builder: "delete from here" wipes both
  // columns from the clicked point through the end of the visible range in
  // one shot, and "continue from here" is the hook where the (not yet
  // written) auto-fill algorithm will plug in. Both are point actions, not
  // per-cell paints — handlePaintDown only fires them on the initial click
  // and never sets isPaintingRef, so a drag across cells doesn't re-trigger
  // them.
  function deleteFromHere(day: Date, hour: number) {
    const shiftDate = toISODate(day);
    const hourStart = `${String(hour).padStart(2, "0")}:00:00`;

    const toRemove = shiftsRef.current.filter(
      (s) => s.shift_date > shiftDate || (s.shift_date === shiftDate && s.end_time > hourStart)
    );
    if (toRemove.length === 0) return;

    const removeIds = new Set(toRemove.map((s) => s.id));
    applyShifts((prev) => prev.filter((s) => !removeIds.has(s.id)));

    // A shift straddling the cutoff (started before it, would have ended
    // after it) keeps its portion before the cutoff instead of disappearing
    // whole — same split-and-reinsert pattern paintCell uses.
    toRemove.forEach((s) => {
      if (s.shift_date === shiftDate && s.start_time < hourStart) {
        createLocalPiece(s.shift_date, s.position ?? "", s.start_time, hourStart, s.assigned_to, s.notes);
      }
    });

    rememberRun({
      at: new Date().toISOString(),
      kind: "delete-from-here",
      fromIso: shiftDate,
      toIso: toISODate(addDays(rangeStart, RANGE_DAYS - 1)),
      clickedAtMs: new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour).getTime(),
      resumeAt: {},
      slots: toRemove.length,
      result: null,
    });
  }

  // Auto-fill forward from the clicked HOUR, for one month or to the end of
  // the calendar, whichever comes first. Everything already in `shifts`
  // (manual paints or an earlier auto-fill) is passed to the planner as
  // anchors — read for rest-history continuity, never overwritten. Each
  // column resumes from the end of whatever is already booked there, so a
  // hand-painted piece is continued rather than planned around. It used to
  // start at midnight of the clicked day, which wrote shifts BEFORE the cells
  // that had just been painted.
  /**
   * Where each column's chain should pick up from.
   *
   * Walks forward through whatever is already booked in that column, so a
   * hand-painted piece is continued rather than planned around. Without this
   * the fill started at midnight of the clicked day and wrote shifts BEFORE
   * the cells you had just painted.
   */
  function resumePointsPerColumn(fromMs: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const col of SHIFT_COLUMNS) {
      const inCol = shiftsRef.current
        .filter((s) => s.position === col)
        .map((s) => ({
          start: new Date(`${s.shift_date}T${s.start_time}`).getTime(),
          end:
            s.end_time === "23:59:59"
              ? new Date(`${s.shift_date}T00:00:00`).getTime() + 24 * 3600_000
              : new Date(`${s.shift_date}T${s.end_time}`).getTime(),
        }))
        .sort((a, b) => a.start - b.start);
      let t = fromMs;
      let moved = true;
      while (moved) {
        moved = false;
        for (const b of inCol) {
          if (b.start <= t && b.end > t) {
            t = b.end;
            moved = true;
          }
        }
      }
      out[col] = t;
    }
    return out;
  }

  function continueFromHere(day: Date, hour: number) {
    // Start from the hour that was clicked, not midnight, and never before it.
    const fromMs = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour).getTime();
    const resumeAt = resumePointsPerColumn(fromMs);
    const fromIso = toISODate(day);

    // Auto-fill covers ONE MONTH forward, or the end of the calendar if that
    // comes first. Filling the whole horizon in one go made a single click
    // rewrite months of schedule.
    const monthOut = new Date(day.getFullYear(), day.getMonth() + 1, day.getDate());
    const calendarEnd = addDays(rangeStart, RANGE_DAYS - 1);
    const toIso = toISODate(monthOut < calendarEnd ? monthOut : calendarEnd);
    try {
      const people = buildPresenceFromTimeOff(sambatzProfiles, timeOffIndex, rangeStart, RANGE_DAYS);
      const anchors = buildAnchorsFromShifts(shiftsRef.current, profileById);
      const slots = buildSlots(fromIso, toIso, { columns: SHIFT_COLUMNS, resumeAt });
      const result = planShifts(people, slots, anchors, { columns: SHIFT_COLUMNS, fromDate: fromIso });
      rememberRun({
        at: new Date().toISOString(),
        kind: "autofill",
        fromIso, toIso,
        clickedAtMs: fromMs,
        resumeAt,
        slots: slots.length,
        result,
      });

      const profileByName = new Map(sambatzProfiles.map((p) => [(p.full_name ?? "").trim(), p]));
      let created = 0;
      for (const row of result.rows) {
        const profile = profileByName.get(row.person);
        if (!profile) continue;
        createLocalPiece(row.shift_date, row.position, row.start_time, row.end_time, profile.id, null);
        created++;
      }

      // Surface what the planner actually optimises for, not just the count.
      // noRest is the one to watch: a shift, one shift off, a shift again.
      // overRested is somebody left idle past the ceiling, and adjusted are
      // the 5h/7h shifts that walk a column back onto the start grid.
      const parts = [`מולאו ${created} משמרות`];
      if (result.unfilled.length > 0) parts.push(`${result.unfilled.length} משבצות לא אוישו`);
      if (result.conflicts.length > 0) parts.push(`${result.conflicts.length} התנגשויות`);
      if (result.noRest.length > 0) parts.push(`${result.noRest.length} ללא מנוחה`);
      if (result.overRested.length > 0) parts.push(`${result.overRested.length} מנוחה ארוכה מדי`);
      if (result.adjusted.length > 0) parts.push(`${result.adjusted.length} משמרות מותאמות`);
      const bad = result.conflicts.length > 0 || result.overRested.length > 0;
      toast[bad ? "warning" : "success"](parts.join(" · "));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה במילוי האוטומטי.");
    }
  }

  function handlePaintDown(day: Date, hour: number, col: string) {
    if (!brush || !editMode) return;
    if (brush === "delete-from-here") {
      deleteFromHere(day, hour);
      return;
    }
    if (brush === "continue-from-here") {
      continueFromHere(day, hour);
      return;
    }
    isPaintingRef.current = true;
    paintCell(day, hour, col);
  }

  function handlePaintEnter(day: Date, hour: number, col: string) {
    if (!brush || !editMode || !isPaintingRef.current) return;
    paintCell(day, hour, col);
  }

  return (
    <div className="space-y-2 sm:space-y-4">
      <div className="flex items-start justify-between">
        <h1 className="text-base font-semibold tracking-wide glow-text sm:text-lg">
          לוח משמרות{" "}
          <span className="hidden text-muted-foreground sm:inline">
            — החל מ{formatDow(rangeStart)} {formatDDMMYYYY(rangeStart)}
          </span>
        </h1>
        <div className="flex flex-col items-end gap-2">
          <ActivityPanel profiles={profiles} />
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={downloadDebugJson}>
              <FileJson className="size-4" />
              הורדת JSON (דיבוג)
            </Button>
          )}
        </div>
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
            {/* One table, not two side by side — the extended per-person
                columns are appended to the SAME <tr> as the hour/shift cells
                (via FragmentDay's renderExtraCells) instead of living in a
                second independent <table>. Two separate tables can never be
                guaranteed pixel-identical row heights (sub-pixel rounding
                differences between them compound over hundreds of rows,
                visibly drifting by the bottom of the range) — one table
                can't drift from itself. */}
            <table className="border-collapse text-sm select-none">
              <thead className="sticky top-0 z-20 bg-card">
                <tr>
                  <th className="sticky start-0 z-30 h-9 w-20 min-w-20 max-w-20 border-b border-border/60 bg-card px-1.5 py-2 text-start text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    תאריך
                  </th>
                  <th className="sticky start-20 z-30 h-9 w-16 min-w-16 max-w-16 border-b border-s border-border/60 bg-card px-1.5 py-2 text-start text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    שעה
                  </th>
                  {SHIFT_COLUMNS.map((col) => (
                    <th
                      key={col}
                      className="h-9 min-w-32 truncate border-b border-s border-border/60 bg-card px-3 py-2 text-start font-medium tracking-wide text-primary uppercase glow-text"
                    >
                      {col}
                    </th>
                  ))}
                  {extended &&
                    sambatzProfiles.map((p) => {
                      const color = colorAssignments.get(p.id);
                      return (
                        <th
                          key={p.id}
                          className="h-9 min-w-24 truncate border-b border-s border-border/60 bg-card px-2 py-2 text-center font-medium tracking-wide uppercase glow-text"
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
                  const dayShifts = shiftsByDay.get(iso) ?? [];
                  const dayGrid = buildDayGrid(dayShifts, SHIFT_COLUMNS);
                  const personGrid = extended
                    ? buildPersonHourGrid(dayShifts, sambatzProfiles.map((p) => p.id))
                    : null;
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
                      timeOffIndex={timeOffIndex}
                      userId={userId}
                      brushActive={!!brush}
                      onPaintDown={(hour, col) => handlePaintDown(day, hour, col)}
                      onPaintEnter={(hour, col) => handlePaintEnter(day, hour, col)}
                      renderExtraCells={
                        extended && personGrid
                          ? (hour) =>
                              sambatzProfiles.map((p) => {
                                const onShift = personGrid[hour][p.id];
                                const atHome = isOnTimeOffAtHour(timeOffIndex, p.id, iso, hour);
                                // Home but still on shift is a real
                                // scheduling conflict (allowed, but should
                                // be unmistakable at a glance) — stripe the
                                // two states together instead of picking
                                // one silently.
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
                                    className="h-8 border-b border-s border-border/60 px-2 py-1.5 text-center font-mono"
                                    style={cellStyle}
                                  >
                                    {" "}
                                  </td>
                                );
                              })
                          : undefined
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
