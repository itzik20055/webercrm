"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, Users, BellRing, Inbox, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  icon: typeof Sparkles;
  label: string;
  badge?: boolean;
};

const items: NavItem[] = [
  { href: "/chat", icon: Sparkles, label: "צ'אט" },
  { href: "/leads", icon: Users, label: "לידים" },
  { href: "/followups", icon: BellRing, label: "פולואפים" },
  { href: "/inbox", icon: Inbox, label: "תיבה", badge: true },
  { href: "/settings", icon: Settings, label: "הגדרות" },
];

export function BottomNav({ inboxCount = 0 }: { inboxCount?: number }) {
  const pathname = usePathname();
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 bg-card/85 backdrop-blur-xl supports-[backdrop-filter]:bg-card/70 border-t border-border/60 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_24px_-8px_rgba(30,58,138,0.08)]"
      aria-label="ניווט ראשי"
    >
      <ul className="grid grid-cols-5 max-w-lg mx-auto px-2 pt-1.5 pb-1">
        {items.map(({ href, icon: Icon, label, badge }) => {
          const active =
            href === "/chat"
              ? pathname === "/" || pathname.startsWith("/chat")
              : pathname.startsWith(href);
          const showBadge = badge && inboxCount > 0;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                aria-label={showBadge ? `${label} · ${inboxCount} ממתינים` : label}
                className="flex flex-col items-center justify-center gap-0.5 py-1.5 press rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span
                  className={cn(
                    "relative flex items-center justify-center h-7 w-12 rounded-full transition-colors duration-200",
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
                  {showBadge && (
                    <span
                      className="absolute -top-0.5 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center tabular-nums ring-2 ring-card"
                      aria-label={`${inboxCount} ממתינים לאישור`}
                    >
                      {inboxCount > 99 ? "99+" : inboxCount}
                    </span>
                  )}
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
