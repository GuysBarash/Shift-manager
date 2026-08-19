"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { addDays, formatDDMMYYYY, formatDowShort, startOfDay, toISODate } from "@/lib/dates";
import { ISRAELI_HOLIDAYS } from "@/lib/holidays";
import { useDemoIdentity } from "@/lib/demo-identity";
import { buildColorAssignments } from "@/lib/person-color";
import { scheduleRangeDays } from "@/lib/schedule-range";
import { applyOffTimeImport, parseOffTimeWorkbook } from "@/lib/offtime-import";
import {
  buildDateRange,
  buildTimeOffIndex,
  isAdmin as selectIsAdmin,
  isOnTimeOff,
  isSambatz as selectIsSambatz,
  sambatzProfiles as selectSambatz,
  TIME_OFF_COLOR,
} from "@/lib/roster";
import type { TimeOff, Profile } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload } from "lucide-react";

export default function OffTimePage() {
  const { identity } = useDemoIdentity();
  const userId = identity.userId;
  const [entries, setEntries] = useState<TimeOff[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewAll, setViewAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = selectIsAdmin(profiles, userId);

  const rangeStart = useMemo(() => startOfDay(new Date()), []);
  const todayIso = useMemo(() => toISODate(rangeStart), [rangeStart]);
  const RANGE_DAYS = useMemo(() => scheduleRangeDays(rangeStart), [rangeStart]);
  const days = useMemo(() => buildDateRange(rangeStart, RANGE_DAYS), [rangeStart, RANGE_DAYS]);

  // Only Sambatz actually get scheduled, so only they're meaningful here —
  // same scoping as the paint palette on the shifts page.
  const sambatzProfiles = useMemo(() => selectSambatz(profiles), [profiles]);
  const isSambatz = selectIsSambatz(profiles, userId);
  // "Just me" has nothing to show for someone with no column of their own —
  // force "everyone" for them regardless of the (hidden, in that case)
  // toggle state, so there's no empty-looking table.
  const effectiveViewAll = isSambatz ? viewAll : true;
  const visibleProfiles = effectiveViewAll ? sambatzProfiles : sambatzProfiles.filter((p) => p.id === userId);

  const colorAssignments = useMemo(() => buildColorAssignments(profiles), [profiles]);

  const timeOffIndex = useMemo(() => buildTimeOffIndex(entries), [entries]);

  // Only shown collapsed to "just me" — a headcount is more useful than a
  // wall of columns once you're not comparing everyone side by side.
  function atBaseCount(dateIso: string): number {
    return sambatzProfiles.reduce((count, p) => count + (isOnTimeOff(timeOffIndex, p.id, dateIso) ? 0 : 1), 0);
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

  async function handleImportFile(file: File) {
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const extraction = parseOffTimeWorkbook(buffer);
      const result = await applyOffTimeImport(extraction, profiles);
      if (result.skipped.length > 0) {
        toast.warning(`דולג על ${result.skipped.length} שמות שלא נמצאו: ${result.skipped.join(", ")}`);
      }
      toast.success(`הלוח עודכן: ${result.matchedCount} אנשים, ${result.insertedCount} טווחים.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה בייבוא הקובץ.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function scrollToNow() {
    document.getElementById(`offrow-${todayIso}`)?.scrollIntoView({ behavior: "auto", block: "center" });
  }

  return (
    <div className="space-y-2 sm:space-y-4">
      <h1 className="text-base font-semibold tracking-wide glow-text sm:text-lg">לוח חופש</h1>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm tracking-wide glow-text">ייבוא לוח חופש</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4" />
              {importing ? "מעדכן..." : "העלאת קובץ גאנט (.xlsx)"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              מחליף לגמרי את לוח החופש עבור כל אדם שנמצא בקובץ, לפי השם המלא. אנשים שלא נמצאים
              בקובץ לא ישתנו.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
        <Button variant="outline" size="sm" onClick={scrollToNow}>
          עכשיו!
        </Button>
        {isSambatz && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={viewAll} onCheckedChange={setViewAll} />
            {viewAll ? "מציג את כולם" : "מציג רק אותי"}
          </label>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">טוען…</p>
      ) : sambatzProfiles.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          אין עדיין סמבצניקים.
        </div>
      ) : (
        <div className="max-h-[68vh] overflow-auto rounded-md border border-border/60 glow-border sm:max-h-[75vh]">
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
                {!effectiveViewAll && (
                  <th className="min-w-24 border-b border-s border-border/60 bg-card px-2 py-2 text-center font-medium tracking-wide text-muted-foreground uppercase">
                    סמבצים
                  </th>
                )}
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
                      className={`sticky start-0 z-10 w-16 min-w-16 max-w-16 border-b border-e border-border/60 bg-secondary px-1 py-1.5 align-top font-mono leading-tight ${
                        isToday || isShabbat || holiday ? "text-primary glow-text" : "text-secondary-foreground"
                      }`}
                    >
                      <div className="text-xs font-bold">
                        {formatDowShort(day)}
                        {holiday && ` (${holiday})`}
                      </div>
                      <div className="text-[10px]">{formatDDMMYYYY(day)}</div>
                      {isToday && <div className="text-[9px] text-primary glow-text">היום</div>}
                    </td>
                    {visibleProfiles.map((p) => {
                      const off = isOnTimeOff(timeOffIndex, p.id, iso);
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
                    {!effectiveViewAll && (
                      <td
                        className={`border-b border-s border-border/60 px-2 py-1.5 text-center font-mono ${
                          isShabbat || holiday ? "bg-secondary/20" : ""
                        }`}
                      >
                        {atBaseCount(iso)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
