"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { upload } from "@vercel/blob/client";
import { Upload, Loader2, AlertCircle } from "lucide-react";
import { LANGUAGE_LABELS } from "@/db/schema";

const MAX_BYTES = 100 * 1024 * 1024;
const AUDIO_EXT_RE = /\.(opus|m4a|mp3|ogg|wav|aac)$/i;

function formatMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * Strip images/videos from a WhatsApp ZIP before upload — the AI only ever
 * looks at the chat text + audio transcripts, so any other media just costs
 * bandwidth and Blob storage. Returns a new (typically much smaller) File.
 * Plain .txt files pass through untouched.
 */
async function stripMediaFromZip(
  file: File,
  onStatus: (message: string) => void
): Promise<{ file: File; stripped: number; originalSize: number }> {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return { file, stripped: 0, originalSize: file.size };
  }
  const { default: JSZip } = await import("jszip");
  onStatus("מנקה תמונות וסרטונים…");
  const original = await JSZip.loadAsync(file);
  const filtered = new JSZip();

  let stripped = 0;
  for (const [name, entry] of Object.entries(original.files)) {
    if (entry.dir) continue;
    const lower = name.toLowerCase();
    const keep = lower.endsWith(".txt") || AUDIO_EXT_RE.test(lower);
    if (keep) {
      const data = await entry.async("uint8array");
      filtered.file(name, data);
    } else {
      stripped++;
    }
  }

  if (stripped === 0) {
    return { file, stripped: 0, originalSize: file.size };
  }

  const blob = await filtered.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });
  const cleaned = new File([blob], file.name, { type: "application/zip" });
  return { file: cleaned, stripped, originalSize: file.size };
}

export function ImportClient({ myName }: { myName: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<"he" | "en" | "yi">("he");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pre-strip size check is deliberately generous — we'll strip media client-
  // side, and a 200MB ZIP often shrinks to 5-20MB once images/videos are out.
  const PRE_STRIP_LIMIT = 500 * 1024 * 1024;
  const tooLarge = file && file.size > PRE_STRIP_LIMIT;

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > PRE_STRIP_LIMIT) {
      setError(
        `הקובץ ${formatMB(file.size)}MB - גדול מדי לעיבוד אפילו אחרי ניקוי מדיה (תקרה ${formatMB(PRE_STRIP_LIMIT)}MB).`
      );
      return;
    }
    setError(null);
    setSubmitting(true);
    setProgress(null);
    setStatusMessage(null);

    try {
      const { file: cleaned, stripped, originalSize } = await stripMediaFromZip(
        file,
        setStatusMessage
      );

      if (stripped > 0) {
        const before = formatMB(originalSize);
        const after = formatMB(cleaned.size);
        toast.success(`הוסרו ${stripped} תמונות/סרטונים — מ-${before}MB ל-${after}MB`);
      }

      if (cleaned.size > MAX_BYTES) {
        throw new Error(
          `אחרי ניקוי המדיה הקובץ עדיין ${formatMB(cleaned.size)}MB (מקסימום ${formatMB(MAX_BYTES)}MB). ככל הנראה יש כמות גדולה מאוד של הודעות קוליות.`
        );
      }

      setStatusMessage("מעלה…");
      setProgress(0);

      // Direct-to-Blob upload bypasses the 4.5MB Vercel function body limit.
      // The handleUpload route validates auth, returns a token, then we PUT
      // straight to Blob; on completion the same route ingests + queues.
      //
      // multipart=false: @vercel/blob defaults to multipart for files >5MB,
      // but iOS Safari hangs intermittently on a part boundary (the upload
      // freezes at a fixed % and never resumes). Single-PUT works reliably
      // for our range; the cleaned ZIP is rarely above 50MB.
      await upload(cleaned.name, cleaned, {
        access: "public",
        handleUploadUrl: "/api/leads/import-whatsapp/upload",
        clientPayload: JSON.stringify({ language, filename: cleaned.name }),
        onUploadProgress: (e) => setProgress(e.percentage),
        multipart: false,
      });

      toast.success("נקלט! העיבוד רץ ברקע — תראה התראה ב-Inbox");
      router.push("/inbox");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[whatsapp-import] upload failed:", err);
      setError(message);
      setSubmitting(false);
      setProgress(null);
      setStatusMessage(null);
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
                {tooLarge && ` - גדול מדי (מקס׳ ${formatMB(PRE_STRIP_LIMIT)}MB)`}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                .zip (כולל מדיה) או .txt · תמונות וסרטונים מסוננים אוטומטית
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
        {submitting
          ? progress != null && progress < 100
            ? `מעלה ${Math.round(progress)}%`
            : statusMessage ?? "מעבד…"
          : "שלח לעיבוד"}
      </button>

      <p className="text-xs text-muted-foreground text-center">
        העיבוד רץ ברקע. תמצא את הליד ב-Inbox תוך דקה, מוכן לאישור.
      </p>
    </form>
  );
}
