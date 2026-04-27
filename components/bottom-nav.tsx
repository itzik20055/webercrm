"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, Users, ListChecks, Inbox, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  icon: typeof Sparkles;
  label: string;
  badge?: "queue" | "inbox";
};

const items: NavItem[] = [
  { href: "/chat", icon: Sparkles, label: "צ'אט" },
  { href: "/leads", icon: Users, label: "לידים" },
  { href: "/inbox", icon: Inbox, label: "תיבה", badge: "inbox" },
  { href: "/queue", icon: ListChecks, label: "תור", badge: "queue" },
  { href: "/settings", icon: Settings, label: "הגדרות" },
];

export function BottomNav({
  queueCount = 0,
  inboxCount = 0,
}: {
  queueCount?: number;
  inboxCount?: number;
}) {
  const pathname = usePathname();
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 bg-[#111e2f] border-t border-white/10 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_24px_-8px_rgba(0,0,0,0.30)]"
      aria-label="ניווט ראשי"
    >
      <ul className="grid grid-cols-5 max-w-lg mx-auto px-2 pt-1.5 pb-1">
        {items.map(({ href, icon: Icon, label, badge }) => {
          const active =
            href === "/chat"
              ? pathname.startsWith("/chat")
              : pathname.startsWith(href);
          const count = badge === "queue" ? queueCount : badge === "inbox" ? inboxCount : 0;
          const showBadge = !!badge && count > 0;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                aria-label={showBadge ? `${label} · ${count} ממתינים` : label}
                className="flex flex-col items-center justify-center gap-0.5 py-1.5 press rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <span
                  className={cn(
                    "relative flex items-center justify-center h-7 w-12 rounded-full transition-colors duration-200",
                    active && "bg-white/10"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-[18px] transition-colors",
                      active
                        ? "text-white stroke-[2.4]"
                        : "text-white/55"
                    )}
                  />
                  {showBadge && (
                    <span
                      className="absolute -top-0.5 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center tabular-nums ring-2 ring-[#111e2f]"
                      aria-label={`${count} ממתינים לטיפול`}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "text-[10.5px] font-medium tracking-tight",
                    active ? "text-white" : "text-white/65"
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
