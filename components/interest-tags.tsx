"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { toggleInterestTag } from "@/app/(app)/leads/actions";
import { INTEREST_TAG_LABELS } from "@/db/schema";
import { cn } from "@/lib/utils";

const ALL_TAGS = Object.keys(INTEREST_TAG_LABELS);

export function InterestTags({
  leadId,
  selected,
}: {
  leadId: string;
  selected: string[];
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_TAGS.map((tag) => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  await toggleInterestTag(leadId, tag);
                } catch {
                  toast.error("שמירה נכשלה");
                }
              })
            }
            className={cn(
              "px-3 h-7 rounded-full text-xs font-medium transition",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground"
            )}
          >
            {INTEREST_TAG_LABELS[tag]}
          </button>
        );
      })}
    </div>
  );
}
