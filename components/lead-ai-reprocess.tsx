"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import {
  reprocessLeadWithAi,
  undoLastReprocess,
  applyFollowupSuggestion,
  dismissFollowupSuggestion,
  applyPrioritySuggestion,
  dismissPrioritySuggestion,
  type PendingFollowupSuggestion,
  type PendingPrioritySuggestion,
} from "@/app/(app)/leads/actions";

const PRIORITY_LABELS: Record<PendingPrioritySuggestion["to"], string> = {
  hot: "חם",
  warm: "פושר",
  cold: "קר",
};

const UNDO_WINDOW_MS = 30_000;

export function LeadAiReprocess({
  leadId,
  lastReprocessedAt,
  followupSuggestion,
  prioritySuggestion,
}: {
  leadId: string;
  lastReprocessedAt: Date | null;
  followupSuggestion: PendingFollowupSuggestion | null;
  prioritySuggestion: PendingPrioritySuggestion | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lastChangeNotes, setLastChangeNotes] = useState<string | null>(null);

  function runReprocess() {
    start(async () => {
      try {
        const result = await reprocessLeadWithAi(leadId);
        setLastChangeNotes(result.changeNotes || null);
        toast.success(result.changeNotes || "הפרופיל עודכן");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "העיבוד נכשל");
      }
    });
  }

  return (
    <section className="bg-card border border-border/70 rounded-2xl p-4 space-y-3 shadow-soft">
      <header className="flex items-center justify-between">
        <h2 className="font-bold text-[13px] tracking-tight text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="size-4" />
          עיבוד AI
        </h2>
      </header>

      <p className="text-xs text-muted-foreground leading-relaxed">
        מפעיל את Claude על כל היסטוריית השיחות ומעדכן סטטוס, עדיפות, התנגדויות,
        תגיות, סיכום ופרטי נופש. פרטי קשר (שם, טלפון, שפה) לא משתנים.
      </p>

      <button
        type="button"
        onClick={runReprocess}
        disabled={pending}
        className="press w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            מעבד...
          </>
        ) : (
          <>
            <Sparkles className="size-4" />
            עיבוד עם AI
          </>
        )}
      </button>

      {lastChangeNotes && !pending && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-1.5">
          <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" />
          <span>{lastChangeNotes}</span>
        </div>
      )}

      {lastReprocessedAt && (
        <UndoBanner
          leadId={leadId}
          reprocessedAt={lastReprocessedAt}
          onDone={() => {
            setLastChangeNotes(null);
            router.refresh();
          }}
        />
      )}

      {followupSuggestion && (
        <FollowupSuggestionCard
          leadId={leadId}
          suggestion={followupSuggestion}
          onDone={() => router.refresh()}
        />
      )}

      {prioritySuggestion && (
        <PrioritySuggestionCard
          leadId={leadId}
          suggestion={prioritySuggestion}
          onDone={() => router.refresh()}
        />
      )}
    </section>
  );
}

function PrioritySuggestionCard({
  leadId,
  suggestion,
  onDone,
}: {
  leadId: string;
  suggestion: PendingPrioritySuggestion;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();

  function approve() {
    start(async () => {
      try {
        await applyPrioritySuggestion(leadId);
        toast.success(`עדיפות עודכנה ל${PRIORITY_LABELS[suggestion.to]}`);
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "שמירה נכשלה");
      }
    });
  }

  function dismiss() {
    start(async () => {
      try {
        await dismissPrioritySuggestion(leadId);
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "נכשל");
      }
    });
  }

  return (
    <div className="rounded-xl bg-primary-soft border border-primary/20 p-3 space-y-2.5">
      <div className="flex items-start gap-2">
        <AlertCircle className="size-4 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-primary">
            הצעת AI: עדיפות {PRIORITY_LABELS[suggestion.from]} → {PRIORITY_LABELS[suggestion.to]}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
            הליד נשמר ב{PRIORITY_LABELS[suggestion.from]} עד שתאשר.
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="press flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          אשר
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          className="press h-9 px-3 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center gap-1"
          aria-label="דלג"
        >
          <X className="size-3.5" />
          דלג
        </button>
      </div>
    </div>
  );
}

function UndoBanner({
  leadId,
  reprocessedAt,
  onDone,
}: {
  leadId: string;
  reprocessedAt: Date;
  onDone: () => void;
}) {
  const expiresAt = reprocessedAt.getTime() + UNDO_WINDOW_MS;
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, expiresAt - Date.now())
  );
  const [pending, start] = useTransition();

  useEffect(() => {
    if (remaining <= 0) return;
    const tick = setInterval(() => {
      const left = Math.max(0, expiresAt - Date.now());
      setRemaining(left);
      if (left <= 0) clearInterval(tick);
    }, 500);
    return () => clearInterval(tick);
  }, [expiresAt, remaining]);

  if (remaining <= 0) return null;

  function runUndo() {
    start(async () => {
      try {
        await undoLastReprocess(leadId);
        toast.success("העיבוד בוטל");
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "ביטול נכשל");
      }
    });
  }

  const secondsLeft = Math.ceil(remaining / 1000);
  return (
    <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-2.5 flex items-center justify-between gap-2">
      <div className="text-xs text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
        <RotateCcw className="size-3.5 shrink-0" />
        <span>ניתן לבטל ({secondsLeft} שנ&apos;)</span>
      </div>
      <button
        type="button"
        onClick={runUndo}
        disabled={pending}
        className="press h-8 px-3 rounded-full bg-amber-500/20 text-amber-900 dark:text-amber-100 text-xs font-semibold disabled:opacity-50 flex items-center gap-1"
      >
        {pending && <Loader2 className="size-3 animate-spin" />}
        בטל עיבוד
      </button>
    </div>
  );
}

function FollowupSuggestionCard({
  leadId,
  suggestion,
  onDone,
}: {
  leadId: string;
  suggestion: PendingFollowupSuggestion;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();

  function approve() {
    start(async () => {
      try {
        await applyFollowupSuggestion(leadId);
        toast.success(
          suggestion.action === "cancel" ? "הפולואפ בוטל" : "הפולואפ עודכן"
        );
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "שמירה נכשלה");
      }
    });
  }

  function dismiss() {
    start(async () => {
      try {
        await dismissFollowupSuggestion(leadId);
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "נכשל");
      }
    });
  }

  const isReschedule = suggestion.action === "reschedule";
  const dueLabel = isReschedule
    ? format(new Date(suggestion.dueAt), "d בMMM HH:mm", { locale: he })
    : null;

  return (
    <div className="rounded-xl bg-primary-soft border border-primary/20 p-3 space-y-2.5">
      <div className="flex items-start gap-2">
        {isReschedule ? (
          <BellRing className="size-4 text-primary mt-0.5 shrink-0" />
        ) : (
          <AlertCircle className="size-4 text-primary mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-primary">
            {isReschedule
              ? `הצעת AI: הזז פולואפ ל-${dueLabel}`
              : "הצעת AI: בטל את הפולואפ"}
          </div>
          {isReschedule && suggestion.reason && (
            <div className="text-xs text-foreground/80 mt-0.5">
              {suggestion.reason}
            </div>
          )}
          <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
            {suggestion.reasoning}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="press flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          אשר
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          className="press h-9 px-3 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center gap-1"
          aria-label="דלג"
        >
          <X className="size-3.5" />
          דלג
        </button>
      </div>
    </div>
  );
}
