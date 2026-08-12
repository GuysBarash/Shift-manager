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
import { buildColorAssignments } from "@/lib/person-color";
import { useDemoIdentity } from "@/lib/demo-identity";
import { SCHEDULE_RANGE_DAYS } from "@/lib/schedule-range";
import type { Profile, Shift, TimeOff } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ActivityPanel } from "@/components/activity-panel";
import { ChevronDown, Eraser } from "lucide-react";

const RANGE_DAYS = SCHEDULE_RANGE_DAYS;
const TIME_OFF_COLOR = "rgba(148, 163, 184, 0.35)";
// Two fixed slots per hour rather than positions derived from existing
// shifts — that made an empty board a dead end (no columns meant nowhere to
// paint a first shift).
const SHIFT_COLUMNS = ["משמרת א׳", "משמרת ב׳"];

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
  const days = useMemo(
    () => Array.from({ length: RANGE_DAYS }, (_, i) => addDays(rangeStart, i)),
    [rangeStart]
  );

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  // Only Sambatz can actually be assigned to shifts — the paint palette and
  // the per-person extended table are scoped to them.
  const sambatzProfiles = useMemo(() => profiles.filter((p) => p.sambatz), [profiles]);

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
                            const atHome = isOnTimeOff(p.id, iso);
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
                                {" "}
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
  colorAssignments,
  brush,
  onSelect,
  editMode,
  onToggleEditMode,
  onSave,
  onDiscard,
  saving,
}: {
  profiles: Profile[];
  colorAssignments: Map<string, { name: string; hex: string }>;
  brush: Brush;
  onSelect: (b: Brush) => void;
  editMode: boolean;
  onToggleEditMode: (on: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);

  const selectedProfile = brush && brush !== "erase" ? (profiles.find((p) => p.id === brush) ?? null) : null;
  const selectedColor = selectedProfile ? colorAssignments.get(selectedProfile.id) : null;

  function EraseButton() {
    return (
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
    );
  }

  function EditModeControls() {
    return (
      <>
        <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <Switch checked={editMode} onCheckedChange={onToggleEditMode} />
          מצב עריכה
        </label>
        {editMode && (
          <div className="flex gap-1 px-1">
            <Button size="sm" onClick={onSave} disabled={saving} className="flex-1">
              {saving ? "שומר..." : "שמור"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDiscard} disabled={saving} className="flex-1">
              התעלם
            </Button>
          </div>
        )}
      </>
    );
  }

  function PersonButtons() {
    return (
      <>
        {profiles.map((p) => {
          const color = colorAssignments.get(p.id);
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
      </>
    );
  }

  return (
    <>
      {/* Mobile: frozen, collapsible bar above the table */}
      <div className="sticky top-0 z-40 rounded-md border border-border/60 bg-card shadow-sm md:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2"
        >
          <span className="flex items-center gap-2 text-xs">
            {brush === "erase" ? (
              <>
                <Eraser className="size-3.5 text-destructive" />
                <span className="text-destructive">מחיקה</span>
              </>
            ) : selectedProfile ? (
              <>
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor: selectedColor?.hex,
                    boxShadow: selectedColor ? `0 0 6px ${selectedColor.hex}` : undefined,
                  }}
                />
                <span style={{ color: selectedColor?.hex }}>{selectedProfile.full_name || "?"}</span>
              </>
            ) : (
              <span className="text-muted-foreground">מברשת: בחר צבע</span>
            )}
          </span>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <div className="border-t border-border/60 p-2">
            <div className="mb-1 flex flex-col gap-1 border-b border-border/60 pb-2">
              <EditModeControls />
            </div>
            <div className="flex flex-wrap gap-1">
              <EraseButton />
              <PersonButtons />
            </div>
          </div>
        )}
      </div>

      {/* Desktop: vertical sidebar next to the table */}
      <div className="sticky top-4 hidden shrink-0 flex-col gap-1 self-start rounded-md border border-border/60 bg-card p-2 md:flex">
        <EditModeControls />
        <div className="my-1 h-px bg-border/60" />
        <EraseButton />
        <div className="my-1 h-px bg-border/60" />
        <PersonButtons />
      </div>
    </>
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
  colorAssignments,
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
  colorAssignments: Map<string, { name: string; hex: string }>;
  userId: string;
  brushActive: boolean;
  onPaintDown: (hour: number, col: string) => void;
  onPaintEnter: (hour: number, col: string) => void;
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
              className={`sticky start-14 z-10 w-16 min-w-16 max-w-16 border-b border-border/60 bg-card px-1 py-1.5 font-mono text-xs leading-tight whitespace-nowrap ${
                isNowRow ? "text-primary glow-text font-bold" : "text-muted-foreground"
              }`}
            >
              {formatHourLabel(hour)}
              {isNowRow && <span className="animate-pulse">◄</span>}
            </td>
            {columns.map((col) => {
              const shift = row[col];
              const assignee = shift?.assigned_to ? profileById.get(shift.assigned_to) : null;
              const color = shift?.assigned_to ? colorAssignments.get(shift.assigned_to) : null;
              const isMine = shift?.assigned_to === userId;

              return (
                <td
                  key={col}
                  onMouseDown={() => onPaintDown(hour, col)}
                  onMouseEnter={() => onPaintEnter(hour, col)}
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
                  {shift && assignee ? (
                    <span
                      className="font-medium"
                      style={{ color: color?.hex, textShadow: color ? `0 0 6px ${color.hex}66` : undefined }}
                    >
                      {assignee.full_name}
                    </span>
                  ) : (
                    // A truly empty cell (no text node at all) collapses its
                    // line-box height, making this row shorter than rows with
                    // a real name — the exact bug that misaligned the
                    // extended table before. An invisible non-breaking space
                    // keeps the cell visually empty while holding the height.
                    <span aria-hidden="true">{" "}</span>
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
