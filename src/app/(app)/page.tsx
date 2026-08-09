"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addDays, formatDayLabel, formatTime, formatWeekRange, startOfWeek, toISODate, weekDays } from "@/lib/dates";
import type { Profile, Shift } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShiftDialog } from "@/components/shift-dialog";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

export default function SchedulePage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [newShiftDate, setNewShiftDate] = useState(new Date());

  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const from = toISODate(weekStart);
    const to = toISODate(addDays(weekStart, 6));

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
  }, [weekStart]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  function openNewShift(date: Date) {
    setEditingShift(null);
    setNewShiftDate(date);
    setDialogOpen(true);
  }

  function openEditShift(shift: Shift) {
    setEditingShift(shift);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <h1 className="min-w-[180px] text-center text-lg font-semibold">
            {formatWeekRange(weekStart)}
          </h1>
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
          This week
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {days.map((day) => {
            const iso = toISODate(day);
            const dayShifts = shifts.filter((s) => s.shift_date === iso);
            return (
              <Card key={iso}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">{formatDayLabel(day)}</CardTitle>
                  <Button variant="ghost" size="icon" onClick={() => openNewShift(day)}>
                    <Plus className="size-4" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {dayShifts.length === 0 && (
                    <p className="text-sm text-muted-foreground">No shifts</p>
                  )}
                  {dayShifts.map((shift) => {
                    const assignee = shift.assigned_to ? profileById.get(shift.assigned_to) : null;
                    const isMine = shift.assigned_to === userId;
                    return (
                      <button
                        key={shift.id}
                        onClick={() => openEditShift(shift)}
                        className={`w-full rounded-md border p-2 text-left text-sm transition-colors hover:bg-accent ${
                          isMine ? "border-primary" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
                          </span>
                          {shift.position && <Badge variant="secondary">{shift.position}</Badge>}
                        </div>
                        <div className="text-muted-foreground">
                          {assignee ? assignee.full_name || "Unnamed" : "Unassigned"}
                        </div>
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {userId && (
        <ShiftDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          shift={editingShift}
          defaultDate={newShiftDate}
          profiles={profiles}
          currentUserId={userId}
          onSaved={loadShifts}
        />
      )}
    </div>
  );
}
