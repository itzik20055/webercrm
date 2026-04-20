"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  MessageSquarePlus,
  Sparkles,
  Loader2,
  Check,
  Wand2,
  X,
  ChevronDown,
} from "lucide-react";
import {
  captureAndAnalyze,
  applyCaptureUpdates,
  logInteraction,
  type CaptureSuggestions,
} from "@/app/(app)/leads/actions";
import {
  AUDIENCE_LABELS,
  INTEREST_TAG_LABELS,
  LANGUAGE_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from "@/db/schema";

type IType = "call_in" | "call_out" | "whatsapp" | "email" | "sms" | "note";
type IDir = "in" | "out" | "internal";

const TYPE_OPTIONS: { v: IType; l: string }[] = [
  { v: "whatsapp", l: "וואטסאפ" },
  { v: "call_in", l: "שיחה נכנסת" },
  { v: "call_out", l: "שיחה יוצאת" },
  { v: "email", l: "מייל" },
  { v: "note", l: "הערה" },
];

const DIR_OPTIONS: { v: IDir; l: string }[] = [
  { v: "in", l: "נכנס" },
  { v: "out", l: "יוצא" },
  { v: "internal", l: "פנימי" },
];

const BUDGET_LABELS: Record<"low" | "mid" | "high", string> = {
  low: "נמוך",
  mid: "בינוני",
  high: "גבוה",
};

type SelectionState = {
  whatSpokeToThem: boolean;
  objections: boolean;
  numAdults: boolean;
  numChildren: boolean;
  agesChildren: boolean;
  datesInterest: boolean;
  roomTypeInterest: boolean;
  budgetSignal: boolean;
  status: boolean;
  priority: boolean;
  language: boolean;
  audience: boolean;
  newTags: Record<string, boolean>;
  followup: boolean;
};

function defaultSelection(s: CaptureSuggestions): SelectionState {
  const tags: Record<string, boolean> = {};
  (s.newTags ?? []).forEach((t) => (tags[t] = true));
  return {
    whatSpokeToThem: !!s.whatSpokeToThem,
    objections: !!s.objections,
    numAdults: !!s.numAdults,
    numChildren: !!s.numChildren,
    agesChildren: !!s.agesChildren,
    datesInterest: !!s.datesInterest,
    roomTypeInterest: !!s.roomTypeInterest,
    budgetSignal: !!s.budgetSignal,
    status: !!s.status,
    priority: !!s.priority,
    language: !!s.language,
    audience: !!s.audience,
    newTags: tags,
    followup: !!s.followup,
  };
}

function followupLabel(iso: string): string {
  const d = new Date(iso);
  const diffMs = d.getTime() - Date.now();
  const hours = Math.round(diffMs / 3600_000);
  const date = d.toLocaleString("he-IL", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (hours < 24) return `${date} (בעוד ${hours} שעות)`;
  const days = Math.round(hours / 24);
  return `${date} (בעוד ${days} ימים)`;
}

export function CaptureCard({ leadId }: { leadId: string }) {
  const [content, setContent] = useState("");
  const [type, setType] = useState<IType>("whatsapp");
  const [direction, setDirection] = useState<IDir>("in");
  const [showOptions, setShowOptions] = useState(false);
  const [busy, setBusy] = useState<"save" | "analyze" | null>(null);
  const [, startApply] = useTransition();
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);

  const [suggestions, setSuggestions] = useState<CaptureSuggestions | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);

  function reset() {
    setContent("");
    setSuggestions(null);
    setSelection(null);
    setShowOptions(false);
  }

  async function saveOnly() {
    const text = content.trim();
    if (!text) {
      toast.error("אין תוכן לשמירה");
      return;
    }
    setBusy("save");
    try {
      const fd = new FormData();
      fd.set("leadId", leadId);
      fd.set("type", type);
      fd.set("direction", direction);
      fd.set("content", text);
      await logInteraction(fd);
      toast.success("נשמר");
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "שמירה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  async function saveAndAnalyze() {
    const text = content.trim();
    if (!text) {
      toast.error("אין תוכן לשמירה");
      return;
    }
    setBusy("analyze");
    setAnalyzing(true);
    try {
      const res = await captureAndAnalyze({
        leadId,
        type,
        direction,
        content: text,
      });
      if (!res.ok) {
        toast.error(res.error || "ניתוח נכשל");
        return;
      }
      toast.success("נשמר ונותח");
      const empty =
        !res.suggestions ||
        (Object.keys(res.suggestions).length === 1 && res.suggestions.summary);
      if (empty) {
        reset();
      } else {
        setSuggestions(res.suggestions);
        setSelection(defaultSelection(res.suggestions));
        setContent("");
        setShowOptions(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ניתוח נכשל");
    } finally {
      setBusy(null);
      setAnalyzing(false);
    }
  }

  function applyUpdates() {
    if (!suggestions || !selection) return;
    setApplying(true);
    startApply(async () => {
      try {
        const fields: Parameters<typeof applyCaptureUpdates>[0]["fields"] = {
          addTags: [],
        };
        if (selection.whatSpokeToThem && suggestions.whatSpokeToThem)
          fields.whatSpokeToThem = suggestions.whatSpokeToThem.next;
        if (selection.objections && suggestions.objections)
          fields.objections = suggestions.objections.next;
        if (selection.numAdults && suggestions.numAdults)
          fields.numAdults = suggestions.numAdults.next;
        if (selection.numChildren && suggestions.numChildren)
          fields.numChildren = suggestions.numChildren.next;
        if (selection.agesChildren && suggestions.agesChildren)
          fields.agesChildren = suggestions.agesChildren.next;
        if (selection.datesInterest && suggestions.datesInterest)
          fields.datesInterest = suggestions.datesInterest.next;
        if (selection.roomTypeInterest && suggestions.roomTypeInterest)
          fields.roomTypeInterest = suggestions.roomTypeInterest.next;
        if (selection.budgetSignal && suggestions.budgetSignal)
          fields.budgetSignal = suggestions.budgetSignal.next;
        if (selection.status && suggestions.status)
          fields.status = suggestions.status.next;
        if (selection.priority && suggestions.priority)
          fields.priority = suggestions.priority.next;
        if (selection.language && suggestions.language)
          fields.language = suggestions.language.next;
        if (selection.audience && suggestions.audience)
          fields.audience = suggestions.audience.next;
        fields.addTags = Object.entries(selection.newTags)
          .filter(([, on]) => on)
          .map(([t]) => t);

        const followup =
          selection.followup && suggestions.followup
            ? {
                dueAt: suggestions.followup.dueAt,
                reason: suggestions.followup.reason ?? undefined,
              }
            : undefined;

        const res = await applyCaptureUpdates({ leadId, fields, followup });
        if (!res.ok) {
          toast.error(res.error || "החלת השינויים נכשלה");
          return;
        }
        toast.success("עודכן");
        setSuggestions(null);
        setSelection(null);
      } finally {
        setApplying(false);
      }
    });
  }

  const hasAnyChange =
    selection &&
    (selection.whatSpokeToThem ||
      selection.objections ||
      selection.numAdults ||
      selection.numChildren ||
      selection.agesChildren ||
      selection.datesInterest ||
      selection.roomTypeInterest ||
      selection.budgetSignal ||
      selection.status ||
      selection.priority ||
      selection.language ||
      selection.audience ||
      selection.followup ||
      Object.values(selection.newTags).some((v) => v));

  return (
    <section
      id="capture"
      className="bg-card border border-border/70 rounded-2xl p-4 space-y-3 shadow-soft scroll-mt-20"
    >
      <header className="flex items-center justify-between">
        <h2 className="font-bold text-[13px] tracking-tight text-muted-foreground flex items-center gap-1.5">
          <MessageSquarePlus className="size-4" />
          תיעוד שיחה
        </h2>
        {(suggestions || content) && (
          <button
            type="button"
            onClick={reset}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            נקה
          </button>
        )}
      </header>

      {!suggestions && (
        <>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="הדבק וואטסאפ, סכם שיחה, או רשום הערה…"
            dir="auto"
            className="w-full text-sm rounded-xl border border-border bg-background p-3 min-h-[120px] resize-y placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/30 leading-relaxed"
          />

          <button
            type="button"
            onClick={() => setShowOptions((v) => !v)}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ChevronDown
              className={
                "size-3 transition " + (showOptions ? "rotate-180" : "")
              }
            />
            {TYPE_OPTIONS.find((t) => t.v === type)?.l} ·{" "}
            {DIR_OPTIONS.find((d) => d.v === direction)?.l}
          </button>

          {showOptions && (
            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap gap-1.5">
                {TYPE_OPTIONS.map((t) => {
                  const active = type === t.v;
                  return (
                    <button
                      key={t.v}
                      type="button"
                      onClick={() => setType(t.v)}
                      className={
                        "press text-xs px-2.5 py-1 rounded-full font-medium border transition " +
                        (active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary text-secondary-foreground border-transparent")
                      }
                    >
                      {t.l}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DIR_OPTIONS.map((d) => {
                  const active = direction === d.v;
                  return (
                    <button
                      key={d.v}
                      type="button"
                      onClick={() => setDirection(d.v)}
                      className={
                        "press text-xs px-2.5 py-1 rounded-full font-medium border transition " +
                        (active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary text-secondary-foreground border-transparent")
                      }
                    >
                      {d.l}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!!busy || !content.trim()}
              onClick={saveOnly}
              className="press h-11 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {busy === "save" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              שמור
            </button>
            <button
              type="button"
              disabled={!!busy || !content.trim()}
              onClick={saveAndAnalyze}
              className="press h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {busy === "analyze" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              שמור ונתח
            </button>
          </div>
        </>
      )}

      {analyzing && !suggestions && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Wand2 className="size-3.5" />
          ה-AI מנתח את השיחה ומציע עדכונים…
        </p>
      )}

      {suggestions && selection && (
        <div className="space-y-3">
          {suggestions.summary && (
            <div className="text-sm rounded-xl bg-primary-soft text-foreground p-3 border border-primary/10 leading-relaxed whitespace-pre-wrap">
              {suggestions.summary}
            </div>
          )}

          {hasAnyChange && (
            <>
              <p className="text-[11px] font-medium text-muted-foreground">
                בחר מה להחיל על הליד:
              </p>

              <ul className="space-y-1.5">
                <ToggleRow
                  active={selection.status}
                  onToggle={(v) =>
                    setSelection({ ...selection, status: v })
                  }
                  show={!!suggestions.status}
                  label="סטטוס"
                  from={
                    suggestions.status
                      ? STATUS_LABELS[suggestions.status.current]
                      : ""
                  }
                  to={
                    suggestions.status ? STATUS_LABELS[suggestions.status.next] : ""
                  }
                />
                <ToggleRow
                  active={selection.priority}
                  onToggle={(v) =>
                    setSelection({ ...selection, priority: v })
                  }
                  show={!!suggestions.priority}
                  label="עדיפות"
                  from={
                    suggestions.priority
                      ? PRIORITY_LABELS[suggestions.priority.current]
                      : ""
                  }
                  to={
                    suggestions.priority
                      ? PRIORITY_LABELS[suggestions.priority.next]
                      : ""
                  }
                />
                <ToggleRow
                  active={selection.language}
                  onToggle={(v) =>
                    setSelection({ ...selection, language: v })
                  }
                  show={!!suggestions.language}
                  label="שפה"
                  from={
                    suggestions.language
                      ? LANGUAGE_LABELS[suggestions.language.current]
                      : ""
                  }
                  to={
                    suggestions.language
                      ? LANGUAGE_LABELS[suggestions.language.next]
                      : ""
                  }
                />
                <ToggleRow
                  active={selection.audience}
                  onToggle={(v) =>
                    setSelection({ ...selection, audience: v })
                  }
                  show={!!suggestions.audience}
                  label="קהל"
                  from={
                    suggestions.audience
                      ? AUDIENCE_LABELS[suggestions.audience.current]
                      : ""
                  }
                  to={
                    suggestions.audience
                      ? AUDIENCE_LABELS[suggestions.audience.next]
                      : ""
                  }
                />
                <FillRow
                  active={selection.numAdults}
                  onToggle={(v) =>
                    setSelection({ ...selection, numAdults: v })
                  }
                  show={!!suggestions.numAdults}
                  label="מבוגרים"
                  value={String(suggestions.numAdults?.next ?? "")}
                />
                <FillRow
                  active={selection.numChildren}
                  onToggle={(v) =>
                    setSelection({ ...selection, numChildren: v })
                  }
                  show={!!suggestions.numChildren}
                  label="ילדים"
                  value={String(suggestions.numChildren?.next ?? "")}
                />
                <FillRow
                  active={selection.agesChildren}
                  onToggle={(v) =>
                    setSelection({ ...selection, agesChildren: v })
                  }
                  show={!!suggestions.agesChildren}
                  label="גילי ילדים"
                  value={suggestions.agesChildren?.next ?? ""}
                />
                <FillRow
                  active={selection.datesInterest}
                  onToggle={(v) =>
                    setSelection({ ...selection, datesInterest: v })
                  }
                  show={!!suggestions.datesInterest}
                  label="תאריכים"
                  value={suggestions.datesInterest?.next ?? ""}
                />
                <FillRow
                  active={selection.roomTypeInterest}
                  onToggle={(v) =>
                    setSelection({ ...selection, roomTypeInterest: v })
                  }
                  show={!!suggestions.roomTypeInterest}
                  label="חדר"
                  value={suggestions.roomTypeInterest?.next ?? ""}
                />
                <FillRow
                  active={selection.budgetSignal}
                  onToggle={(v) =>
                    setSelection({ ...selection, budgetSignal: v })
                  }
                  show={!!suggestions.budgetSignal}
                  label="תקציב"
                  value={
                    suggestions.budgetSignal
                      ? BUDGET_LABELS[suggestions.budgetSignal.next]
                      : ""
                  }
                />
                <FillRow
                  active={selection.whatSpokeToThem}
                  onToggle={(v) =>
                    setSelection({ ...selection, whatSpokeToThem: v })
                  }
                  show={!!suggestions.whatSpokeToThem}
                  label="מה תפס אותו"
                  value={suggestions.whatSpokeToThem?.next ?? ""}
                  multiline
                />
                <FillRow
                  active={selection.objections}
                  onToggle={(v) =>
                    setSelection({ ...selection, objections: v })
                  }
                  show={!!suggestions.objections}
                  label="התנגדויות"
                  value={suggestions.objections?.next ?? ""}
                  multiline
                />
              </ul>

              {suggestions.newTags && suggestions.newTags.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    תגיות עניין חדשות:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.newTags.map((t) => {
                      const on = !!selection.newTags[t];
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() =>
                            setSelection({
                              ...selection,
                              newTags: { ...selection.newTags, [t]: !on },
                            })
                          }
                          className={
                            "press text-xs px-2.5 py-1 rounded-full font-medium border transition " +
                            (on
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-secondary text-secondary-foreground border-transparent")
                          }
                        >
                          {INTEREST_TAG_LABELS[t] ?? t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {suggestions.followup && (
                <button
                  type="button"
                  onClick={() =>
                    setSelection({ ...selection, followup: !selection.followup })
                  }
                  className={
                    "w-full text-right rounded-xl p-3 border transition " +
                    (selection.followup
                      ? "bg-primary-soft border-primary/20"
                      : "bg-card border-border opacity-70")
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      פולואפ מומלץ
                    </span>
                    <span
                      className={
                        "size-4 rounded-full border flex items-center justify-center " +
                        (selection.followup
                          ? "bg-primary border-primary"
                          : "border-border")
                      }
                    >
                      {selection.followup && (
                        <Check className="size-3 text-primary-foreground" />
                      )}
                    </span>
                  </div>
                  <div className="text-sm font-semibold mt-1">
                    {followupLabel(suggestions.followup.dueAt)}
                  </div>
                  {suggestions.followup.reason && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {suggestions.followup.reason}
                    </div>
                  )}
                </button>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => {
                    setSuggestions(null);
                    setSelection(null);
                  }}
                  className="press h-10 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <X className="size-4" />
                  דלג
                </button>
                <button
                  type="button"
                  disabled={applying || !hasAnyChange}
                  onClick={applyUpdates}
                  className="press h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {applying ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  החל עדכונים
                </button>
              </div>
            </>
          )}

          {!hasAnyChange && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                אין מידע חדש לעדכן בליד.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSuggestions(null);
                  setSelection(null);
                }}
                className="press w-full h-10 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold"
              >
                סגור
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ToggleRow({
  active,
  onToggle,
  show,
  label,
  from,
  to,
}: {
  active: boolean;
  onToggle: (v: boolean) => void;
  show: boolean;
  label: string;
  from: string;
  to: string;
}) {
  if (!show) return null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(!active)}
        className={
          "w-full text-right rounded-lg p-2.5 border transition flex items-center gap-2 " +
          (active
            ? "bg-primary-soft border-primary/20"
            : "bg-card border-border opacity-70")
        }
      >
        <span
          className={
            "size-4 shrink-0 rounded-full border flex items-center justify-center " +
            (active ? "bg-primary border-primary" : "border-border")
          }
        >
          {active && <Check className="size-3 text-primary-foreground" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className="text-sm font-medium truncate">
            <span className="text-muted-foreground line-through">{from}</span>
            <span className="mx-1.5 text-muted-foreground">→</span>
            <span>{to}</span>
          </div>
        </div>
      </button>
    </li>
  );
}

function FillRow({
  active,
  onToggle,
  show,
  label,
  value,
  multiline,
}: {
  active: boolean;
  onToggle: (v: boolean) => void;
  show: boolean;
  label: string;
  value: string;
  multiline?: boolean;
}) {
  if (!show) return null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(!active)}
        className={
          "w-full text-right rounded-lg p-2.5 border transition flex items-start gap-2 " +
          (active
            ? "bg-primary-soft border-primary/20"
            : "bg-card border-border opacity-70")
        }
      >
        <span
          className={
            "size-4 shrink-0 rounded-full border flex items-center justify-center mt-0.5 " +
            (active ? "bg-primary border-primary" : "border-border")
          }
        >
          {active && <Check className="size-3 text-primary-foreground" />}
        </span>
        <div className="flex-1 min-w-0 text-right">
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div
            className={
              "text-sm font-medium " +
              (multiline ? "whitespace-pre-wrap" : "truncate")
            }
            dir="auto"
          >
            {value}
          </div>
        </div>
      </button>
    </li>
  );
}
