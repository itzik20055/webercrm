"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Wand2,
  Copy,
  Check,
  MessageCircle,
  Send,
  Loader2,
} from "lucide-react";
import { generateDraft, saveVoiceExample } from "@/app/(app)/leads/draft-actions";
import { whatsappLink } from "@/lib/format";
import { DRAFT_SCENARIO_LABELS } from "@/db/schema";
import type { DraftScenario } from "@/lib/ai-client";

const SCENARIO_ORDER: DraftScenario[] = [
  "first_reply",
  "send_price",
  "price_objection",
  "silent_followup",
  "date_confirmation",
  "closing_request",
  "general",
];

type DraftState = {
  scenario: DraftScenario;
  aiDraft: string;
  finalText: string;
  contextSnapshot: Record<string, unknown>;
  exampleCount: number;
  reasoning: string;
};

export function DraftCard({
  leadId,
  leadPhone,
}: {
  leadId: string;
  leadPhone: string;
}) {
  const [scenario, setScenario] = useState<DraftScenario>("first_reply");
  const [freeNote, setFreeNote] = useState("");
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [generating, startGenerate] = useTransition();
  const [saving, startSave] = useTransition();

  const dirty = draft != null && draft.finalText.trim() !== draft.aiDraft.trim();

  function generate() {
    startGenerate(async () => {
      const res = await generateDraft({
        leadId,
        scenario,
        freeNote: freeNote.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error || "ניסוח נכשל");
        return;
      }
      setDraft({
        scenario,
        aiDraft: res.draft,
        finalText: res.draft,
        contextSnapshot: res.contextSnapshot,
        exampleCount: res.exampleCount,
        reasoning: res.reasoning,
      });
      setSavedId(null);
      setCopied(false);
    });
  }

  async function copy() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.finalText);
    setCopied(true);
    toast.success("הועתק");
    setTimeout(() => setCopied(false), 1400);
  }

  function save() {
    if (!draft) return;
    if (!draft.finalText.trim()) {
      toast.error("אין מה לשמור");
      return;
    }
    startSave(async () => {
      const res = await saveVoiceExample({
        leadId,
        scenario: draft.scenario,
        aiDraft: draft.aiDraft,
        finalText: draft.finalText,
        contextSnapshot: draft.contextSnapshot,
      });
      if (!res.ok) {
        toast.error(res.error || "שמירה נכשלה");
        return;
      }
      setSavedId(res.id);
      toast.success(
        dirty
          ? "נשמר כדוגמה — ה-AI ילמד מהעריכה שלך"
          : "נשמר כדוגמה מאושרת"
      );
    });
  }

  return (
    <section className="bg-card border border-border/70 rounded-2xl p-4 space-y-3 shadow-soft">
      <header className="flex items-center justify-between">
        <h2 className="font-bold text-[13px] tracking-tight text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="size-4" />
          טיוטת תשובה
        </h2>
        {draft && (
          <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
            {draft.exampleCount} דוגמאות
          </span>
        )}
      </header>

      <div className="flex flex-wrap gap-1.5">
        {SCENARIO_ORDER.map((s) => {
          const active = scenario === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setScenario(s)}
              className={
                "press text-xs px-2.5 py-1.5 rounded-full font-medium border transition " +
                (active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-secondary-foreground border-transparent")
              }
            >
              {DRAFT_SCENARIO_LABELS[s]}
            </button>
          );
        })}
      </div>

      <textarea
        value={freeNote}
        onChange={(e) => setFreeNote(e.target.value)}
        placeholder="הוראה ספציפית לטיוטה (אופציונלי) — למשל: 'תזכיר שדיברנו ביום ראשון' או 'הצע חדר זול יותר'"
        className="w-full text-sm rounded-xl border border-border bg-background p-2.5 min-h-[60px] resize-none placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />

      <button
        type="button"
        disabled={generating}
        onClick={generate}
        className="press w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {generating ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Wand2 className="size-4" />
        )}
        {draft ? "ניסוח חדש" : "צור טיוטה"}
      </button>

      {draft && (
        <div className="space-y-2.5">
          <textarea
            value={draft.finalText}
            onChange={(e) =>
              setDraft({ ...draft, finalText: e.target.value })
            }
            className="w-full text-sm rounded-xl border border-border bg-background p-3 min-h-[160px] resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 leading-relaxed"
            dir="auto"
          />

          {draft.reasoning && (
            <p className="text-[11px] text-muted-foreground italic px-1">
              {draft.reasoning}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={copy}
              className="press h-10 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold flex items-center justify-center gap-1.5"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "הועתק" : "העתק"}
            </button>
            <a
              href={whatsappLink(leadPhone, draft.finalText)}
              target="_blank"
              rel="noreferrer"
              className="press h-10 rounded-xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 text-sm font-semibold flex items-center justify-center gap-1.5"
            >
              <MessageCircle className="size-4" />
              שלח בוואטסאפ
            </a>
          </div>

          <button
            type="button"
            disabled={saving || !!savedId}
            onClick={save}
            className={
              "press w-full h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 border transition " +
              (savedId
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                : dirty
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25"
                  : "bg-card text-foreground border-border")
            }
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : savedId ? (
              <Check className="size-4" />
            ) : (
              <Send className="size-4" />
            )}
            {savedId
              ? "נשמר ללמידה"
              : dirty
                ? "שלחתי כסופית (עם העריכות שלי)"
                : "שלחתי כסופית"}
          </button>
        </div>
      )}
    </section>
  );
}
