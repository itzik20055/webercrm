"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { runEmailSyncNow } from "./email-sync-actions";

interface EnqueueResponse {
  ok: boolean;
  id: string;
  status: "pending" | "processing" | "done" | "failed" | "merged" | "dismissed";
  duplicate?: boolean;
  error?: string;
}

export function ImportEmailClient() {
  const router = useRouter();
  const [emailAddress, setEmailAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, startSync] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const addr = emailAddress.trim();
    if (!addr) return;
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/leads/import-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailAddress: addr }),
      });
      const json = (await res.json()) as EnqueueResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "שגיאה בייבוא");
      }
      if (json.duplicate) {
        toast.success("הכתובת כבר בתור — מפנה אותך לסקירה");
      } else {
        toast.success("נקלט! AI מעבד את ההתכתבות — תראה התראה ב-Inbox");
      }
      router.push("/inbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="rounded-2xl border bg-card p-4 space-y-3 shadow-soft">
        <label className="block">
          <span className="text-sm font-medium block mb-1.5">
            כתובת מייל של הלקוח
          </span>
          <div className="relative">
            <Mail className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 rtl:left-auto rtl:right-3" />
            <input
              type="email"
              dir="ltr"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              disabled={submitting}
              placeholder="customer@example.com"
              className="w-full h-11 rounded-lg border bg-background px-3 pl-9 rtl:pl-3 rtl:pr-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            />
          </div>
        </label>

        <p className="text-xs text-muted-foreground leading-relaxed">
          AI ישלוף את כל ההתכתבות משני הכיוונים מה-1 באפריל 2026 והלאה, יחלץ
          ליד ויפנה אותך לאישור או מיזוג ב-Inbox.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive flex items-start gap-2"
        >
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!emailAddress.trim() || submitting}
        className="press w-full h-12 rounded-full bg-primary text-primary-foreground font-semibold disabled:opacity-50 shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {submitting ? "שולח לעיבוד..." : "ייבא התכתבות"}
      </button>

      <button
        type="button"
        disabled={syncing}
        onClick={() =>
          startSync(async () => {
            try {
              const result = await runEmailSyncNow();
              const s = result.sync;
              if (s.paused) {
                toast.message("סנכרון מושהה בהגדרות");
                return;
              }
              const batches = s.batchesCreated + s.batchesAppended;
              if (batches === 0 && result.importsDrained === 0) {
                toast.success("אין הודעות חדשות");
              } else {
                const parts: string[] = [];
                if (result.importsDrained > 0) {
                  parts.push(`${result.importsDrained} ייבוא/ים עובדו`);
                }
                if (batches > 0) {
                  parts.push(`${batches} באצ'ים חדשים ב-Inbox`);
                }
                toast.success(parts.join(" · "));
                router.refresh();
              }
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err));
            }
          })
        }
        className="press w-full h-11 rounded-full border border-border bg-card text-sm font-medium text-foreground disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {syncing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        {syncing ? "מסנכרן..." : "סנכרן מיילים עכשיו"}
      </button>
      <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
        הקרון רץ אוטומטית כל 4 שעות. הכפתור מאלץ סנכרון מיידי של הכתובות
        שכבר במעקב.
      </p>
    </form>
  );
}
