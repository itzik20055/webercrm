"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setStatus, setPriority } from "@/app/(app)/leads/actions";
import { STATUS_LABELS, PRIORITY_LABELS, type Lead } from "@/db/schema";
import { cn } from "@/lib/utils";

const STATUS_ORDER: Lead["status"][] = [
  "new",
  "contacted",
  "interested",
  "quoted",
  "closing",
  "booked",
  "lost",
];

export function StatusPicker({
  leadId,
  current,
}: {
  leadId: string;
  current: Lead["status"];
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-hide">
      {STATUS_ORDER.map((s) => {
        const active = s === current;
        return (
          <button
            key={s}
            disabled={pending || active}
            onClick={() =>
              start(async () => {
                try {
                  await setStatus(leadId, s);
                  toast.success(`סטטוס: ${STATUS_LABELS[s]}`);
                } catch {
                  toast.error("שמירה נכשלה");
                }
              })
            }
            className={cn(
              "px-3 h-8 rounded-full text-sm font-medium whitespace-nowrap transition shrink-0",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground active:scale-95"
            )}
          >
            {STATUS_LABELS[s]}
          </button>
        );
      })}
    </div>
  );
}

export function PriorityPicker({
  leadId,
  current,
}: {
  leadId: string;
  current: Lead["priority"];
}) {
  const [pending, start] = useTransition();
  const items: { v: Lead["priority"]; cls: string }[] = [
    { v: "hot", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
    { v: "warm", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
    { v: "cold", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  ];
  return (
    <div className="flex gap-1.5">
      {items.map(({ v, cls }) => {
        const active = v === current;
        return (
          <button
            key={v}
            disabled={pending || active}
            onClick={() =>
              start(async () => {
                try {
                  await setPriority(leadId, v);
                  toast.success(`עדיפות: ${PRIORITY_LABELS[v]}`);
                } catch {
                  toast.error("שמירה נכשלה");
                }
              })
            }
            className={cn(
              "flex-1 h-8 rounded-md text-sm font-medium transition",
              active
                ? cls + " ring-2 ring-current/30"
                : "bg-secondary text-muted-foreground active:scale-95"
            )}
          >
            {PRIORITY_LABELS[v]}
          </button>
        );
      })}
    </div>
  );
}
