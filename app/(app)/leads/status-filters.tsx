"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

type Filter = { v: string; l: string };

const PRIMARY: Filter[] = [
  { v: "active", l: "פעילים" },
  { v: "new", l: "חדשים" },
  { v: "interested", l: "מתעניינים" },
  { v: "quoted", l: "הצעה" },
  { v: "closing", l: "בסגירה" },
];

const SECONDARY: Filter[] = [
  { v: "all", l: "הכל" },
  { v: "contacted", l: "בקשר" },
  { v: "booked", l: "נסגרו" },
  { v: "lost", l: "אבד" },
];

function buildHref(
  base: { q?: string; priority?: string },
  status: string
): string {
  const params = new URLSearchParams();
  if (base.q) params.set("q", base.q);
  params.set("status", status);
  if (base.priority) params.set("priority", base.priority);
  return `/leads?${params}`;
}

export function StatusFilters({
  q,
  priority,
  active,
}: {
  q?: string;
  priority?: string;
  active: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const activeSecondary = SECONDARY.find((f) => f.v === active);
  const base = { q, priority };

  const pillCls = (isActive: boolean) =>
    "press px-3.5 h-9 rounded-full text-[13px] font-semibold whitespace-nowrap flex items-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
    (isActive
      ? "bg-primary text-primary-foreground shadow-soft"
      : "bg-card border border-border text-muted-foreground");

  return (
    <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-hide">
      {PRIMARY.map((f) => {
        const isActive = f.v === active;
        return (
          <Link
            key={f.v}
            href={buildHref(base, f.v)}
            aria-current={isActive ? "page" : undefined}
            className={pillCls(isActive)}
          >
            {f.l}
          </Link>
        );
      })}

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={
            pillCls(Boolean(activeSecondary)) + " gap-1.5"
          }
        >
          {activeSecondary?.l ?? "עוד"}
          <ChevronDown
            className={
              "size-3.5 transition-transform " + (open ? "rotate-180" : "")
            }
            strokeWidth={2.5}
          />
        </button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1.5 z-20 min-w-[140px] bg-card border border-border rounded-2xl shadow-card p-1.5 flex flex-col gap-0.5"
          >
            {SECONDARY.map((f) => {
              const isActive = f.v === active;
              return (
                <Link
                  key={f.v}
                  href={buildHref(base, f.v)}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={
                    "press px-3 h-9 rounded-xl text-[13px] font-semibold whitespace-nowrap flex items-center " +
                    (isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted")
                  }
                >
                  {f.l}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
