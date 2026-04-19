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
      className="fixed bottom-0 inset-x-0 z-30 bg-card/85 backdrop-blur-xl supports-[backdrop-filter]:bg-card/70 border-t border-border/60 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_24px_-8px_rgba(30,58,138,0.08)]"
      aria-label="ניווט ראשי"
    >
      <ul className="grid grid-cols-4 max-w-lg mx-auto px-2 pt-1.5 pb-1">
        {items.map(({ href, icon: Icon, label }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className="flex flex-col items-center justify-center gap-0.5 py-1.5 press"
              >
                <span
                  className={cn(
                    "flex items-center justify-center h-7 w-12 rounded-full transition-colors duration-200",
                    active && "bg-primary-soft"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-[18px] transition-colors",
                      active
                        ? "text-primary stroke-[2.4]"
                        : "text-muted-foreground"
                    )}
                  />
                </span>
                <span
                  className={cn(
                    "text-[10.5px] font-medium tracking-tight",
                    active ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
