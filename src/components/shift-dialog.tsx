"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { toISODate } from "@/lib/dates";
import type { Profile, Shift } from "@/types/database";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const UNASSIGNED = "unassigned";

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h + hours) % 24;
  return `${String(total).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function ShiftDialog({
  open,
  onOpenChange,
  shift,
  defaultDate,
  defaultStartTime = "09:00",
  defaultPosition = "",
  profiles,
  currentUserId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: Shift | null;
  defaultDate: Date;
  defaultStartTime?: string;
  defaultPosition?: string;
  profiles: Profile[];
  currentUserId: string;
  onSaved: () => void;
}) {
  const [shiftDate, setShiftDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [position, setPosition] = useState("");
  const [assignedTo, setAssignedTo] = useState(UNASSIGNED);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (shift) {
      setShiftDate(shift.shift_date);
      setStartTime(shift.start_time.slice(0, 5));
      setEndTime(shift.end_time.slice(0, 5));
      setPosition(shift.position ?? "");
      setAssignedTo(shift.assigned_to ?? UNASSIGNED);
      setNotes(shift.notes ?? "");
    } else {
      setShiftDate(toISODate(defaultDate));
      setStartTime(defaultStartTime);
      setEndTime(addHours(defaultStartTime, 4));
      setPosition(defaultPosition);
      setAssignedTo(UNASSIGNED);
      setNotes("");
    }
  }, [open, shift, defaultDate, defaultStartTime, defaultPosition]);

  async function handleSave() {
    if (!shiftDate || !startTime || !endTime) {
      toast.error("Date, start time, and end time are required.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const payload = {
      shift_date: shiftDate,
      start_time: startTime,
      end_time: endTime,
      position: position || null,
      assigned_to: assignedTo === UNASSIGNED ? null : assignedTo,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = shift
      ? await supabase.from("shifts").update(payload).eq("id", shift.id)
      : await supabase.from("shifts").insert({ ...payload, created_by: currentUserId });

    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(shift ? "Shift updated." : "Shift created.");
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!shift) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("shifts").delete().eq("id", shift.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Shift deleted. You can undo this from Activity.");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{shift ? "Edit shift" : "New shift"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1 space-y-2">
              <Label htmlFor="shift-date">Date</Label>
              <Input
                id="shift-date"
                type="date"
                value={shiftDate}
                onChange={(e) => setShiftDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="start-time">Start</Label>
              <Input
                id="start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-time">End</Label>
              <Input
                id="end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="position">Position</Label>
            <Input
              id="position"
              placeholder="e.g. Cashier"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Assigned to</Label>
            <Select value={assignedTo} onValueChange={(value) => setAssignedTo(value ?? UNASSIGNED)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string) =>
                    value === UNASSIGNED
                      ? "Unassigned"
                      : profiles.find((p) => p.id === value)?.full_name || "Unnamed"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name || "Unnamed"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {shift ? (
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
