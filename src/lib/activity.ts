// Traffic logging. Appends a row to public.user_activity so there's an answer
// to "who is actually using this, and when" — see
// supabase/migrations/20260101000006_user_activity.sql.
//
// Everything here is best-effort and must never affect the app: a failed
// insert (offline, RLS change, table missing) is swallowed, and nothing ever
// awaits these calls on a path the user is waiting on.

import { createClient } from "@/lib/supabase/client";

export type ActivityEvent = "login" | "visit" | "switch";

// A 'visit' is meant to approximate "a session", not "a page view". The app is
// a client-side-routed SPA, but a PWA can also sit open for days, so neither
// mount-only nor per-navigation logging is right on its own. Instead any
// trigger can ask to log, and we drop it if we already logged within this
// window on this device.
const SESSION_GAP_MS = 30 * 60 * 1000;
const LAST_VISIT_KEY = "activity:last-visit";

function displayMode(): string {
  if (typeof window === "undefined") return "unknown";
  // Matches the check the install button uses in components/nav-bar.tsx.
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? "standalone" : "browser";
}

// localStorage can throw outright (private mode, site data blocked), so every
// access is guarded — a browser that won't remember the timestamp should still
// get its events logged, just without debouncing.
function readLastVisit(): number {
  try {
    return Number(window.localStorage.getItem(LAST_VISIT_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeLastVisit(at: number): void {
  try {
    window.localStorage.setItem(LAST_VISIT_KEY, String(at));
  } catch {
    // ignore
  }
}

/**
 * Record one usage event. Fire-and-forget: never throws, never blocks.
 *
 * 'visit' is debounced to at most one row per SESSION_GAP_MS per device.
 * 'login' and 'switch' are deliberate, infrequent actions and always log.
 */
export function recordActivity(userId: string, event: ActivityEvent): void {
  if (typeof window === "undefined" || !userId) return;

  if (event === "visit") {
    const now = Date.now();
    if (now - readLastVisit() < SESSION_GAP_MS) return;
    // Stamp before the request rather than after it: two triggers can fire in
    // the same tick (mount and a visibilitychange), and waiting for the insert
    // to resolve would let both through.
    writeLastVisit(now);
  }

  try {
    const supabase = createClient();
    // No .select() chained — the RLS policy grants INSERT only, and
    // supabase-js only reads rows back if you ask it to.
    void supabase
      .from("user_activity")
      .insert({
        user_id: userId,
        event_type: event,
        user_agent: navigator.userAgent,
        path: window.location.pathname,
        display_mode: displayMode(),
      })
      .then(() => undefined, () => undefined);
  } catch {
    // ignore
  }
}

/**
 * Log a visit now, and again whenever the app is brought back to the
 * foreground after being away longer than the session gap — which is how an
 * installed PWA that's never actually closed still shows up as repeat traffic.
 * Returns an unsubscribe function.
 */
export function trackVisits(userId: string): () => void {
  recordActivity(userId, "visit");
  const onVisible = () => {
    if (document.visibilityState === "visible") recordActivity(userId, "visit");
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => document.removeEventListener("visibilitychange", onVisible);
}
