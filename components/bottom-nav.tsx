"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, BellRing, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", icon: Home, label: "בית" },
  { href: "/leads", icon: Users, label: "לידים" },
  { href: "/followups", icon: BellRing, label: "פולואפים" },
  { href: "/settings", icon: Settings, label: "הגדרות" },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 pb-[env(safe-area-inset-bottom)]"
      aria-label="ניווט ראשי"
    >
      <ul className="grid grid-cols-4 max-w-lg mx-auto">
        {items.map(({ href, icon: Icon, label }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2.5 text-xs",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className={cn("size-5", active && "stroke-[2.5]")} />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
