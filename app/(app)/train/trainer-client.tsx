"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Wand2,
  Loader2,
  Copy,
  Check,
  BookmarkPlus,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { askQuestion, saveAsFaq } from "./actions";
import {
  AUDIENCE_LABELS,
  LANGUAGE_LABELS,
  type Lead,
} from "@/db/schema";

type Audience = Lead["audience"];
type Language = Lead["language"];

const AUDIENCES: Audience[] = ["israeli_haredi", "american_haredi", "european_haredi"];
const LANGUAGES: Language[] = ["he", "en", "yi"];

type AnswerState = {
  question: string;
  aiAnswer: string;
  finalText: string;
  language: Language;
  audience: Audience;
};

export function TrainerClient() {
  const [audience, setAudience] = useState<Audience>("israeli_haredi");
  const [language, setLanguage] = useState<Language>("he");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [asking, startAsk] = useTransition();
  const [saving, startSave] = useTransition();

  const dirty =
    answer != null && answer.finalText.trim() !== answer.aiAnswer.trim();

  function ask() {
    const q = question.trim();
    if (!q) {
      toast.error("כתוב שאלה");
      return;
    }
    startAsk(async () => {
      const res = await askQuestion({ question: q, audience, language });
      if (!res.ok) {
        toast.error(res.error || "ניסוח נכשל");
        return;
      }
      setAnswer({
        question: q,
        aiAnswer: res.answer,
        finalText: res.answer,
        language,
        audience,
      });
      setSavedId(null);
      setCopied(false);
    });
  }

  async function copy() {
    if (!answer) return;
    await navigator.clipboard.writeText(answer.finalText);
    setCopied(true);
    toast.success("הועתק");
    setTimeout(() => setCopied(false), 1400);
  }

  function save() {
    if (!answer) return;
    if (!answer.finalText.trim()) {
      toast.error("התשובה ריקה");
      return;
    }
    startSave(async () => {
      const res = await saveAsFaq({
        question: answer.question,
        answer: answer.finalText,
        language: answer.language,
      });
      if (!res.ok) {
        toast.error(res.error || "שמירה נכשלה");
        return;
      }
      setSavedId(res.id);
      toast.success(
        dirty
          ? "נשמר בידע — ה-AI ילמד מהעריכה שלך"
          : "נשמר בידע כתשובה קבועה"
      );
    });
  }

  function reset() {
    setQuestion("");
    setAnswer(null);
    setSavedId(null);
    setCopied(false);
  }

  return (
    <div className="space-y-4">
      <section className="bg-card border border-border/70 rounded-2xl p-4 space-y-3 shadow-soft">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">
            קהל
          </label>
          <div className="flex flex-wrap gap-1.5">
            {AUDIENCES.map((a) => {
              const active = audience === a;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAudience(a)}
                  className={
                    "press text-xs px-2.5 py-1.5 rounded-full font-medium border transition " +
                    (active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-secondary-foreground border-transparent")
                  }
                >
                  {AUDIENCE_LABELS[a]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">
            שפת התשובה
          </label>
          <div className="flex flex-wrap gap-1.5">
            {LANGUAGES.map((l) => {
              const active = language === l;
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLanguage(l)}
                  className={
                    "press text-xs px-2.5 py-1.5 rounded-full font-medium border transition " +
                    (active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-secondary-foreground border-transparent")
                  }
                >
                  {LANGUAGE_LABELS[l]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">
            השאלה (כפי שלקוח היה שואל)
          </label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="כמה עולה שבוע למשפחה של 6? יש מטבחון בחדר? אפשר להגיע מאמסטרדם?"
            className="w-full text-sm rounded-xl border border-border bg-background p-3 min-h-[80px] resize-none placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
            dir="auto"
          />
        </div>

        <button
          type="button"
          disabled={asking}
          onClick={ask}
          className="press w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {asking ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Wand2 className="size-4" />
          )}
          {answer ? "שאל שוב" : "ענה"}
        </button>
      </section>

      {answer && (
        <section className="bg-card border border-border/70 rounded-2xl p-4 space-y-3 shadow-soft">
          <header className="flex items-center justify-between">
            <h2 className="font-bold text-[13px] tracking-tight text-muted-foreground">
              התשובה (ערוך לפני שמירה)
            </h2>
            <button
              type="button"
              onClick={reset}
              className="press text-[11px] text-muted-foreground inline-flex items-center gap-1"
            >
              <RefreshCw className="size-3" />
              נקה
            </button>
          </header>

          <textarea
            value={answer.finalText}
            onChange={(e) =>
              setAnswer({ ...answer, finalText: e.target.value })
            }
            className="w-full text-sm rounded-xl border border-border bg-background p-3 min-h-[180px] resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 leading-relaxed"
            dir="auto"
          />

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={copy}
              className="press h-10 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold flex items-center justify-center gap-1.5"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "הועתק" : "העתק"}
            </button>
            <button
              type="button"
              disabled={saving || !!savedId}
              onClick={save}
              className={
                "press h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 border transition " +
                (savedId
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                  : dirty
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25"
                    : "bg-primary/10 text-primary border-primary/20")
              }
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : savedId ? (
                <Check className="size-4" />
              ) : (
                <BookmarkPlus className="size-4" />
              )}
              {savedId
                ? "נשמר בידע"
                : dirty
                  ? "שמור (עם העריכות שלי)"
                  : "שמור כתשובה קבועה"}
            </button>
          </div>

          {savedId && (
            <Link
              href={`/kb/${savedId}/edit`}
              className="text-[11px] text-primary text-center block press"
            >
              ערוך את הרשומה ב-KB
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
