"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ScrollText, Save, Loader2, Check } from "lucide-react";
import { saveAiRules } from "@/lib/ai-rules";

const PLACEHOLDER = `דוגמאות (כתוב חופשי, שורה לכל כלל):

- בכל שאלה על מחיר, תמיד הצג קודם את הערך (מה כלול, מי הקהל, האווירה) לפני שאתה אומר את המספר.
- אל תכתוב באימוג'ים. בכלל.
- אם הלקוח שואל בקצרה, תענה בקצרה. אל תרחיב מעבר לנדרש.
- בפנייה ראשונה אל תזכיר מחיר עד שהוא שואל.`;

export function RulesEditor({ initialRules }: { initialRules: string }) {
  const [text, setText] = useState(initialRules);
  const [savedAt, setSavedAt] = useState<number | null>(
    initialRules ? Date.now() : null
  );
  const [pending, start] = useTransition();

  const dirty = text !== initialRules && text !== (savedAt ? text : initialRules);
  const justSaved = savedAt != null && Date.now() - savedAt < 4000;

  function save() {
    start(async () => {
      const res = await saveAiRules(text);
      if (!res.ok) {
        toast.error(res.error || "שמירה נכשלה");
        return;
      }
      setSavedAt(Date.now());
      toast.success(text.trim() ? "הכללים עודכנו" : "הכללים נמחקו");
    });
  }

  return (
    <section className="bg-card border border-border/70 rounded-2xl p-4 space-y-3 shadow-soft">
      <header className="flex items-center justify-between">
        <h2 className="font-bold text-[13px] tracking-tight text-muted-foreground flex items-center gap-1.5">
          <ScrollText className="size-4" />
          כללי כתיבה גלובליים
        </h2>
        {text.trim() && (
          <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
            פעיל
          </span>
        )}
      </header>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        כללים שנכנסים לכל ניסוח של ה-AI (טיוטות לידים + תשובות צ'אט). שורה אחת לכל כלל. ריק = בלי כללים.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        className="w-full text-sm rounded-xl border border-border bg-background p-3 min-h-[180px] resize-y placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 leading-relaxed"
        dir="auto"
      />
      <button
        type="button"
        disabled={pending || (!dirty && !justSaved)}
        onClick={save}
        className={
          "press w-full h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 border transition disabled:opacity-50 " +
          (justSaved && !dirty
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
            : "bg-primary text-primary-foreground border-primary")
        }
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : justSaved && !dirty ? (
          <Check className="size-4" />
        ) : (
          <Save className="size-4" />
        )}
        {justSaved && !dirty ? "נשמר" : "שמור כללים"}
      </button>
    </section>
  );
}
