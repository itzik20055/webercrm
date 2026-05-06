"use client";

import { useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { LANGUAGE_LABELS, AUDIENCE_LABELS } from "@/db/schema";

const MAX_BYTES = 4 * 1024 * 1024;
const AUDIO_EXT_RE = /\.(opus|m4a|mp3|ogg|wav|aac)$/i;

type Audience = keyof typeof AUDIENCE_LABELS;
type Language = keyof typeof LANGUAGE_LABELS;
type Outcome = "booked" | "lost";

interface UploadResult {
  archiveId: string;
  conversationCount: number;
  scrubStats: { removedPrices: number; removedDates: number; removedTimes: number };
  outcome: "booked" | "lost" | "unknown";
  outcomeConfidence: number;
}

type State =
  | { kind: "idle" }
  | { kind: "stripping" }
  | { kind: "uploading" }
  | { kind: "extracting" }
  | { kind: "done"; result: UploadResult }
  | { kind: "error"; message: string };

async function stripMediaFromZip(file: File): Promise<File> {
  if (!file.name.toLowerCase().endsWith(".zip")) return file;
  const { default: JSZip } = await import("jszip");
  const original = await JSZip.loadAsync(file);
  const filtered = new JSZip();
  let stripped = 0;
  for (const [name, entry] of Object.entries(original.files)) {
    if (entry.dir) continue;
    const lower = name.toLowerCase();
    if (lower.endsWith(".txt") || AUDIO_EXT_RE.test(lower)) {
      const data = await entry.async("uint8array");
      filtered.file(name, data);
    } else {
      stripped++;
    }
  }
  if (stripped === 0) return file;
  const blob = await filtered.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return new File([blob], file.name, { type: "application/zip" });
}

export function ArchiveImportClient() {
  const [file, setFile] = useState<File | null>(null);
  const [audience, setAudience] = useState<Audience>("israeli_haredi");
  const [language, setLanguage] = useState<Language>("he");
  const [outcome, setOutcome] = useState<Outcome>("booked");
  const [state, setState] = useState<State>({ kind: "idle" });

  const onPickFile = (f: File | null) => {
    setFile(f);
    setState({ kind: "idle" });
  };

  const onSubmit = async () => {
    if (!file) return;
    try {
      setState({ kind: "stripping" });
      const cleaned = await stripMediaFromZip(file);
      if (cleaned.size > MAX_BYTES) {
        setState({
          kind: "error",
          message: `הקובץ עדיין גדול מ-4MB אחרי ניקוי מדיה (${(cleaned.size / 1024 / 1024).toFixed(1)}MB). הסר הקלטות קוליות גדולות ונסה שוב.`,
        });
        return;
      }

      setState({ kind: "uploading" });
      const form = new FormData();
      form.append("file", cleaned);
      form.append("audience", audience);
      form.append("language", language);
      form.append("outcome", outcome);

      setState({ kind: "extracting" });
      const res = await fetch("/api/archive/whatsapp", {
        method: "POST",
        body: form,
      });

      const json = (await res.json()) as
        | { ok: true } & UploadResult
        | { error: string };

      if (!res.ok || "error" in json) {
        setState({
          kind: "error",
          message: ("error" in json && json.error) || "שגיאה לא ידועה",
        });
        return;
      }

      setState({ kind: "done", result: json });
      setFile(null);
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const busy =
    state.kind === "stripping" ||
    state.kind === "uploading" ||
    state.kind === "extracting";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="space-y-1">
          <label className="block text-sm font-semibold">קהל</label>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as Audience)}
            disabled={busy}
            className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm"
          >
            {Object.entries(AUDIENCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-semibold">שפה</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            disabled={busy}
            className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm"
          >
            {Object.entries(LANGUAGE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-semibold">תוצאה</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOutcome("booked")}
              disabled={busy}
              className={
                "press flex-1 h-11 rounded-xl border text-sm font-semibold " +
                (outcome === "booked"
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                  : "bg-background border-border")
              }
            >
              סגרתי
            </button>
            <button
              type="button"
              onClick={() => setOutcome("lost")}
              disabled={busy}
              className={
                "press flex-1 h-11 rounded-xl border text-sm font-semibold " +
                (outcome === "lost"
                  ? "bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300"
                  : "bg-background border-border")
              }
            >
              לא סגרתי
            </button>
          </div>
          <p className="text-xs text-muted-foreground pt-1">
            התוצאה היא תיוג ידני שלך — היא משפיעה איך הצ&apos;אט ישלוף את השיחה כשאתה
            מנסח טיוטה ללידים דומים.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <label className="press flex flex-col items-center justify-center gap-2 h-32 rounded-xl border-2 border-dashed border-border cursor-pointer hover:border-primary/40">
          <Upload className="size-6 text-muted-foreground" />
          <span className="text-sm font-medium">
            {file ? file.name : "בחר קובץ ייצוא של וואטסאפ (.txt או .zip)"}
          </span>
          {file && (
            <span className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(0)} KB
            </span>
          )}
          <input
            type="file"
            accept=".txt,.zip,application/zip"
            className="hidden"
            disabled={busy}
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!file || busy}
        className="press w-full h-12 rounded-full bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {state.kind === "stripping" && (
          <>
            <Loader2 className="size-4 animate-spin" />
            מנקה מדיה…
          </>
        )}
        {state.kind === "uploading" && (
          <>
            <Loader2 className="size-4 animate-spin" />
            מעלה…
          </>
        )}
        {state.kind === "extracting" && (
          <>
            <Loader2 className="size-4 animate-spin" />
            מחלץ ארכיטיפ…
          </>
        )}
        {!busy && (
          <>
            <Upload className="size-4" />
            העלה לארכיון
          </>
        )}
      </button>

      {state.kind === "done" && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-4 space-y-2">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-semibold">
            <CheckCircle2 className="size-4" />
            נשמר בארכיון
          </div>
          <ul className="text-sm space-y-1 text-foreground">
            <li>הודעות בשיחה: <strong>{state.result.conversationCount}</strong></li>
            <li>תוצאה: <strong>{state.result.outcome === "booked" ? "סגירה" : state.result.outcome === "lost" ? "אובדן" : "לא ידוע"}</strong></li>
            <li>
              נוקה:&nbsp;
              <strong>{state.result.scrubStats.removedPrices}</strong> מחירים,
              &nbsp;<strong>{state.result.scrubStats.removedDates}</strong> תאריכים,
              &nbsp;<strong>{state.result.scrubStats.removedTimes}</strong> זמנים
            </li>
          </ul>
        </div>
      )}

      {state.kind === "error" && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/25 p-4 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}
