"use client";

import { useEffect, useState } from "react";
import { useDemoIdentity } from "@/lib/demo-identity";
import { createClient } from "@/lib/supabase/client";
import { formatDDMMYYYY } from "@/lib/dates";
import { isAdmin as selectIsAdmin } from "@/lib/roster";
import type { Profile } from "@/types/database";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LastSeenRow = {
  user_id: string;
  full_name: string | null;
  visit_count: number;
  last_seen_at: string | null;
  first_seen_at: string | null;
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDDMMYYYY(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function AccessPage() {
  const { identity } = useDemoIdentity();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [rows, setRows] = useState<LastSeenRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    if (!profilesLoaded) return;
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/access-log?userId=${encodeURIComponent(identity.userId)}`)
      .then((res) => res.json())
      .then((body: { rows?: LastSeenRow[]; error?: string }) => {
        if (body.error) {
          setError(body.error);
          return;
        }
        setRows(body.rows ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "שגיאה בטעינת הנתונים."))
      .finally(() => setLoading(false));
  }, [profilesLoaded, isAdmin, identity.userId]);

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
  const seen = (rows ?? [])
    .filter((r): r is LastSeenRow & { last_seen_at: string } => r.last_seen_at !== null)
    .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="tracking-wide glow-text">גישה</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-muted-foreground">טוען…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && seen.length === 0 && (
          <p className="text-sm text-muted-foreground">אין עדיין נתוני כניסה.</p>
        )}
        {!loading && !error && seen.length > 0 && (
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
