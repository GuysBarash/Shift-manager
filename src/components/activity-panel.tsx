"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { formatDDMMYYYY, formatTime } from "@/lib/dates";
import type { Profile, ShiftAudit } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { History } from "lucide-react";

export function ActivityPanel({ profiles }: { profiles: Profile[] }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ShiftAudit[]>([]);
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
    const { data, error } = await supabase
      .from("shift_audit")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(50);
    if (error) console.error(error);
    setEntries(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

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
      toast.error(`לא ניתן לבטל: ${result.error.message}`);
      setUndoingId(null);
      return;
    }

    await supabase.from("shift_audit").update({ undone: true }).eq("id", entry.id);
    toast.success("השינוי בוטל.");
    setUndoingId(null);
    load();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <History className="size-4" />
        היסטוריה
      </Button>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="tracking-wide glow-text">יומן פעילות</SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
          {loading && <p className="text-sm text-muted-foreground">טוען…</p>}
          {!loading && entries.length === 0 && (
            <p className="text-sm text-muted-foreground">עדיין אין שינויים.</p>
          )}
          {entries.map((entry) => {
            const who = entry.changed_by ? profileById.get(entry.changed_by) : null;
            const old = entry.old_value;
            const changedAt = new Date(entry.changed_at);
            const changedAtLabel = `${formatDDMMYYYY(changedAt)} ${String(changedAt.getHours()).padStart(2, "0")}:${String(changedAt.getMinutes()).padStart(2, "0")}`;
            return (
              <div key={entry.id} className="space-y-2 rounded-md border border-border/60 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={entry.change_type === "delete" ? "destructive" : "secondary"}>
                    {entry.change_type === "delete" ? "מחיקה" : "עדכון"}
                  </Badge>
                  <span className="font-medium">{who?.full_name || "מישהו"}</span>
                </div>
                <div className="text-muted-foreground">{changedAtLabel}</div>
                <div className="text-muted-foreground">
                  {old.shift_date} · {formatTime(old.start_time)}–{formatTime(old.end_time)}
                  {old.position ? ` · ${old.position}` : ""}
                </div>
                {entry.undone ? (
                  <span className="text-xs text-muted-foreground">בוטל</span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={undoingId === entry.id}
                    onClick={() => handleUndo(entry)}
                  >
                    {undoingId === entry.id ? "מבטל..." : "ביטול"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
