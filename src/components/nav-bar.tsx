"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDemoIdentity } from "@/lib/demo-identity";
import { createClient } from "@/lib/supabase/client";
import { buildColorAssignments } from "@/lib/person-color";
import type { Profile } from "@/types/database";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logo from "@/logo.png";

const LINKS = [
  { href: "/people", label: "חברותא" },
  { href: "/off-time", label: "חופש" },
  { href: "/", label: "משמרות" },
];

export function NavBar() {
  const pathname = usePathname();
  const { identity, switchUser } = useDemoIdentity();
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .then(({ data }) => setProfiles(data ?? []));
  }, []);

  // Needs the full roster (not just this one person) — colors are assigned
  // in coordination with everyone else's, so computing this from identity
  // alone previously ignored a person's own explicit color override and
  // showed a different dot here than everywhere else in the app.
  const color = buildColorAssignments(profiles).get(identity.userId);

  return (
    <header className="border-b border-border/60 bg-card/40">
      <div className="mx-auto flex max-w-6xl items-stretch justify-between gap-3 px-4 py-3">
        {/* Nav + identity stack in their own column exactly as before (same
            two rows, same gap) — wrapping them together just gives the logo
            a sibling whose height it can match. The logo is pinned to the
            visual left (DOM-last lands there under dir="rtl", the
            conventional top-left corner regardless of text direction) and
            stretched via items-stretch + h-full to span that column's full
            height, whatever it ends up being, instead of a fixed size. */}
        <div className="flex flex-col justify-center gap-2">
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
            <Button variant="outline" size="sm" onClick={switchUser}>
              החלפת שם
            </Button>
          </div>
        </div>
        <Link href="/" className="flex shrink-0">
          <Image src={logo} alt="מנהל משמרות" priority className="h-full w-auto" />
        </Link>
      </div>
    </header>
  );
}
