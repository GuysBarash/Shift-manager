"use client";

// TEMPORARY DEMO-MODE IDENTITY — stands in for real Supabase Auth while the
// app is being shown around, not deployed for real yet.
//
// A visitor types a name once; it's matched against existing profiles
// (case-insensitive) or a new one is created, then remembered via a cookie
// so they don't need to re-enter it. No password, no email, no real auth
// session — see supabase/migrations/20260101000003_temporary_demo_open_access.sql
// for the matching RLS changes and how to revert both when deploying for real.

import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const COOKIE_NAME = "demo_person_id";
const COOKIE_DAYS = 365;

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

type DemoIdentity = {
  userId: string;
  fullName: string;
};

const DemoIdentityContext = createContext<{
  identity: DemoIdentity;
  switchUser: () => void;
} | null>(null);

export function useDemoIdentity() {
  const ctx = useContext(DemoIdentityContext);
  if (!ctx) throw new Error("useDemoIdentity must be used within DemoIdentityProvider");
  return ctx;
}

export function DemoIdentityProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<DemoIdentity | null>(null);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createClient();
    // A real Supabase Auth session lingering from before demo mode would make
    // every request go through as `authenticated` instead of `anon` — and
    // `authenticated` was never granted INSERT on profiles, only `anon` was
    // (see the demo-mode migration). Force it out so requests are always anon.
    supabase.auth.signOut().finally(() => {
      const id = readCookie(COOKIE_NAME);
      if (!id) {
        setReady(true);
        return;
      }
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setIdentity({ userId: data.id, fullName: data.full_name || "" });
          } else {
            clearCookie(COOKIE_NAME);
          }
          setReady(true);
        });
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError("");
    const supabase = createClient();

    const { data: existing } = await supabase
      .from("profiles")
      .select("id, full_name")
      .ilike("full_name", trimmed)
      .limit(1)
      .maybeSingle();

    if (existing) {
      writeCookie(COOKIE_NAME, existing.id, COOKIE_DAYS);
      setIdentity({ userId: existing.id, fullName: existing.full_name || trimmed });
      setSubmitting(false);
      return;
    }

    const { data: created, error: insertError } = await supabase
      .from("profiles")
      .insert({ id: crypto.randomUUID(), full_name: trimmed })
      .select("id, full_name")
      .single();

    setSubmitting(false);
    if (insertError || !created) {
      setError(insertError?.message ?? "שגיאה ביצירת המשתמש.");
      return;
    }
    writeCookie(COOKIE_NAME, created.id, COOKIE_DAYS);
    setIdentity({ userId: created.id, fullName: created.full_name || trimmed });
  }

  function switchUser() {
    clearCookie(COOKIE_NAME);
    setIdentity(null);
  }

  if (!ready) return null;

  if (!identity) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm glow-border">
          <CardHeader>
            <CardTitle className="tracking-wide glow-text">מנהל משמרות</CardTitle>
            <CardDescription>מה השם שלך?</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="demo-name">שם</Label>
                <Input
                  id="demo-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="השם שלך"
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting || !name.trim()}>
                {submitting ? "נכנס..." : "כניסה"}
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <DemoIdentityContext.Provider value={{ identity, switchUser }}>
      {children}
    </DemoIdentityContext.Provider>
  );
}
