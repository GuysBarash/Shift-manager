"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { formatTime } from "@/lib/dates";
import type { Profile, ShiftAudit } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ActivityPage() {
  const [entries, setEntries] = useState<ShiftAudit[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [{ data: auditRows, error }, { data: profileRows }] = await Promise.all([
      supabase
        .from("shift_audit")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(50),
      supabase.from("profiles").select("*"),
    ]);
    if (error) console.error(error);
    setEntries(auditRows ?? []);
    setProfiles(profileRows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUndo(entry: ShiftAudit) {
    setUndoingId(entry.id);
    const supabase = createClient();
    const old = entry.old_value;

    const result =
      entry.change_type === "delete"
        ? await supabase.from("shifts").insert({
            id: old.id,
            shift_date: old.shift_date,
            start_time: old.start_time,
            end_time: old.end_time,
            position: old.position,
            assigned_to: old.assigned_to,
            notes: old.notes,
            created_by: old.created_by,
            updated_at: new Date().toISOString(),
          })
        : await supabase
            .from("shifts")
            .update({
              shift_date: old.shift_date,
              start_time: old.start_time,
              end_time: old.end_time,
              position: old.position,
              assigned_to: old.assigned_to,
              notes: old.notes,
              updated_at: new Date().toISOString(),
            })
            .eq("id", entry.shift_id);

    if (result.error) {
      toast.error(`Couldn't undo: ${result.error.message}`);
      setUndoingId(null);
      return;
    }

    await supabase.from("shift_audit").update({ undone: true }).eq("id", entry.id);
    toast.success("Change undone.");
    setUndoingId(null);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && entries.length === 0 && (
          <p className="text-sm text-muted-foreground">No changes yet.</p>
        )}
        {entries.map((entry) => {
          const who = entry.changed_by ? profileById.get(entry.changed_by) : null;
          const old = entry.old_value;
          return (
            <div key={entry.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={entry.change_type === "delete" ? "destructive" : "secondary"}>
                    {entry.change_type}
                  </Badge>
                  <span className="font-medium">{who?.full_name || "Someone"}</span>
                  <span className="text-muted-foreground">
                    {new Date(entry.changed_at).toLocaleString()}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {old.shift_date} · {formatTime(old.start_time)}–{formatTime(old.end_time)}
                  {old.position ? ` · ${old.position}` : ""}
                </div>
              </div>
              {entry.undone ? (
                <span className="text-xs text-muted-foreground">Undone</span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={undoingId === entry.id}
                  onClick={() => handleUndo(entry)}
                >
                  {undoingId === entry.id ? "Undoing..." : "Undo"}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
