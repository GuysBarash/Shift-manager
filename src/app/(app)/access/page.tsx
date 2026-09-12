"use client";

import { useEffect, useState } from "react";
import { useDemoIdentity } from "@/lib/demo-identity";
import { createClient } from "@/lib/supabase/client";
import { formatDDMMYYYY } from "@/lib/dates";
import { isAdmin as selectIsAdmin } from "@/lib/roster";
import type { Profile } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LastSeenRow = {
  user_id: string;
  full_name: string | null;
  visit_count: number;
  last_seen_at: string | null;
  first_seen_at: string | null;
};

// The log is gated on a passcode checked by the server (ACCESS_LOG_KEY — see
// src/app/api/access-log/route.ts), not on who you claim to be: admin ids are
// public, so identity alone can't protect it. The admin-only UI below is just
// so non-admins aren't shown a form they have no use for. The passcode is
// remembered per device so it only has to be typed once.
const KEY_STORAGE = "access:key";

// localStorage can throw outright (private mode, blocked site data).
function readStoredKey(): string | null {
  try {
    return window.localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

function writeStoredKey(key: string | null): void {
  try {
    if (key === null) window.localStorage.removeItem(KEY_STORAGE);
    else window.localStorage.setItem(KEY_STORAGE, key);
  } catch {
    // ignore
  }
}

type LoadResult =
  | { ok: true; rows: LastSeenRow[] }
  | { ok: false; error: string; badKey: boolean };

async function fetchAccessLog(key: string): Promise<LoadResult> {
  try {
    const res = await fetch("/api/access-log", { headers: { "x-access-key": key } });
    const body: { rows?: LastSeenRow[]; error?: string } = await res.json();
    if (!res.ok || body.error) {
      return { ok: false, error: body.error ?? "שגיאה בטעינת הנתונים.", badKey: res.status === 401 };
    }
    return { ok: true, rows: body.rows ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "שגיאה בטעינת הנתונים.", badKey: false };
  }
}

type View = { loading: boolean; rows: LastSeenRow[] | null; error: string | null };

function viewFor(result: LoadResult): View {
  return result.ok
    ? { loading: false, rows: result.rows, error: null }
    : { loading: false, rows: null, error: result.error };
}

// Keep a key that worked; forget one the server rejected, so the form comes
// back rather than a dead key being re-sent on every visit.
function rememberKey(result: LoadResult, key: string): void {
  if (result.ok) writeStoredKey(key);
  else if (result.badKey) writeStoredKey(null);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDDMMYYYY(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function AccessPage() {
  const { identity } = useDemoIdentity();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  // Reading storage during the first render is safe here: this page only
  // mounts once DemoIdentityProvider is ready — client-side, after hydration —
  // so there's no server-rendered output for it to disagree with.
  const [savedKey] = useState(readStoredKey);
  const [keyInput, setKeyInput] = useState("");
  // Starts in the loading state only when there's a saved key to load with,
  // so the effect below never has to set state synchronously.
  const [view, setView] = useState<View>({ loading: savedKey !== null, rows: null, error: null });

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .then(({ data }) => {
        setProfiles(data ?? []);
        setProfilesLoaded(true);
      });
  }, []);

  const isAdmin = selectIsAdmin(profiles, identity.userId);

  useEffect(() => {
    if (!isAdmin || savedKey === null) return;
    let cancelled = false;
    fetchAccessLog(savedKey).then((result) => {
      if (cancelled) return;
      rememberKey(result, savedKey);
      setView(viewFor(result));
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, savedKey]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    setView({ loading: true, rows: null, error: null });
    const result = await fetchAccessLog(key);
    rememberKey(result, key);
    setView(viewFor(result));
    if (result.ok) setKeyInput("");
  }

  if (profilesLoaded && !isAdmin) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">אין לך הרשאה לצפות בעמוד זה.</CardContent>
      </Card>
    );
  }

  // "For each person who had a session" — someone who never showed up in
  // user_activity at all still gets a row from the view (left join), with
  // last_seen_at null; that's exactly who to leave out here.
  const seen = (view.rows ?? [])
    .filter((r): r is LastSeenRow & { last_seen_at: string } => r.last_seen_at !== null)
    .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));

  const loading = !profilesLoaded || view.loading;
  const needsKey = !loading && view.rows === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="tracking-wide glow-text">גישה</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-muted-foreground">טוען…</p>}
        {view.error && <p className="mb-3 text-sm text-destructive">{view.error}</p>}
        {needsKey && (
          <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="access-key">קוד גישה</Label>
            <div className="flex gap-2">
              <Input
                id="access-key"
                type="password"
                autoComplete="off"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
              />
              <Button type="submit" disabled={!keyInput.trim()}>
                הצגה
              </Button>
            </div>
          </form>
        )}
        {!loading && view.rows !== null && seen.length === 0 && (
          <p className="text-sm text-muted-foreground">אין עדיין נתוני כניסה.</p>
        )}
        {!loading && seen.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-border/60 px-3 py-2 text-start font-medium tracking-wide text-muted-foreground uppercase">
                    שם
                  </th>
                  <th className="border-b border-border/60 px-3 py-2 text-start font-medium tracking-wide text-muted-foreground uppercase">
                    כניסה אחרונה
                  </th>
                  <th className="border-b border-border/60 px-3 py-2 text-start font-medium tracking-wide text-muted-foreground uppercase">
                    ביקורים
                  </th>
                </tr>
              </thead>
              <tbody>
                {seen.map((r) => (
                  <tr key={r.user_id}>
                    <td className="border-b border-border/60 px-3 py-2 font-medium">{r.full_name || "?"}</td>
                    <td className="border-b border-border/60 px-3 py-2 font-mono">
                      {formatDateTime(r.last_seen_at)}
                    </td>
                    <td className="border-b border-border/60 px-3 py-2 font-mono">{r.visit_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
