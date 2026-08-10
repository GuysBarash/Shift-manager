"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { toISODate } from "@/lib/dates";
import { personColor } from "@/lib/person-color";
import type { TimeOff, Profile } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2 } from "lucide-react";

export default function OffTimePage() {
  const [entries, setEntries] = useState<TimeOff[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [startDate, setStartDate] = useState(toISODate(new Date()));
  const [endDate, setEndDate] = useState(toISODate(new Date()));

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const today = toISODate(new Date());
    const [{ data: userData }, { data: timeOffRows, error: timeOffError }, { data: profileRows }] =
      await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("time_off")
          .select("*")
          .gte("end_date", today)
          .order("start_date", { ascending: true }),
        supabase.from("profiles").select("*"),
      ]);
    if (timeOffError) console.error(timeOffError);
    setUserId(userData.user?.id ?? null);
    setEntries(timeOffRows ?? []);
    setProfiles(profileRows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
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

  return (
    <div className="space-y-6">
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

      <Card>
        <CardHeader>
          <CardTitle className="tracking-wide glow-text">לא זמינים למשמרות</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <p className="text-sm text-muted-foreground">טוען…</p>}
          {!loading && entries.length === 0 && (
            <p className="text-sm text-muted-foreground">אף אחד לא סימן חופש.</p>
          )}
          {entries.map((entry) => {
            const person = profileById.get(entry.user_id);
            const color = personColor(entry.user_id, person?.color);
            return (
              <div key={entry.id} className="flex items-center justify-between rounded-md border border-border/60 p-2 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color?.hex, boxShadow: color ? `0 0 6px ${color.hex}` : undefined }}
                  />
                  <span className="font-medium">{person?.full_name || "ללא שם"}</span>
                  <span className="text-muted-foreground">
                    {entry.start_date} ← {entry.end_date}
                  </span>
                </div>
                {entry.user_id === userId && (
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(entry.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
