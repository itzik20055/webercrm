"use client";

import { useState, useTransition } from "react";
import { Download, RefreshCw, AlertTriangle, CheckCircle2, SkipForward } from "lucide-react";
import {
  pullCallRecordingsNow,
  skipPastCallRecordings,
  getCallRecordingsStatus,
} from "./call-recordings-actions";
import type { PullResult } from "@/lib/call-recordings-runner";

type Status =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; total: number; pending: number }
  | { state: "error"; message: string };

type PullState =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; result: PullResult }
  | { state: "error"; message: string };

export function CallRecordingsPanel({
  initial,
}: {
  initial: { total: number; pending: number } | { error: string };
}) {
  const [status, setStatus] = useState<Status>(
    "error" in initial
      ? { state: "error", message: initial.error }
      : { state: "ok", total: initial.total, pending: initial.pending }
  );
  const [pull, setPull] = useState<PullState>({ state: "idle" });
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [skipMessage, setSkipMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const refreshStatus = () => {
    setStatus({ state: "loading" });
    startTransition(async () => {
      const r = await getCallRecordingsStatus();
      if (r.ok) {
        setStatus({ state: "ok", total: r.total, pending: r.pending });
      } else {
        setStatus({ state: "error", message: r.error });
      }
    });
  };

  const doPull = () => {
    setPull({ state: "running" });
    startTransition(async () => {
      try {
        const result = await pullCallRecordingsNow();
        setPull({ state: "done", result });
        refreshStatus();
      } catch (e) {
        setPull({
          state: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    });
  };

  const doSkip = () => {
    setConfirmSkip(false);
    setSkipMessage(null);
    startTransition(async () => {
      try {
        const r = await skipPastCallRecordings();
        setSkipMessage(
          r.skipped === 0
            ? "אין הקלטות ישנות בחלון — כבר הכול נקי."
            : `${r.skipped} הקלטות ישנות סומנו כמטופלות. מכאן והלאה רק שיחות חדשות ייכנסו.`
        );
        refreshStatus();
      } catch (e) {
        setPull({
          state: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        ה-cron מושך אוטומטית כל 10 דקות רק שיחות חדשות. הכפתור "דלג על ישנות"
        מסמן את כל ההקלטות הנוכחיות בתור "לא צריך לעבד" — מכאן והלאה רק
        שיחות שיגיעו מעכשיו ואילך ייכנסו לתיבה.
      </p>

      <div className="rounded-xl bg-background border border-border p-3">
        {status.state === "loading" && (
          <p className="text-sm text-muted-foreground">טוען סטטוס…</p>
        )}
        {status.state === "error" && (
          <p className="text-sm text-destructive flex items-start gap-1.5">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>{status.message}</span>
          </p>
        )}
        {status.state === "ok" && (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">
                ב-14 הימים האחרונים
              </div>
              <div className="text-sm mt-0.5">
                <strong className="text-base font-bold tabular-nums">
                  {status.pending}
                </strong>{" "}
                מחכות לעיבוד · {status.total} בסך הכל
              </div>
            </div>
            <button
              type="button"
              onClick={refreshStatus}
              className="press size-9 rounded-full border border-border flex items-center justify-center"
              aria-label="רענן סטטוס"
            >
              <RefreshCw className="size-4" />
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={doPull}
          disabled={pull.state === "running"}
          className="press flex-1 h-11 rounded-full bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          <Download className="size-4" strokeWidth={2.2} />
          {pull.state === "running" ? "מושך…" : "משוך עכשיו"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmSkip(true)}
          disabled={pull.state === "running"}
          className="press h-11 px-4 rounded-full bg-card border border-border font-medium text-sm flex items-center gap-1.5"
        >
          <SkipForward className="size-4" />
          דלג על ישנות
        </button>
      </div>

      {pull.state === "done" && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-3 text-sm space-y-1">
          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-semibold">
            <CheckCircle2 className="size-4" />
            סיים ב-{Math.round(pull.result.durationMs / 1000)} שניות
          </div>
          <div className="text-muted-foreground">
            נוצרו{" "}
            <strong className="text-foreground">{pull.result.succeeded}</strong>,
            דולגו{" "}
            <strong className="text-foreground">{pull.result.skipped}</strong>,
            נכשלו{" "}
            <strong className="text-foreground">{pull.result.failed}</strong>.
            {pull.result.stoppedEarly && (
              <span className="block text-amber-600 mt-0.5">
                נעצר מוקדם לפני timeout — לחץ שוב כדי להמשיך.
              </span>
            )}
          </div>
        </div>
      )}

      {pull.state === "error" && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/25 p-3 text-sm text-destructive flex items-start gap-1.5">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>{pull.message}</span>
        </div>
      )}

      {skipMessage && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-3 text-sm flex items-start gap-1.5">
          <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-emerald-700 dark:text-emerald-300" />
          <span className="text-foreground">{skipMessage}</span>
        </div>
      )}

      {confirmSkip && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={() => setConfirmSkip(false)}
        >
          <div
            className="bg-card w-full sm:w-auto sm:min-w-[360px] sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-border p-5 space-y-4 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="size-10 rounded-full bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
                <SkipForward className="size-5" strokeWidth={2.2} />
              </div>
              <div>
                <h3 className="font-bold tracking-tight">לדלג על כל הישנות?</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  כל ההקלטות שמחכות כרגע בתיבת המייל יסומנו כמטופלות מבלי
                  לעבד אותן. מהרגע הזה והלאה, רק שיחות חדשות שיגיעו ממעכשיו
                  ייכנסו לתיבה. פעולה חד-פעמית — לעשות כשמתחילים עונה נקייה.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmSkip(false)}
                className="press flex-1 h-11 rounded-full bg-secondary text-secondary-foreground font-medium text-sm"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={doSkip}
                className="press flex-1 h-11 rounded-full bg-amber-500 text-white font-semibold text-sm"
              >
                דלג
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
