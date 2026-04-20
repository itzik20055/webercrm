"use client";

import { useState } from "react";
import { addHours, addDays, format, setHours, setMinutes } from "date-fns";
import { cn } from "@/lib/utils";

const QUICK_OPTIONS = [
  { label: "בעוד שעה", build: () => addHours(new Date(), 1) },
  { label: "בעוד 4 שעות", build: () => addHours(new Date(), 4) },
  {
    label: "מחר 9:00",
    build: () => setMinutes(setHours(addDays(new Date(), 1), 9), 0),
  },
  {
    label: "מחר 14:00",
    build: () => setMinutes(setHours(addDays(new Date(), 1), 14), 0),
  },
  { label: "בעוד 3 ימים", build: () => addDays(new Date(), 3) },
  { label: "שבוע", build: () => addDays(new Date(), 7) },
];

function toLocalInput(d: Date) {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

export function FollowupQuickForm({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const [dueLocal, setDueLocal] = useState(() =>
    toLocalInput(addHours(new Date(), 24))
  );

  return (
    <form action={action} className="space-y-5">
      <fieldset>
        <legend className="text-sm font-medium block mb-2">בחירה מהירה</legend>
        <div className="grid grid-cols-2 gap-2">
          {QUICK_OPTIONS.map((o) => {
            const d = o.build();
            const v = toLocalInput(d);
            const active = v === dueLocal;
            return (
              <button
                key={o.label}
                type="button"
                onClick={() => setDueLocal(v)}
                aria-pressed={active}
                className={cn(
                  "press h-12 rounded-lg border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card"
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="dueAt" className="text-sm font-medium block mb-1.5">
          זמן מדויק
        </label>
        <input
          id="dueAt"
          name="dueAt"
          type="datetime-local"
          required
          value={dueLocal}
          onChange={(e) => setDueLocal(e.target.value)}
          className="w-full h-12 px-3 rounded-lg border border-input bg-card text-base focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div>
        <label htmlFor="reason" className="text-sm font-medium block mb-1.5">
          סיבה / מה לזכור
        </label>
        <input
          id="reason"
          name="reason"
          placeholder="לחזור עם מחיר, מחכה לבת זוג..."
          className="w-full h-12 px-3 rounded-lg border border-input bg-card text-base focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <button
        type="submit"
        className="press w-full h-12 rounded-lg bg-primary text-primary-foreground font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
      >
        קבע פולואפ
      </button>
    </form>
  );
}
