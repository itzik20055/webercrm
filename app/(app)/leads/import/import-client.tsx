"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Loader2, AlertCircle } from "lucide-react";
import { LANGUAGE_LABELS } from "@/db/schema";

interface EnqueueResponse {
  ok: boolean;
  id: string;
  status: "pending" | "processing" | "done" | "failed" | "merged" | "dismissed";
  duplicate?: boolean;
  error?: string;
}

const MAX_BYTES = 100 * 1024 * 1024;

function formatMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1);
}

export function ImportClient({ myName }: { myName: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<"he" | "en" | "yi">("he");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooLarge = file && file.size > MAX_BYTES;

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(
        `הקובץ ${formatMB(file.size)}MB - מעל המקסימום של 100MB. ייצא שוב מוואטסאפ ללא מדיה, או מחק הודעות קוליות ישנות מהצ'אט ונסה שוב.`
      );
      return;
    }
    setError(null);
    setSubmitting(true);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("language", language);

    try {
      const res = await fetch("/api/leads/import-whatsapp", {
        method: "POST",
        body: fd,
      });

      // Read body as text first so we can show the user what actually came
      // back when JSON parsing fails (e.g. when Vercel/CDN returns an HTML
      // error page that we'd otherwise hide behind a generic browser error).
      const bodyText = await res.text();
      let json: EnqueueResponse | null = null;
      try {
        json = JSON.parse(bodyText) as EnqueueResponse;
      } catch {
        const preview = bodyText.slice(0, 300).replace(/\s+/g, " ").trim();
        throw new Error(
          `השרת החזיר תשובה לא תקינה (${res.status}): ${preview || "(ריק)"}`
        );
      }

      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `שגיאה בהעלאה (HTTP ${res.status})`);
      }
      if (json.duplicate) {
        toast.success("הקובץ כבר הועלה — מפנה אותך לסקירה");
      } else {
        toast.success("נקלט! העיבוד רץ ברקע — תראה התראה ב-Inbox");
      }
      router.push("/inbox");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[whatsapp-import] upload failed:", err);
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleUpload} className="space-y-4">
      <div className="rounded-2xl border bg-card p-4 space-y-3 shadow-soft">
        <div className="text-sm text-muted-foreground">
          השם שלך בוואטסאפ:{" "}
          <strong className="text-foreground">{myName}</strong>
        </div>

        <label
          className={
            "flex items-center justify-center w-full h-32 rounded-xl border-2 border-dashed cursor-pointer focus-within:ring-2 focus-within:ring-primary/40 " +
            (tooLarge
              ? "border-destructive/50 bg-destructive/5"
              : "hover:bg-accent")
          }
        >
          <input
            type="file"
            accept=".zip,.txt"
            onChange={(e) => {
              setError(null);
              setFile(e.target.files?.[0] ?? null);
            }}
            className="sr-only"
            disabled={submitting}
          />
          <div className="text-center space-y-1">
            <Upload className="size-6 mx-auto text-muted-foreground" />
            <div className="text-sm font-medium">
              {file ? file.name : "בחר קובץ ZIP מוואטסאפ"}
            </div>
            {file ? (
              <div
                className={
                  "text-xs tabular-nums " +
                  (tooLarge ? "text-destructive font-semibold" : "text-muted-foreground")
                }
              >
                {formatMB(file.size)}MB
                {tooLarge && " - גדול מדי (מקס׳ 100MB)"}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                .zip (כולל מדיה) או .txt · עד 100MB
              </div>
            )}
          </div>
        </label>

        <div>
          <label className="text-sm font-medium block mb-1.5">
            שפה עיקרית בשיחה
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {(["he", "en", "yi"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLanguage(l)}
                disabled={submitting}
                aria-pressed={language === l}
                className={
                  "press h-11 rounded-lg border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
                  (language === l
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background")
                }
              >
                {LANGUAGE_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
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
        disabled={!file || submitting || Boolean(tooLarge)}
        className="press w-full h-12 rounded-full bg-primary text-primary-foreground font-semibold disabled:opacity-50 shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {submitting ? "שולח..." : "שלח לעיבוד"}
      </button>

      <p className="text-xs text-muted-foreground text-center">
        העיבוד רץ ברקע. תמצא את הליד ב-Inbox תוך דקה, מוכן לאישור.
      </p>
    </form>
  );
}
