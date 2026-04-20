"use client";

import { useState, useTransition } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { deleteLead } from "@/app/(app)/leads/actions";

export function DeleteLeadButton({
  leadId,
  leadName,
}: {
  leadId: string;
  leadName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press size-10 rounded-full flex items-center justify-center hover:bg-destructive/10 text-destructive"
        aria-label="מחיקת ליד"
      >
        <Trash2 className="size-[16px]" />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="bg-card w-full sm:w-auto sm:min-w-[360px] sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-border p-5 space-y-4 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="size-10 rounded-full bg-destructive/12 text-destructive flex items-center justify-center shrink-0">
                <AlertTriangle className="size-5" strokeWidth={2.2} />
              </div>
              <div>
                <h3 className="font-bold tracking-tight">למחוק את הליד?</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  הפעולה תמחק לצמיתות את{" "}
                  <strong className="text-foreground">{leadName}</strong>, כולל
                  היסטוריית שיחות ופולואפים. לא ניתן לשחזר.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="press flex-1 h-11 rounded-full bg-secondary text-secondary-foreground font-medium text-sm"
              >
                ביטול
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteLead(leadId);
                  })
                }
                className="press flex-1 h-11 rounded-full bg-destructive text-destructive-foreground font-semibold text-sm disabled:opacity-60"
              >
                {pending ? "מוחק…" : "מחק"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
