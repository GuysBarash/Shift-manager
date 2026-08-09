"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { toISODate } from "@/lib/dates";
import type { Availability, Profile } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2 } from "lucide-react";

export default function AvailabilityPage() {
  const [entries, setEntries] = useState<Availability[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [startDate, setStartDate] = useState(toISODate(new Date()));
  const [endDate, setEndDate] = useState(toISODate(new Date()));
  const [reason, setReason] = useState("");

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const today = toISODate(new Date());
    const [{ data: userData }, { data: availRows, error: availError }, { data: profileRows }] =
      await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("availability")
          .select("*")
          .gte("end_date", today)
          .order("start_date", { ascending: true }),
        supabase.from("profiles").select("*"),
      ]);
    if (availError) console.error(availError);
    setUserId(userData.user?.id ?? null);
    setEntries(availRows ?? []);
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
      toast.error("End date must be on or after the start date.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability").insert({
      user_id: userId,
      start_date: startDate,
      end_date: endDate,
      reason: reason || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Added.");
    setReason("");
    load();
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("availability").delete().eq("id", id);
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
          <CardTitle>Mark yourself unavailable</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="start">From</Label>
              <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">To</Label>
              <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vacation, sick, etc." />
            </div>
            <Button type="submit" disabled={saving} className="sm:col-span-4">
              {saving ? "Adding..." : "Add"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming unavailability</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && entries.length === 0 && (
            <p className="text-sm text-muted-foreground">Nobody has marked time off.</p>
          )}
          {entries.map((entry) => {
            const person = profileById.get(entry.user_id);
            return (
              <div key={entry.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div>
                  <span className="font-medium">{person?.full_name || "Unnamed"}</span>{" "}
                  <span className="text-muted-foreground">
                    {entry.start_date} → {entry.end_date}
                    {entry.reason ? ` · ${entry.reason}` : ""}
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
