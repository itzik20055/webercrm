import { Flame, Snowflake, Thermometer } from "lucide-react";
import { STATUS_LABELS, type Lead } from "@/db/schema";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<Lead["status"], string> = {
  new: "bg-blue-50 text-blue-700 ring-1 ring-blue-200/60 dark:bg-blue-950/60 dark:text-blue-200 dark:ring-blue-800/40",
  contacted: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200/60 dark:bg-cyan-950/60 dark:text-cyan-200 dark:ring-cyan-800/40",
  interested: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60 dark:bg-emerald-950/60 dark:text-emerald-200 dark:ring-emerald-800/40",
  quoted: "bg-amber-50 text-amber-800 ring-1 ring-amber-200/60 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-800/40",
  closing: "bg-orange-50 text-orange-700 ring-1 ring-orange-200/60 dark:bg-orange-950/60 dark:text-orange-200 dark:ring-orange-800/40",
  booked: "bg-green-100 text-green-800 ring-1 ring-green-300/60 dark:bg-green-900/70 dark:text-green-100 dark:ring-green-700/40",
  lost: "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200/60 dark:bg-zinc-800/60 dark:text-zinc-400 dark:ring-zinc-700/40",
};

export function StatusBadge({
  status,
  className,
}: {
  status: Lead["status"];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-tight",
        STATUS_STYLES[status],
        className
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const PRIORITY_STYLES: Record<Lead["priority"], string> = {
  hot: "bg-red-50 text-red-700 ring-1 ring-red-200/60 dark:bg-red-950/60 dark:text-red-200 dark:ring-red-800/40",
  warm: "bg-amber-50 text-amber-800 ring-1 ring-amber-200/60 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-800/40",
  cold: "bg-sky-50 text-sky-700 ring-1 ring-sky-200/60 dark:bg-sky-950/60 dark:text-sky-200 dark:ring-sky-800/40",
};

const PRIORITY_LABELS: Record<Lead["priority"], string> = {
  hot: "חם",
  warm: "פושר",
  cold: "קר",
};

const PRIORITY_ICONS: Record<Lead["priority"], React.ComponentType<{ className?: string }>> = {
  hot: Flame,
  warm: Thermometer,
  cold: Snowflake,
};

export function PriorityBadge({
  priority,
  className,
}: {
  priority: Lead["priority"];
  className?: string;
}) {
  const Icon = PRIORITY_ICONS[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-tight",
        PRIORITY_STYLES[priority],
        className
      )}
    >
      <Icon className="size-3" />
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
