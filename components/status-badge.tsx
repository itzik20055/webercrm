import { STATUS_LABELS, type Lead } from "@/db/schema";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<Lead["status"], string> = {
  new: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  contacted: "bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200",
  interested: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  quoted: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  closing: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  booked: "bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100",
  lost: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
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
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        STATUS_STYLES[status],
        className
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const PRIORITY_STYLES: Record<Lead["priority"], string> = {
  hot: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  warm: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  cold: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
};

const PRIORITY_LABELS: Record<Lead["priority"], string> = {
  hot: "🔥 חם",
  warm: "פושר",
  cold: "קר",
};

export function PriorityBadge({
  priority,
  className,
}: {
  priority: Lead["priority"];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        PRIORITY_STYLES[priority],
        className
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
