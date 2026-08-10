"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { personColor } from "@/lib/person-color";
import type { Profile } from "@/types/database";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PeoplePage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const [{ data: userData }, { data: profileRows, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("profiles").select("*").order("full_name", { ascending: true }),
    ]);
    if (error) console.error(error);
    setUserId(userData.user?.id ?? null);
    setProfiles(profileRows ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(p: Profile) {
    setEditingId(p.id);
    setFullName(p.full_name ?? "");
    setPhone(p.phone ?? "");
  }

  async function handleSave() {
    if (!editingId) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName, phone })
      .eq("id", editingId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Profile updated.");
    setEditingId(null);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="uppercase tracking-wide glow-text">People</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && profiles.length === 0 && (
          <p className="text-sm text-muted-foreground">No one here yet.</p>
        )}
        {profiles.map((p) => {
          const color = personColor(p.id);
          const isMe = p.id === userId;
          const isEditing = editingId === p.id;
          return (
            <div key={p.id} className="rounded-md border border-border/60 p-3">
              {isEditing ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`name-${p.id}`}>Full name</Label>
                      <Input id={`name-${p.id}`} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`phone-${p.id}`}>Phone</Label>
                      <Input id={`phone-${p.id}`} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                      {saving ? "Saving..." : "Save"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{
                        backgroundColor: color?.hex,
                        boxShadow: color ? `0 0 6px ${color.hex}` : undefined,
                      }}
                    />
                    <div>
                      <div className="font-medium">
                        {p.full_name || "Unnamed"}
                        {isMe && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </div>
                      {p.phone && <div className="text-sm text-muted-foreground">{p.phone}</div>}
                    </div>
                  </div>
                  {isMe && (
                    <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>
                      Edit
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
