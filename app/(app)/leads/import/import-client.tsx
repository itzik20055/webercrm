"use client";

import { useState } from "react";
import { Upload, Loader2, AlertCircle } from "lucide-react";
import { LANGUAGE_LABELS } from "@/db/schema";
import {
  LeadReviewForm,
  type ExtractedLeadData,
  type ExistingMatch,
} from "@/components/lead-review-form";

interface ImportResponse {
  ok: boolean;
  inferredLeadName: string | null;
  inferredPhones: string[];
  audioStats: { total: number; transcribed: number; skipped: number };
  messageCount: number;
  firstMessageAt: string;
  lastMessageAt: string;
  lead: ExtractedLeadData;
  renderedChat: string;
  existingMatches: ExistingMatch[];
}

export function ImportClient({ myName }: { myName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<"he" | "en" | "yi">("he");
  const [phase, setPhase] = useState<"idle" | "uploading" | "review">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setPhase("uploading");

    const fd = new FormData();
    fd.append("file", file);
    fd.append("language", language);

    try {
      const res = await fetch("/api/leads/import-whatsapp", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "שגיאה בעיבוד הקובץ");
      }
      setResult(json as ImportResponse);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  if (phase === "uploading") {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center space-y-3 shadow-soft">
        <Loader2 className="size-8 mx-auto animate-spin text-primary" />
        <div className="font-medium">מעבד את השיחה...</div>
        <div className="text-sm text-muted-foreground">
          מתמלל הודעות קוליות ומחלץ פרטים. זה עשוי לקחת 10-60 שניות תלוי בכמות
          ההודעות הקוליות.
        </div>
      </div>
    );
  }

  if (phase === "review" && result) {
    return (
      <LeadReviewForm
        extracted={result.lead}
        mode={{
          kind: "import",
          inferredName: result.inferredLeadName,
          inferredPhone: result.inferredPhones[0] ?? null,
          existingMatches: result.existingMatches,
          audioStats: result.audioStats,
          chatTranscript: result.renderedChat,
          messageCount: result.messageCount,
          onCancel: () => {
            setResult(null);
            setPhase("idle");
            setError(null);
          },
        }}
      />
    );
  }

  return (
    <form onSubmit={handleUpload} className="space-y-4">
      <div className="rounded-2xl border bg-card p-4 space-y-3 shadow-soft">
        <div className="text-sm text-muted-foreground">
          השם שלך בוואטסאפ:{" "}
          <strong className="text-foreground">{myName}</strong>
        </div>

        <label className="flex items-center justify-center w-full h-32 rounded-xl border-2 border-dashed cursor-pointer hover:bg-accent focus-within:ring-2 focus-within:ring-primary/40">
          <input
            type="file"
            accept=".zip,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="sr-only"
          />
          <div className="text-center space-y-1">
            <Upload className="size-6 mx-auto text-muted-foreground" />
            <div className="text-sm font-medium">
              {file ? file.name : "בחר קובץ ZIP מוואטסאפ"}
            </div>
            <div className="text-xs text-muted-foreground">
              .zip (כולל מדיה) או .txt
            </div>
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
        disabled={!file}
        className="press w-full h-12 rounded-full bg-primary text-primary-foreground font-semibold disabled:opacity-50 shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        עבד עם AI
      </button>
    </form>
  );
}
