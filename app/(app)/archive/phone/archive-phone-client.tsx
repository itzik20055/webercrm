"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Play, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; total: number }
  | { kind: "error"; message: string };

type BatchState =
  | { kind: "idle" }
  | { kind: "starting" }
  | {
      kind: "processing";
      batchId: string;
      processed: number;
      success: number;
      failure: number;
    }
  | {
      kind: "done";
      batchId: string;
      success: number;
      failure: number;
    }
  | { kind: "error"; message: string };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function ArchivePhoneClient() {
  const [dateFrom, setDateFrom] = useState(daysAgoIso(7));
  const [dateTo, setDateTo] = useState(todayIso());
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [batch, setBatch] = useState<BatchState>({ kind: "idle" });
  const pollRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const onPreview = async () => {
    setPreview({ kind: "loading" });
    try {
      const res = await fetch("/api/archive/phone/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPreview({ kind: "error", message: json.error ?? "שגיאה" });
        return;
      }
      setPreview({ kind: "ok", total: json.total });
    } catch (e) {
      setPreview({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const pollBatch = async (batchId: string) => {
    try {
      const res = await fetch("/api/archive/phone/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setBatch({ kind: "error", message: json.error ?? "שגיאה" });
        if (pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
        return;
      }
      if (json.status === "done") {
        setBatch({
          kind: "done",
          batchId,
          success: json.successCount,
          failure: json.failureCount,
        });
        if (pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } else if (json.status === "failed") {
        setBatch({
          kind: "error",
          message: json.error ?? "הריצה נכשלה",
        });
        if (pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } else {
        setBatch({
          kind: "processing",
          batchId,
          processed: json.processedCount,
          success: json.successCount,
          failure: json.failureCount,
        });
      }
    } catch (e) {
      console.error("[archive-phone] poll failed", e);
    }
  };

  const onStart = async () => {
    setBatch({ kind: "starting" });
    try {
      const res = await fetch("/api/archive/phone/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      const json = await res.json();
      if (!res.ok) {
        setBatch({ kind: "error", message: json.error ?? "שגיאה" });
        return;
      }
      const batchId = json.batchId as string;
      setBatch({
        kind: "processing",
        batchId,
        processed: 0,
        success: 0,
        failure: 0,
      });
      // Poll every 5s by re-invoking /run, which both advances the batch and
      // returns its current state. The worker is idempotent — concurrent calls
      // on the same batch race harmlessly via the (importBatchId, phoneHash)
      // dedup, but in practice calls are spaced 5s apart so there's no real
      // overlap.
      pollRef.current = window.setInterval(() => pollBatch(batchId), 5000);
      pollBatch(batchId);
    } catch (e) {
      setBatch({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-1">מתאריך</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">עד תאריך</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onPreview}
          disabled={preview.kind === "loading"}
          className="press w-full h-11 rounded-xl border border-border bg-background font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {preview.kind === "loading" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          {preview.kind === "loading" ? "סופר…" : "ספור הקלטות בטווח"}
        </button>

        {preview.kind === "ok" && (
          <div className="rounded-xl bg-blue-500/10 border border-blue-500/25 p-3 text-sm">
            נמצאו <strong className="tabular-nums">{preview.total}</strong>{" "}
            הקלטות בטווח. ההערכה: שיחה אחת ללקוח דורשת ~30 שניות עיבוד.
          </div>
        )}
        {preview.kind === "error" && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/25 p-3 text-sm text-destructive flex items-start gap-1.5">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>{preview.message}</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={
          preview.kind !== "ok" ||
          preview.total === 0 ||
          batch.kind === "starting" ||
          batch.kind === "processing"
        }
        className="press w-full h-12 rounded-full bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {batch.kind === "starting" ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            יוצר ריצה…
          </>
        ) : batch.kind === "processing" ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            מעבד… ({batch.success} הצליחו, {batch.failure} נכשלו)
          </>
        ) : (
          <>
            <Play className="size-4" />
            התחל עיבוד
          </>
        )}
      </button>

      {batch.kind === "processing" && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 p-3 text-sm">
          הריצה רצה ברקע. דף זה מעדכן כל 5 שניות. אפשר לעבור לטאב אחר ולחזור.
        </div>
      )}

      {batch.kind === "done" && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-semibold">
            <CheckCircle2 className="size-4" />
            הריצה הסתיימה
          </div>
          <div className="text-sm text-foreground">
            <strong>{batch.success}</strong> שיחות עובדו בהצלחה,{" "}
            <strong>{batch.failure}</strong> נכשלו.
          </div>
        </div>
      )}

      {batch.kind === "error" && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/25 p-3 text-sm text-destructive flex items-start gap-1.5">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>{batch.message}</span>
        </div>
      )}
    </div>
  );
}
