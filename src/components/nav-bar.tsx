"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { personColor } from "@/lib/person-color";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/people", label: "חברותא" },
  { href: "/off-time", label: "חופש" },
  { href: "/", label: "משמרות" },
];

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [whoAmI, setWhoAmI] = useState<{ id: string; name: string; color: string | null } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, color")
        .eq("id", data.user.id)
        .single();
      setWhoAmI({
        id: data.user.id,
        name: profile?.full_name || data.user.email || "",
        color: profile?.color ?? null,
      });
    });
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const color = whoAmI ? personColor(whoAmI.id, whoAmI.color) : null;

  return (
    <header className="border-b border-border/60 bg-card/40">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
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
        <div className="flex items-center gap-3">
          {whoAmI && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              מחובר כ
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: color?.hex, boxShadow: color ? `0 0 6px ${color.hex}` : undefined }}
              />
              <span style={{ color: color?.hex }}>{whoAmI.name}</span>
            </span>
          )}
          <Button variant="outline" size="sm" onClick={handleLogout}>
            התנתקות
          </Button>
        </div>
      </div>
    </header>
  );
}
