"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Download } from "lucide-react";
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

declare global {
  interface Window {
    // Set by the inline script in app/layout.tsx, which captures
    // `beforeinstallprompt` before React has a chance to hydrate.
    __installPrompt?: BeforeInstallPromptEvent | null;
  }
}

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
  const router = useRouter();
  const { identity, switchUser } = useDemoIdentity();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  // Android/desktop Chrome fires this once the page qualifies as
  // installable; capturing it is what lets a click show the browser's own
  // native "Install app?" dialog instead of the page having to fake one.
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallHint, setShowInstallHint] = useState(false);
  // Whether to render the "התקנה" button at all. Deliberately starts false and
  // is only turned on from an effect: `isStandalone()` can't be evaluated on
  // the server, so deciding this during render would make the first client
  // render disagree with the SSR'd HTML and trip a hydration mismatch.
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .then(({ data }) => setProfiles(data ?? []));
  }, []);

  useEffect(() => {
    // Pick up an event that fired before this component mounted (the common
    // case — see the inline script in app/layout.tsx), then stay in sync with
    // any later firing or an `appinstalled` that clears it.
    function sync() {
      setInstallPrompt(window.__installPrompt ?? null);
      // Offer the install affordance to anyone still browsing in a tab. Once
      // the app is actually running standalone there is nothing left to
      // install, so the button disappears there.
      setCanInstall(!isStandalone());
    }
    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      window.__installPrompt = e as BeforeInstallPromptEvent;
      setInstallPrompt(e as BeforeInstallPromptEvent);
    }
    sync();
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("installpromptchange", sync);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("installpromptchange", sync);
    };
  }, []);

  // iOS Safari has no install API at all (Apple doesn't expose one) — the
  // logo click can only ever show it the manual steps, never trigger the
  // install itself.
  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  // The one install routine, shared by the "התקנה" button and the logo click
  // so the two can't drift apart. Returns true if it handled the interaction
  // (so the logo can suppress its own navigation), false if there was nothing
  // to do and the caller should carry on.
  async function promptInstall(): Promise<boolean> {
    if (isStandalone()) return false; // already installed — nothing to offer
    // Read through to the window-stashed event as well, in case this fires
    // before the effect's `sync()` (e.g. a very fast tap right after
    // hydration).
    const deferred = installPrompt ?? window.__installPrompt ?? null;
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      // Chrome won't let the same event be prompted twice — drop it either
      // way. If it was dismissed, Chrome re-fires `beforeinstallprompt`
      // later and `sync()` picks the new one up.
      window.__installPrompt = null;
      setInstallPrompt(null);
      return true;
    }
    // No native prompt available: iOS Safari (no install API at all), a
    // non-Chromium browser, or Chrome hasn't offered it yet. Never let the
    // interaction look dead — show the manual, platform-specific steps.
    setShowInstallHint(true);
    return true;
  }

  // Clicking the logo still installs, exactly as before — the button is an
  // additional, discoverable route to the same thing, not a replacement.
  async function handleLogoClick(e: React.MouseEvent) {
    if (isStandalone()) return; // already installed — plain "go home" link
    // Prevent up front: the await below yields, and by the time it resolves
    // it's far too late to stop the Link's navigation.
    e.preventDefault();
    const handled = await promptInstall();
    if (!handled) router.push("/");
  }

  async function handleInstallClick() {
    setShowInstallHint(false);
    await promptInstall();
  }

  // Needs the full roster (not just this one person) — colors are assigned
  // in coordination with everyone else's, so computing this from identity
  // alone previously ignored a person's own explicit color override and
  // showed a different dot here than everywhere else in the app.
  const color = buildColorAssignments(profiles).get(identity.userId);
  const isAdmin = selectIsAdmin(profiles, identity.userId);

  return (
    <header className="border-b border-border/60 bg-card/40">
      {/* Two columns side by side, each vertically centered against the other.
          The logo used to be absolutely positioned and stretched to the
          header's full height; now that a button sits under it they form one
          normal-flow column instead, so the header simply grows to fit the
          pair and the frame shifts down as a whole rather than the button
          overlapping anything. justify-between keeps the nav at the inline
          start (visual right under dir="rtl") and the logo stack at the
          inline end (visual left) — the same sides both occupied before. */}
      <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        {/* min-w-0 lets this column shrink and wrap its nav on narrow screens
            instead of squeezing the logo stack, which is shrink-0. */}
        <div className="flex min-w-0 flex-col justify-center gap-2">
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
        {/* Logo stacked over its install button. The image gets an explicit
            height rather than the old h-full/max-h-24 percentage — with the
            logo back in normal flow a percentage height would be circular
            (row height depends on the image, image height depends on the row)
            and would resolve against its 255x256 intrinsic size, blowing the
            header up. Fixed heights keep the header a predictable size.
            The whole logo stays the tap target: touch-manipulation drops
            Android's ~300ms double-tap-zoom delay that can make a quick tap
            feel dead, and pointer-events-none + draggable=false on the image
            mean every press resolves to the anchor rather than becoming an
            image-drag or a long-press menu. */}
        <div className="flex shrink-0 flex-col items-center gap-2">
          <Link
            href="/"
            onClick={handleLogoClick}
            aria-label="דף הבית / התקנת האפליקציה"
            className="flex touch-manipulation items-center rounded-md px-2 select-none"
          >
            <Image
              src={logo}
              alt="מנהל משמרות"
              priority
              draggable={false}
              className="pointer-events-none h-16 w-auto sm:h-20"
            />
          </Link>
          {canInstall && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleInstallClick}
              className="w-full touch-manipulation"
            >
              <Download className="size-4" />
              התקנה
            </Button>
          )}
        </div>
        {showInstallHint && (
          <div
            className="absolute end-4 top-full z-40 mt-2 w-60 rounded-md border border-border/60 bg-card p-3 text-xs text-muted-foreground shadow-lg"
            role="dialog"
          >
            <p className="mb-2 font-medium text-foreground">להתקנה כאפליקציה:</p>
            {isIos ? (
              <p>
                לחצו על כפתור השיתוף <span aria-hidden="true">⬆︎</span> בסָפארי, ואז &quot;הוסף למסך הבית&quot;.
              </p>
            ) : (
              <p>
                פתחו את תפריט הדפדפן <span aria-hidden="true">⋮</span> ובחרו &quot;הוספה למסך הבית&quot; או &quot;התקנת האפליקציה&quot;. אם היא כבר מותקנת, פתחו אותה ממסך הבית.
              </p>
            )}
            <Button variant="ghost" size="sm" className="mt-2 h-7" onClick={() => setShowInstallHint(false)}>
              הבנתי
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
