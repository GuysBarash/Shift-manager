"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDemoIdentity } from "@/lib/demo-identity";
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
  const { identity, switchUser } = useDemoIdentity();
  const color = personColor(identity.userId, null);

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
    </header>
  );
}
