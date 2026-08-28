"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDemoIdentity } from "@/lib/demo-identity";
import { createClient } from "@/lib/supabase/client";
import { buildColorAssignments } from "@/lib/person-color";
import { isAdmin as selectIsAdmin } from "@/lib/roster";
import type { Profile } from "@/types/database";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logo from "@/logo.png";

const LINKS = [
  { href: "/people", label: "חברותא" },
  { href: "/off-time", label: "חופש" },
  { href: "/", label: "משמרות" },
];

// Chrome's own type for the event fired when a page becomes installable —
// not yet in TypeScript's built-in DOM lib.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS's own (non-standard) flag — there's no display-mode media query
    // support there.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function NavBar() {
  const pathname = usePathname();
  const { identity, switchUser } = useDemoIdentity();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  // Android/desktop Chrome fires this once the page qualifies as
  // installable; capturing it is what lets a click show the browser's own
  // native "Install app?" dialog instead of the page having to fake one.
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .then(({ data }) => setProfiles(data ?? []));
  }, []);

  useEffect(() => {
    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  // iOS Safari has no install API at all (Apple doesn't expose one) — the
  // logo click can only ever show it the manual steps, never trigger the
  // install itself.
  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  async function handleLogoClick(e: React.MouseEvent) {
    if (isStandalone()) return; // already installed — plain "go home" link
    if (installPrompt) {
      e.preventDefault();
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome !== "dismissed") setInstallPrompt(null);
      return;
    }
    if (isIos) {
      e.preventDefault();
      setShowIosHint(true);
    }
    // Anything else (already installed, or a browser with neither path):
    // fall through to the normal Link navigation.
  }

  // Needs the full roster (not just this one person) — colors are assigned
  // in coordination with everyone else's, so computing this from identity
  // alone previously ignored a person's own explicit color override and
  // showed a different dot here than everywhere else in the app.
  const color = buildColorAssignments(profiles).get(identity.userId);
  const isAdmin = selectIsAdmin(profiles, identity.userId);

  return (
    <header className="border-b border-border/60 bg-card/40">
      <div className="relative mx-auto flex max-w-6xl px-4 py-3">
        {/* Nav + identity stack in their own column exactly as before (same
            two rows, same gap, same flow) — its height is driven purely by
            its own content, same as before this logo change, so the text
            never moves. The logo is pulled OUT of that flow entirely
            (absolute + inset-y-0) so it can span the header's full height
            edge-to-edge without being able to influence — or be limited by
            — the column's height (a plain h-full/items-stretch pairing here
            is circular: with an auto-height row, the percentage falls back
            to the image's own large intrinsic size and inflates the row).
            It's pinned to the visual left (inset-inline-end lands there
            under dir="rtl", the conventional top-left corner regardless of
            text direction), capped at max-h-24 so it can't spiral upward on
            narrow screens (nav wraps -> column taller -> logo taller ->
            even less width left for nav...). The column reserves pe-28,
            comfortably wider than that capped logo, so its content never
            renders underneath it. */}
        <div className="flex flex-col justify-center gap-2 pe-28">
          <nav className="flex flex-wrap gap-1">
            {LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium tracking-wide uppercase transition-colors hover:bg-accent hover:text-accent-foreground",
                    active
                      ? "glow-text bg-accent text-primary"
                      : "text-muted-foreground"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              מחובר כ
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: color?.hex, boxShadow: color ? `0 0 6px ${color.hex}` : undefined }}
              />
              <span style={{ color: color?.hex }}>{identity.fullName}</span>
            </span>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={switchUser}>
                החלפת שם
              </Button>
            )}
          </div>
        </div>
        <Link
          href="/"
          onClick={handleLogoClick}
          className="absolute inset-y-0 end-4 flex items-center"
        >
          <Image src={logo} alt="מנהל משמרות" priority className="h-full max-h-24 w-auto" />
        </Link>
        {showIosHint && (
          <div
            className="absolute inset-y-0 end-4 top-full z-40 mt-2 w-56 rounded-md border border-border/60 bg-card p-3 text-xs text-muted-foreground shadow-lg"
            role="dialog"
          >
            <p className="mb-2 font-medium text-foreground">להתקנה כאפליקציה:</p>
            <p>
              לחצו על כפתור השיתוף <span aria-hidden="true">⬆︎</span> בסָפארי, ואז &quot;הוסף למסך הבית&quot;.
            </p>
            <Button variant="ghost" size="sm" className="mt-2 h-7" onClick={() => setShowIosHint(false)}>
              הבנתי
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
