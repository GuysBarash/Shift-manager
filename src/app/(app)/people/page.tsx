"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { PALETTE, personColor } from "@/lib/person-color";
import type { Profile } from "@/types/database";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check } from "lucide-react";

export default function PeoplePage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
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
    setSelectedColor(p.color);
  }

  async function handleSave() {
    if (!editingId) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName, phone, color: selectedColor })
      .eq("id", editingId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("הפרופיל עודכן.");
    setEditingId(null);
    load();
  }

  // Colors already in use by someone else (auto-assigned or chosen) — not offered.
  const takenByOthers = new Set(
    profiles
      .filter((p) => p.id !== editingId)
      .map((p) => personColor(p.id, p.color)?.name)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="tracking-wide glow-text">חברותא</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">טוען…</p>}
        {!loading && profiles.length === 0 && (
          <p className="text-sm text-muted-foreground">עדיין אין כאן אף אחד.</p>
        )}
        {profiles.map((p) => {
          const color = personColor(p.id, p.color);
          const isMe = p.id === userId;
          const isEditing = editingId === p.id;
          return (
            <div key={p.id} className="rounded-md border border-border/60 p-3">
              {isEditing ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`name-${p.id}`}>שם מלא</Label>
                      <Input id={`name-${p.id}`} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`phone-${p.id}`}>טלפון</Label>
                      <Input id={`phone-${p.id}`} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="אופציונלי" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>צבע</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedColor(null)}
                        className={`rounded-full border px-2.5 py-1 text-xs ${
                          selectedColor === null
                            ? "border-primary text-primary glow-text"
                            : "border-border/60 text-muted-foreground"
                        }`}
                      >
                        אוטומטי
                      </button>
                      {PALETTE.map((c) => {
                        const taken = takenByOthers.has(c.name) && selectedColor !== c.name;
                        const selected = selectedColor === c.name;
                        return (
                          <button
                            key={c.name}
                            type="button"
                            disabled={taken}
                            onClick={() => setSelectedColor(c.name)}
                            title={taken ? "בשימוש על ידי מישהו אחר" : c.name}
                            className={`flex size-7 items-center justify-center rounded-full transition-opacity ${
                              taken ? "cursor-not-allowed opacity-25" : "cursor-pointer"
                            }`}
                            style={{
                              backgroundColor: c.hex,
                              boxShadow: selected ? `0 0 0 2px var(--card), 0 0 0 4px ${c.hex}` : undefined,
                            }}
                          >
                            {selected && <Check className="size-3.5 text-black/70" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                      {saving ? "שומר..." : "שמירה"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      ביטול
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
                        {p.full_name || "ללא שם"}
                        {isMe && <span className="ms-2 text-xs text-muted-foreground">(אני)</span>}
                      </div>
                      {p.phone && <div className="text-sm text-muted-foreground">{p.phone}</div>}
                    </div>
                  </div>
                  {isMe && (
                    <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>
                      עריכה
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
