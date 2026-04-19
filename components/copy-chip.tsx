"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";

export function CopyChip({
  value,
  icon,
  label,
}: {
  value: string;
  icon?: React.ReactNode;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("הועתק");
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("לא הצליח להעתיק");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`העתק ${label ?? value}`}
      className="press inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium border border-transparent active:border-primary/30"
    >
      {icon}
      <span className="select-all" dir="ltr">{value}</span>
      {copied ? (
        <Check className="size-3 text-emerald-600" strokeWidth={2.5} />
      ) : (
        <Copy className="size-3 opacity-60" strokeWidth={2.2} />
      )}
    </button>
  );
}
