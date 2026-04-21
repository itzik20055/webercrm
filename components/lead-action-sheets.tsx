"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, addHours, format, setHours, setMinutes } from "date-fns";
import { toast } from "sonner";
import {
  BellRing,
  Loader2,
  MessageSquarePlus,
  X,
} from "lucide-react";
import { logInteraction, scheduleFollowup } from "@/app/(app)/leads/actions";
import { INTERACTION_TYPE_LABELS } from "@/db/schema";
import { cn } from "@/lib/utils";

type SheetMode = null | "log" | "followup";

export function LeadQuickActions({ leadId }: { leadId: string }) {
  const [mode, setMode] = useState<SheetMode>(null);

  return (
    <>
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+72px)] inset-x-0 px-4 z-20 pointer-events-none">
        <div className="max-w-lg mx-auto flex gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={() => setMode("log")}
            className="press flex-1 h-12 rounded-full bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <MessageSquarePlus className="size-5" strokeWidth={2.2} />
            תיעוד שיחה
          </button>
          <button
            type="button"
            onClick={() => setMode("followup")}
            className="press h-12 px-5 rounded-full bg-card border border-border font-semibold flex items-center justify-center gap-2 shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <BellRing className="size-5" strokeWidth={2.2} />
            פולואפ
          </button>
        </div>
      </div>

      <Sheet open={mode === "log"} onClose={() => setMode(null)} title="תיעוד שיחה">
        <LogForm leadId={leadId} onDone={() => setMode(null)} />
      </Sheet>
      <Sheet
        open={mode === "followup"}
        onClose={() => setMode(null)}
        title="קביעת פולואפ"
      >
        <FollowupForm leadId={leadId} onDone={() => setMode(null)} />
      </Sheet>
    </>
  );
}

function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full sm:max-w-md bg-card border-t sm:border border-border rounded-t-3xl sm:rounded-3xl shadow-soft p-4 space-y-4 max-h-[90dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[15px]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className="press size-8 rounded-full hover:bg-accent/40 flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto -mx-4 px-4">{children}</div>
      </div>
    </div>
  );
}

function LogForm({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  const router = useRouter();
  const [type, setType] = useState<"whatsapp" | "call_in" | "call_out" | "email" | "sms" | "note">(
    "whatsapp"
  );
  const [direction, setDirection] = useState<"in" | "out" | "internal">("in");
  const [content, setContent] = useState("");
  const [duration, setDuration] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    const fd = new FormData();
    fd.set("leadId", leadId);
    fd.set("type", type);
    fd.set("direction", direction);
    fd.set("content", content);
    if (duration) fd.set("durationMin", duration);
    start(async () => {
      try {
        await logInteraction(fd);
        toast.success("השיחה תועדה");
        router.refresh();
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "שמירה נכשלה");
      }
    });
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setContent((c) => (c ? `${c}\n\n${t}` : t));
    } catch {
      toast.error("לא ניתן לקרוא מהלוח");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3.5 pb-2">
      <div>
        <label htmlFor="log-type" className="text-xs font-medium block mb-1 text-muted-foreground">
          סוג
        </label>
        <select
          id="log-type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {Object.entries(INTERACTION_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="text-xs font-medium block mb-1 text-muted-foreground">כיוון</legend>
        <div className="grid grid-cols-3 gap-2">
          {[
            { v: "in" as const, l: "נכנס" },
            { v: "out" as const, l: "יוצא" },
            { v: "internal" as const, l: "פנימי" },
          ].map((d) => (
            <button
              key={d.v}
              type="button"
              onClick={() => setDirection(d.v)}
              aria-pressed={direction === d.v}
              className={cn(
                "press h-10 rounded-xl border text-sm font-medium",
                direction === d.v
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border"
              )}
            >
              {d.l}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="log-content" className="text-xs font-medium text-muted-foreground">
            תוכן <span className="text-destructive">*</span>
          </label>
          <button
            type="button"
            onClick={pasteFromClipboard}
            className="text-[11px] font-medium text-primary press"
          >
            הדבק מהלוח
          </button>
        </div>
        <textarea
          id="log-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={7}
          required
          autoFocus
          placeholder="תוכן השיחה / הודעה / סיכום..."
          className="w-full text-sm rounded-xl border border-border bg-background p-3 resize-y placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
          dir="auto"
        />
      </div>

      <div>
        <label htmlFor="log-duration" className="text-xs font-medium block mb-1 text-muted-foreground">
          משך (דקות) <span className="text-muted-foreground/60 font-normal">— לשיחות בלבד</span>
        </label>
        <input
          id="log-duration"
          type="number"
          inputMode="numeric"
          min={0}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <button
        type="submit"
        disabled={pending || !content.trim()}
        className="press w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        שמור תיעוד
      </button>
    </form>
  );
}

const QUICK_FU = [
  { label: "בעוד שעה", build: () => addHours(new Date(), 1) },
  { label: "בעוד 4 שעות", build: () => addHours(new Date(), 4) },
  { label: "מחר 9:00", build: () => setMinutes(setHours(addDays(new Date(), 1), 9), 0) },
  { label: "מחר 14:00", build: () => setMinutes(setHours(addDays(new Date(), 1), 14), 0) },
  { label: "בעוד 3 ימים", build: () => addDays(new Date(), 3) },
  { label: "שבוע", build: () => addDays(new Date(), 7) },
];

function toLocalInput(d: Date) {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

function FollowupForm({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  const router = useRouter();
  const [due, setDue] = useState(() => toLocalInput(addHours(new Date(), 24)));
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("leadId", leadId);
    fd.set("dueAt", due);
    if (reason.trim()) fd.set("reason", reason.trim());
    start(async () => {
      try {
        await scheduleFollowup(fd);
        toast.success("הפולואפ נקבע");
        router.refresh();
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "שמירה נכשלה");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <fieldset>
        <legend className="text-xs font-medium block mb-1.5 text-muted-foreground">
          בחירה מהירה
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {QUICK_FU.map((o) => {
            const v = toLocalInput(o.build());
            const active = v === due;
            return (
              <button
                key={o.label}
                type="button"
                onClick={() => setDue(v)}
                aria-pressed={active}
                className={cn(
                  "press h-10 rounded-xl border text-sm font-medium",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border"
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="fu-due" className="text-xs font-medium block mb-1 text-muted-foreground">
          זמן מדויק
        </label>
        <input
          id="fu-due"
          type="datetime-local"
          required
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div>
        <label htmlFor="fu-reason" className="text-xs font-medium block mb-1 text-muted-foreground">
          סיבה / מה לזכור
        </label>
        <input
          id="fu-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="לחזור עם מחיר, מחכה לבת זוג..."
          className="w-full h-11 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="press w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        קבע פולואפ
      </button>
    </form>
  );
}
