"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addDays,
  formatDDMMYYYY,
  formatDow,
  formatHourLabel,
  startOfDay,
  toISODate,
} from "@/lib/dates";
import { personColor } from "@/lib/person-color";
import type { Profile, Shift } from "@/types/database";
import { Button } from "@/components/ui/button";
import { ShiftDialog } from "@/components/shift-dialog";
import { ActivityPanel } from "@/components/activity-panel";
import { Plus } from "lucide-react";

const RANGE_DAYS = 7;

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

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [newShiftDate, setNewShiftDate] = useState(new Date());
  const [newShiftStartTime, setNewShiftStartTime] = useState("09:00");
  const [newShiftPosition, setNewShiftPosition] = useState("");

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

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const from = toISODate(rangeStart);
    const to = toISODate(addDays(rangeStart, RANGE_DAYS - 1));

    const [{ data: shiftRows, error: shiftError }, { data: profileRows, error: profileError }] =
      await Promise.all([
        supabase
          .from("shifts")
          .select("*")
          .gte("shift_date", from)
          .lte("shift_date", to)
          .order("start_time", { ascending: true }),
        supabase.from("profiles").select("*").order("full_name", { ascending: true }),
      ]);

    if (shiftError) console.error(shiftError);
    if (profileError) console.error(profileError);

    setShifts(shiftRows ?? []);
    setProfiles(profileRows ?? []);
    setLoading(false);
  }, [rangeStart]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const todayIso = toISODate(now);
  const currentHour = now.getHours();

  function openNewShift(date: Date, hour: number, position: string) {
    setEditingShift(null);
    setNewShiftDate(date);
    setNewShiftStartTime(`${String(hour).padStart(2, "0")}:00`);
    setNewShiftPosition(position);
    setDialogOpen(true);
  }

  function openEditShift(shift: Shift) {
    setEditingShift(shift);
    setDialogOpen(true);
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
        <div className="flex items-center gap-2">
          <ActivityPanel profiles={profiles} />
          <Button
            size="sm"
            onClick={() => openNewShift(new Date(), currentHour, columns[0] ?? "")}
          >
            <Plus className="size-4" />
            משמרת חדשה
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">טוען…</p>
      ) : columns.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          עדיין אין משמרות בלוח. לחצו על &quot;משמרת חדשה&quot; כדי להוסיף את הראשונה.
        </div>
      ) : (
        <div className="max-h-[75vh] overflow-auto rounded-md border border-border/60 glow-border">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-20 bg-card">
              <tr>
                <th className="sticky start-0 z-30 w-28 min-w-28 border-b border-border/60 bg-card px-3 py-2 text-start font-medium tracking-wide text-muted-foreground uppercase">
                  תאריך
                </th>
                <th className="sticky start-28 z-30 min-w-20 border-b border-s border-border/60 bg-card px-3 py-2 text-start font-medium tracking-wide text-muted-foreground uppercase">
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
                    onCellClick={(hour, col, shift) =>
                      shift ? openEditShift(shift) : openNewShift(day, hour, col)
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {userId && (
        <ShiftDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          shift={editingShift}
          defaultDate={newShiftDate}
          defaultStartTime={newShiftStartTime}
          defaultPosition={newShiftPosition}
          profiles={profiles}
          currentUserId={userId}
          onSaved={load}
        />
      )}
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
  onCellClick,
}: {
  iso: string;
  day: Date;
  dayGrid: Record<string, Shift | null>[];
  columns: string[];
  isToday: boolean;
  currentHour: number;
  profileById: Map<string, Profile>;
  userId: string | null;
  onCellClick: (hour: number, col: string, shift: Shift | null) => void;
}) {
  return (
    <>
      {dayGrid.map((row, hour) => {
        const isNowRow = isToday && hour === currentHour;
        return (
          <tr key={`${iso}-${hour}`}>
            {hour === 0 && (
              <td
                rowSpan={24}
                className={`sticky start-0 z-10 border-b border-e border-border/60 bg-secondary/40 px-3 py-1.5 align-top font-mono text-xs ${
                  isToday ? "text-primary glow-text" : "text-secondary-foreground"
                }`}
              >
                <div className="font-bold tracking-widest">{formatDow(day)}</div>
                <div>{formatDDMMYYYY(day)}</div>
                {isToday && <div className="mt-1 text-primary glow-text">· היום</div>}
              </td>
            )}
            <td
              className={`sticky start-28 z-10 border-b border-border/60 bg-card px-3 py-1.5 font-mono text-xs ${
                isNowRow ? "text-primary glow-text font-bold" : "text-muted-foreground"
              }`}
            >
              {formatHourLabel(hour)}
              {isNowRow && <span className="ms-1.5 animate-pulse">◄ עכשיו</span>}
            </td>
            {columns.map((col) => {
              const shift = row[col];
              const assignee = shift?.assigned_to ? profileById.get(shift.assigned_to) : null;
              const color = shift?.assigned_to ? personColor(shift.assigned_to, assignee?.color) : null;
              const isMine = shift?.assigned_to === userId;

              return (
                <td
                  key={col}
                  onClick={() => onCellClick(hour, col, shift)}
                  className={`cursor-pointer border-b border-s border-border/60 px-3 py-1.5 transition-colors hover:brightness-125 ${
                    isNowRow && !shift ? "bg-primary/10" : ""
                  } ${isMine ? "ring-1 ring-inset ring-primary/50" : ""}`}
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
