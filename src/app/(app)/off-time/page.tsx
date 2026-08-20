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
  officerProfiles as selectOfficers,
  sambatzProfiles as selectSambatz,
  TIME_OFF_COLOR,
} from "@/lib/roster";
import type { TimeOff, Profile } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "sambatz" | "officers";

export default function OffTimePage() {
  const { identity } = useDemoIdentity();
  const userId = identity.userId;
  const [entries, setEntries] = useState<TimeOff[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewAll, setViewAll] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = selectIsAdmin(profiles, userId);
  const isSambatz = selectIsSambatz(profiles, userId);

  // Defaults to whichever group the logged-in person belongs to, but only
  // once (the first time profiles load) — switching the tab afterward must
  // stick, not get reset back on every re-render.
  useEffect(() => {
    if (mode === null && profiles.length > 0) {
      setMode(isSambatz ? "sambatz" : "officers");
    }
  }, [mode, profiles, isSambatz]);
  const effectiveMode: Mode = mode ?? "sambatz";

  const rangeStart = useMemo(() => startOfDay(new Date()), []);
  const todayIso = useMemo(() => toISODate(rangeStart), [rangeStart]);
  const RANGE_DAYS = useMemo(() => scheduleRangeDays(rangeStart), [rangeStart]);
  const days = useMemo(() => buildDateRange(rangeStart, RANGE_DAYS), [rangeStart, RANGE_DAYS]);

  const sambatzProfiles = useMemo(() => selectSambatz(profiles), [profiles]);
  const officerProfiles = useMemo(() => selectOfficers(profiles), [profiles]);
  const groupProfiles = effectiveMode === "sambatz" ? sambatzProfiles : officerProfiles;
  const groupLabel = effectiveMode === "sambatz" ? "סמבצים" : "קצינים";

  // "Just me" is allowed even when the current tab isn't the viewer's own
  // group — it should just come up empty (no column for them here), not be
  // forced back to "everyone" or break.
  const visibleProfiles = viewAll ? groupProfiles : groupProfiles.filter((p) => p.id === userId);

  const colorAssignments = useMemo(() => buildColorAssignments(profiles), [profiles]);

  const timeOffIndex = useMemo(() => buildTimeOffIndex(entries), [entries]);

  // Only shown collapsed to "just me" — a headcount is more useful than a
  // wall of columns once you're not comparing everyone side by side.
  function atBaseCount(dateIso: string): number {
    return groupProfiles.reduce((count, p) => count + (isOnTimeOff(timeOffIndex, p.id, dateIso) ? 0 : 1), 0);
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
        <div className="flex rounded-md border border-border/60 p-0.5">
          {(["sambatz", "officers"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-[5px] px-3 py-1.5 text-sm font-medium tracking-wide uppercase transition-colors",
                effectiveMode === m
                  ? "glow-text bg-accent text-primary"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              {m === "sambatz" ? "סמבצים" : "קצינים"}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={scrollToNow}>
          עכשיו!
        </Button>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={viewAll} onCheckedChange={setViewAll} />
          {viewAll ? "מציג את כולם" : "מציג רק אותי"}
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">טוען…</p>
      ) : groupProfiles.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          {effectiveMode === "sambatz" ? "אין עדיין סמבצניקים." : "אין עדיין קצינים."}
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
                {!viewAll && (
                  <th className="min-w-24 border-b border-s border-border/60 bg-card px-2 py-2 text-center font-medium tracking-wide text-muted-foreground uppercase">
                    {groupLabel}
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
                    {!viewAll && (
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
