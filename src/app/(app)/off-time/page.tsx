"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { addDays, formatDDMMYYYY, formatDowShort, parseISODate, startOfDay, toISODate } from "@/lib/dates";
import { ISRAELI_HOLIDAYS } from "@/lib/holidays";
import { useDemoIdentity } from "@/lib/demo-identity";
import { buildColorAssignments } from "@/lib/person-color";
import type { TimeOff, Profile } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2 } from "lucide-react";

const RANGE_DAYS = 120;
const TIME_OFF_COLOR = "rgba(148, 163, 184, 0.35)";

export default function OffTimePage() {
  const { identity } = useDemoIdentity();
  const userId = identity.userId;
  const [entries, setEntries] = useState<TimeOff[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewAll, setViewAll] = useState(true);

  const [startDate, setStartDate] = useState(toISODate(new Date()));
  const [endDate, setEndDate] = useState(toISODate(new Date()));

  const rangeStart = useMemo(() => startOfDay(new Date()), []);
  const todayIso = useMemo(() => toISODate(rangeStart), [rangeStart]);
  const days = useMemo(
    () => Array.from({ length: RANGE_DAYS }, (_, i) => addDays(rangeStart, i)),
    [rangeStart]
  );

  // Only Sambatz actually get scheduled, so only they're meaningful here —
  // same scoping as the paint palette on the shifts page.
  const sambatzProfiles = useMemo(() => profiles.filter((p) => p.sambatz), [profiles]);
  const isSambatz = sambatzProfiles.some((p) => p.id === userId);
  const visibleProfiles = viewAll ? sambatzProfiles : sambatzProfiles.filter((p) => p.id === userId);

  const colorAssignments = useMemo(() => buildColorAssignments(profiles), [profiles]);

  const entriesByPerson = useMemo(() => {
    const map = new Map<string, TimeOff[]>();
    entries.forEach((t) => {
      const list = map.get(t.user_id) ?? [];
      list.push(t);
      map.set(t.user_id, list);
    });
    return map;
  }, [entries]);

  function isOff(personId: string, dateIso: string): boolean {
    const list = entriesByPerson.get(personId);
    if (!list) return false;
    return list.some((t) => t.start_date <= dateIso && dateIso <= t.end_date);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const from = toISODate(rangeStart);
    const to = toISODate(addDays(rangeStart, RANGE_DAYS - 1));
    const [{ data: timeOffRows, error: timeOffError }, { data: profileRows }] = await Promise.all([
      supabase.from("time_off").select("*").lte("start_date", to).gte("end_date", from),
      supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    ]);
    if (timeOffError) console.error(timeOffError);
    setEntries(timeOffRows ?? []);
    setProfiles(profileRows ?? []);
    setLoading(false);
  }, [rangeStart]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (endDate < startDate) {
      toast.error("תאריך הסיום חייב להיות שווה או מאוחר מתאריך ההתחלה.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("time_off").insert({
      user_id: userId,
      start_date: startDate,
      end_date: endDate,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("נוסף.");
    load();
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("time_off").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    load();
  }

  const myEntries = entries
    .filter((e) => e.user_id === userId)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  return (
    <div className="space-y-2 sm:space-y-4">
      <h1 className="text-base font-semibold tracking-wide glow-text sm:text-lg">לוח חופש</h1>

      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={viewAll} onCheckedChange={setViewAll} />
          {viewAll ? "מציג את כולם" : "מציג רק אותי"}
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">טוען…</p>
      ) : sambatzProfiles.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          אין עדיין סמבצניקים.
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-md border border-border/60 glow-border sm:max-h-[70vh]">
          <table className="border-collapse text-sm select-none">
            <thead className="sticky top-0 z-20 bg-card">
              <tr>
                <th className="sticky start-0 z-30 w-16 min-w-16 max-w-16 border-b border-border/60 bg-card px-1.5 py-2 text-start text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  תאריך
                </th>
                {visibleProfiles.map((p) => {
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
                const isShabbat = day.getDay() === 6;
                const isToday = iso === todayIso;
                const holiday = ISRAELI_HOLIDAYS[iso];
                return (
                  <tr key={iso} id={`offrow-${iso}`}>
                    <td
                      className={`sticky start-0 z-10 w-16 min-w-16 max-w-16 border-b border-e border-border/60 bg-secondary/40 px-1 py-1.5 align-top font-mono leading-tight ${
                        isShabbat || holiday ? "text-primary glow-text" : "text-secondary-foreground"
                      }`}
                    >
                      <div className={`text-xs font-bold ${isToday ? "text-primary glow-text" : ""}`}>
                        {formatDowShort(day)}
                      </div>
                      <div className="text-[10px]">{formatDDMMYYYY(day)}</div>
                      {isToday && <div className="text-[9px] text-primary glow-text">היום</div>}
                      {holiday && <div className="text-[9px]">{holiday}</div>}
                    </td>
                    {visibleProfiles.map((p) => {
                      const off = isOff(p.id, iso);
                      const color = colorAssignments.get(p.id);
                      return (
                        <td
                          key={p.id}
                          className={`border-b border-s border-border/60 px-2 py-1.5 text-center ${
                            isShabbat || holiday ? "bg-secondary/20" : ""
                          }`}
                          style={
                            off
                              ? { backgroundColor: TIME_OFF_COLOR }
                              : {
                                  backgroundColor: `${color?.hex}33`,
                                  borderInlineStart: `3px solid ${color?.hex}`,
                                }
                          }
                        >
                          {!off && (
                            <span
                              className="inline-block size-2.5 rounded-full"
                              style={{ backgroundColor: color?.hex, boxShadow: color ? `0 0 6px ${color.hex}` : undefined }}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isSambatz && (
        <Card>
          <CardHeader>
            <CardTitle className="tracking-wide glow-text">סימון חופש</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-3 sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="start">מתאריך</Label>
                <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end">עד תאריך</Label>
                <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? "מוסיף..." : "הוספה"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isSambatz && myEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="tracking-wide glow-text">התאריכים שלי</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {myEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-md border border-border/60 p-2 text-sm"
              >
                <span className="text-muted-foreground">
                  {formatDDMMYYYY(parseISODate(entry.start_date))} ← {formatDDMMYYYY(parseISODate(entry.end_date))}
                </span>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(entry.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
