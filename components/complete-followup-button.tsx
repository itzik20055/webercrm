"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { completeFollowup } from "@/app/(app)/leads/actions";

export function CompleteFollowupButton({
  followupId,
  leadId,
  label = "סמן כבוצע",
}: {
  followupId: string;
  leadId: string;
  label?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            await completeFollowup(followupId, leadId);
            toast.success("בוצע ✓");
          } catch {
            toast.error("שמירה נכשלה");
          }
        })
      }
      className="press inline-flex items-center gap-1.5 px-3.5 h-10 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-sm font-semibold disabled:opacity-50"
    >
      <Check className="size-4" />
      {label}
    </button>
  );
}
