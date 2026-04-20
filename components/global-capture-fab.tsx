"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  MessageSquarePlus,
  X,
  Loader2,
  Search,
  UserPlus,
  Phone,
  Sparkles,
  Check,
  Wand2,
  ChevronDown,
  ArrowRight,
  Repeat,
} from "lucide-react";
import {
  applyCaptureUpdates,
  captureAndAnalyze,
  findLeadsForCapture,
  getLeadCapsule,
  logInteraction,
  type CaptureSuggestions,
  type LeadMatch,
} from "@/app/(app)/leads/actions";
import {
  AUDIENCE_LABELS,
  INTEREST_TAG_LABELS,
  LANGUAGE_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from "@/db/schema";
import { smartDate } from "@/lib/format";

type Step = "compose" | "match" | "review";
type IType = "call_in" | "call_out" | "whatsapp" | "email" | "sms" | "note";
type IDir = "in" | "out" | "internal";
type PendingAction = "save" | "analyze";

type LeadCapsule = { id: string; name: string; phone: string; status: string };

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

export function GlobalCaptureFab() {
  const router = useRouter();
  const pathname = usePathname();

  const lockedFromPath = (() => {
    const m = pathname.match(/^\/leads\/([^/]+)/);
    if (!m) return null;
    if (
      pathname.startsWith("/leads/new") ||
      pathname.startsWith("/leads/import")
    )
      return null;
    if (m[1] === "new" || m[1] === "import") return null;
    if (pathname.endsWith("/edit") || pathname.endsWith("/followup") || pathname.endsWith("/log")) {
      return null;
    }
    return m[1];
  })();

  const hideFab = pathname === "/login";

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("compose");
  const [text, setText] = useState("");
  const [type, setType] = useState<IType>("whatsapp");
  const [direction, setDirection] = useState<IDir>("in");
  const [showOptions, setShowOptions] = useState(false);

  // lead context
  const [lockedCapsule, setLockedCapsule] = useState<LeadCapsule | null>(null);
  const [pickedLead, setPickedLead] = useState<LeadMatch | null>(null);
  const [unlock, setUnlock] = useState(false);

  // match step
  const [phones, setPhones] = useState<string[]>([]);
  const [matches, setMatches] = useState<LeadMatch[]>([]);
  const [recent, setRecent] = useState<LeadMatch[]>([]);
  const [searching, startSearch] = useTransition();

  // execution
  const [busy, setBusy] = useState<"save" | "analyze" | "apply" | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // review step
  const [suggestions, setSuggestions] = useState<CaptureSuggestions | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const effectiveLeadId = !unlock && lockedFromPath ? lockedFromPath : pickedLead?.id ?? null;
  const effectiveLeadDisplay: LeadCapsule | null = !unlock && lockedCapsule
    ? lockedCapsule
    : pickedLead
    ? {
        id: pickedLead.id,
        name: pickedLead.name,
        phone: pickedLead.phone,
        status: pickedLead.status,
      }
    : null;

  const close = useCallback(() => {
    setOpen(false);
    setTimeout(() => {
      setStep("compose");
      setText("");
      setShowOptions(false);
      setPickedLead(null);
      setUnlock(false);
      setPhones([]);
      setMatches([]);
      setRecent([]);
      setSuggestions(null);
      setSelection(null);
      setBusy(null);
      setPendingAction(null);
    }, 200);
  }, []);

  // open via custom event (from lead page "תיעוד שיחה" buttons) or hash #capture
  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string }>).detail;
      if (detail?.text) setText(detail.text);
      setOpen(true);
    };
    const onHash = () => {
      if (window.location.hash === "#capture") {
        history.replaceState(null, "", window.location.pathname + window.location.search);
        setOpen(true);
      }
    };
    window.addEventListener("weber:open-capture", onEvent as EventListener);
    window.addEventListener("hashchange", onHash);
    if (typeof window !== "undefined" && window.location.hash === "#capture") {
      onHash();
    }
    return () => {
      window.removeEventListener("weber:open-capture", onEvent as EventListener);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // focus textarea when entering compose
  useEffect(() => {
    if (open && step === "compose") {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, step]);

  // fetch locked lead capsule on open
  useEffect(() => {
    if (!open || !lockedFromPath || unlock) return;
    if (lockedCapsule?.id === lockedFromPath) return;
    let cancelled = false;
    getLeadCapsule(lockedFromPath).then((res) => {
      if (cancelled) return;
      if (res.ok) setLockedCapsule(res.lead);
    });
    return () => {
      cancelled = true;
    };
  }, [open, lockedFromPath, unlock, lockedCapsule]);

  function goMatch(action: PendingAction) {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error("אין תוכן לשמירה");
      return;
    }
    setPendingAction(action);
    startSearch(async () => {
      const res = await findLeadsForCapture(trimmed);
      setPhones(res.phones);
      setMatches(res.matches);
      setRecent(res.recent);
      setStep("match");
    });
  }

  async function executeSave(leadId: string) {
    setBusy("save");
    try {
      const fd = new FormData();
      fd.set("leadId", leadId);
      fd.set("type", type);
      fd.set("direction", direction);
      fd.set("content", text.trim());
      await logInteraction(fd);
      toast.success("נשמר");
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "שמירה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  async function executeAnalyze(leadId: string) {
    setBusy("analyze");
    try {
      const res = await captureAndAnalyze({
        leadId,
        type,
        direction,
        content: text.trim(),
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
        close();
        return;
      }
      setSuggestions(res.suggestions);
      setSelection(defaultSelection(res.suggestions));
      setStep("review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ניתוח נכשל");
    } finally {
      setBusy(null);
    }
  }

  function onSave() {
    if (effectiveLeadId) executeSave(effectiveLeadId);
    else goMatch("save");
  }

  function onAnalyze() {
    if (effectiveLeadId) executeAnalyze(effectiveLeadId);
    else goMatch("analyze");
  }

  function onPickLead(lead: LeadMatch) {
    setPickedLead(lead);
    setStep("compose");
    if (pendingAction === "save") executeSave(lead.id);
    else if (pendingAction === "analyze") executeAnalyze(lead.id);
    setPendingAction(null);
  }

  function onCreateNew() {
    const params = new URLSearchParams();
    if (phones[0]) params.set("phone", phones[0]);
    if (text.trim()) params.set("notes", text.trim().slice(0, 1000));
    close();
    router.push(`/leads/new?${params.toString()}`);
  }

  function applyUpdates() {
    if (!suggestions || !selection || !effectiveLeadId) return;
    setBusy("apply");
    (async () => {
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

        const res = await applyCaptureUpdates({
          leadId: effectiveLeadId,
          fields,
          followup,
        });
        if (!res.ok) {
          toast.error(res.error || "החלת השינויים נכשלה");
          return;
        }
        toast.success("עודכן");
        close();
      } finally {
        setBusy(null);
      }
    })();
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
    <>
      {!hideFab && (
        <button
          type="button"
          aria-label="תיעוד מהיר"
          onClick={() => setOpen(true)}
          className="press fixed z-40 bottom-[calc(env(safe-area-inset-bottom)+74px)] left-4 size-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-pop"
        >
          <MessageSquarePlus className="size-6" strokeWidth={2.2} />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal>
          <button
            type="button"
            aria-label="סגור"
            onClick={close}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          <div className="relative w-full max-w-lg bg-card rounded-t-3xl border-t border-x border-border shadow-pop max-h-[90dvh] flex flex-col animate-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <div className="flex items-center gap-2 min-w-0">
                {step !== "compose" && (
                  <button
                    type="button"
                    onClick={() => setStep("compose")}
                    className="press size-8 -mr-1 rounded-full hover:bg-accent flex items-center justify-center shrink-0"
                    aria-label="חזור"
                  >
                    <ArrowRight className="size-5" />
                  </button>
                )}
                <h2 className="font-bold text-base tracking-tight truncate">
                  {step === "compose" && "תיעוד מהיר"}
                  {step === "match" && "לאיזה ליד לקשר?"}
                  {step === "review" && "הצעות AI לעדכון"}
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                className="press size-9 rounded-full hover:bg-accent flex items-center justify-center"
                aria-label="סגור"
              >
                <X className="size-5" />
              </button>
            </div>

            {effectiveLeadDisplay && step !== "match" && (
              <div className="mx-4 mb-2 flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-primary-soft border border-primary/15">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-muted-foreground">
                    תיעוד לליד
                  </div>
                  <div className="text-sm font-semibold tracking-tight truncate">
                    {effectiveLeadDisplay.name}
                    <span className="text-[11px] font-medium text-muted-foreground mx-1.5">
                      · {STATUS_LABELS[effectiveLeadDisplay.status as keyof typeof STATUS_LABELS]}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setUnlock(true);
                    setPickedLead(null);
                    setStep("compose");
                  }}
                  className="press text-[11px] font-semibold text-primary inline-flex items-center gap-1 shrink-0"
                >
                  <Repeat className="size-3" />
                  החלף
                </button>
              </div>
            )}

            <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] overflow-y-auto flex-1 space-y-3">
              {step === "compose" && (
                <ComposeStep
                  text={text}
                  setText={setText}
                  type={type}
                  setType={setType}
                  direction={direction}
                  setDirection={setDirection}
                  showOptions={showOptions}
                  setShowOptions={setShowOptions}
                  busy={busy}
                  searching={searching}
                  effectiveLeadId={effectiveLeadId}
                  textareaRef={textareaRef}
                  onSave={onSave}
                  onAnalyze={onAnalyze}
                />
              )}

              {step === "match" && (
                <MatchStep
                  phones={phones}
                  matches={matches}
                  recent={recent}
                  onPick={onPickLead}
                  onCreateNew={onCreateNew}
                  onBack={() => {
                    setStep("compose");
                    setPendingAction(null);
                  }}
                />
              )}

              {step === "review" && suggestions && selection && (
                <ReviewStep
                  suggestions={suggestions}
                  selection={selection}
                  setSelection={setSelection}
                  hasAnyChange={!!hasAnyChange}
                  busy={busy}
                  onApply={applyUpdates}
                  onSkip={close}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ComposeStep({
  text,
  setText,
  type,
  setType,
  direction,
  setDirection,
  showOptions,
  setShowOptions,
  busy,
  searching,
  effectiveLeadId,
  textareaRef,
  onSave,
  onAnalyze,
}: {
  text: string;
  setText: (v: string) => void;
  type: IType;
  setType: (v: IType) => void;
  direction: IDir;
  setDirection: (v: IDir) => void;
  showOptions: boolean;
  setShowOptions: (v: boolean) => void;
  busy: "save" | "analyze" | "apply" | null;
  searching: boolean;
  effectiveLeadId: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onSave: () => void;
  onAnalyze: () => void;
}) {
  const isWorking = busy !== null || searching;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {effectiveLeadId
          ? "הדבק וואטסאפ, סכם שיחה, או רשום הערה — נוכל לנתח ולעדכן את הליד אוטומטית."
          : "הדבק וואטסאפ או סכם שיחה. נחפש לידים קיימים לפי הטלפון בטקסט."}
      </p>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="הדבק כאן…"
        dir="auto"
        className="w-full text-sm rounded-xl border border-border bg-background p-3 min-h-[140px] resize-y placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/30 leading-relaxed"
      />

      <button
        type="button"
        onClick={() => setShowOptions(!showOptions)}
        className="text-[11px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        <ChevronDown
          className={"size-3 transition " + (showOptions ? "rotate-180" : "")}
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

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          disabled={isWorking || !text.trim()}
          onClick={onSave}
          className="press h-11 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {busy === "save" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : effectiveLeadId ? (
            <Check className="size-4" />
          ) : (
            <Search className="size-4" />
          )}
          {effectiveLeadId ? "שמור" : "שמור (בחר ליד)"}
        </button>
        <button
          type="button"
          disabled={isWorking || !text.trim()}
          onClick={onAnalyze}
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

      {busy === "analyze" && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Wand2 className="size-3.5" />
          ה-AI מנתח את השיחה ומציע עדכונים…
        </p>
      )}
    </>
  );
}

function MatchStep({
  phones,
  matches,
  recent,
  onPick,
  onCreateNew,
  onBack,
}: {
  phones: string[];
  matches: LeadMatch[];
  recent: LeadMatch[];
  onPick: (l: LeadMatch) => void;
  onCreateNew: () => void;
  onBack: () => void;
}) {
  return (
    <>
      {phones.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          <span>טלפונים שזוהו:</span>
          {phones.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground tabular-nums"
            >
              <Phone className="size-3" />
              {p}
            </span>
          ))}
        </div>
      )}

      {matches.length > 0 && (
        <section className="space-y-1.5">
          <p className="text-[11px] font-semibold text-muted-foreground">
            התאמות לפי טלפון:
          </p>
          <ul className="space-y-1.5">
            {matches.map((m) => (
              <LeadRow key={m.id} lead={m} onPick={onPick} highlight />
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section className="space-y-1.5">
          <p className="text-[11px] font-semibold text-muted-foreground">
            {matches.length > 0 ? "אחרונים:" : "לידים אחרונים:"}
          </p>
          <ul className="space-y-1.5">
            {recent
              .filter((r) => !matches.find((m) => m.id === r.id))
              .slice(0, 6)
              .map((r) => (
                <LeadRow key={r.id} lead={r} onPick={onPick} />
              ))}
          </ul>
        </section>
      )}

      <button
        type="button"
        onClick={onCreateNew}
        className="press w-full h-12 rounded-xl bg-primary-soft text-primary border border-primary/15 font-semibold flex items-center justify-center gap-2"
      >
        <UserPlus className="size-4" />
        ליד חדש מהטקסט
      </button>

      <button
        type="button"
        onClick={onBack}
        className="press w-full h-10 rounded-xl bg-card border border-border text-sm text-muted-foreground"
      >
        חזור לעריכה
      </button>
    </>
  );
}

function ReviewStep({
  suggestions,
  selection,
  setSelection,
  hasAnyChange,
  busy,
  onApply,
  onSkip,
}: {
  suggestions: CaptureSuggestions;
  selection: SelectionState;
  setSelection: (s: SelectionState) => void;
  hasAnyChange: boolean;
  busy: "save" | "analyze" | "apply" | null;
  onApply: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="space-y-3">
      {suggestions.summary && (
        <div className="text-sm rounded-xl bg-primary-soft text-foreground p-3 border border-primary/10 leading-relaxed whitespace-pre-wrap">
          {suggestions.summary}
        </div>
      )}

      {hasAnyChange ? (
        <>
          <p className="text-[11px] font-medium text-muted-foreground">
            בחר מה להחיל על הליד:
          </p>

          <ul className="space-y-1.5">
            <ToggleRow
              active={selection.status}
              onToggle={(v) => setSelection({ ...selection, status: v })}
              show={!!suggestions.status}
              label="סטטוס"
              from={suggestions.status ? STATUS_LABELS[suggestions.status.current] : ""}
              to={suggestions.status ? STATUS_LABELS[suggestions.status.next] : ""}
            />
            <ToggleRow
              active={selection.priority}
              onToggle={(v) => setSelection({ ...selection, priority: v })}
              show={!!suggestions.priority}
              label="עדיפות"
              from={suggestions.priority ? PRIORITY_LABELS[suggestions.priority.current] : ""}
              to={suggestions.priority ? PRIORITY_LABELS[suggestions.priority.next] : ""}
            />
            <ToggleRow
              active={selection.language}
              onToggle={(v) => setSelection({ ...selection, language: v })}
              show={!!suggestions.language}
              label="שפה"
              from={suggestions.language ? LANGUAGE_LABELS[suggestions.language.current] : ""}
              to={suggestions.language ? LANGUAGE_LABELS[suggestions.language.next] : ""}
            />
            <ToggleRow
              active={selection.audience}
              onToggle={(v) => setSelection({ ...selection, audience: v })}
              show={!!suggestions.audience}
              label="קהל"
              from={suggestions.audience ? AUDIENCE_LABELS[suggestions.audience.current] : ""}
              to={suggestions.audience ? AUDIENCE_LABELS[suggestions.audience.next] : ""}
            />
            <FillRow
              active={selection.numAdults}
              onToggle={(v) => setSelection({ ...selection, numAdults: v })}
              show={!!suggestions.numAdults}
              label="מבוגרים"
              value={String(suggestions.numAdults?.next ?? "")}
            />
            <FillRow
              active={selection.numChildren}
              onToggle={(v) => setSelection({ ...selection, numChildren: v })}
              show={!!suggestions.numChildren}
              label="ילדים"
              value={String(suggestions.numChildren?.next ?? "")}
            />
            <FillRow
              active={selection.agesChildren}
              onToggle={(v) => setSelection({ ...selection, agesChildren: v })}
              show={!!suggestions.agesChildren}
              label="גילי ילדים"
              value={suggestions.agesChildren?.next ?? ""}
            />
            <FillRow
              active={selection.datesInterest}
              onToggle={(v) => setSelection({ ...selection, datesInterest: v })}
              show={!!suggestions.datesInterest}
              label="תאריכים"
              value={suggestions.datesInterest?.next ?? ""}
            />
            <FillRow
              active={selection.roomTypeInterest}
              onToggle={(v) => setSelection({ ...selection, roomTypeInterest: v })}
              show={!!suggestions.roomTypeInterest}
              label="חדר"
              value={suggestions.roomTypeInterest?.next ?? ""}
            />
            <FillRow
              active={selection.budgetSignal}
              onToggle={(v) => setSelection({ ...selection, budgetSignal: v })}
              show={!!suggestions.budgetSignal}
              label="תקציב"
              value={suggestions.budgetSignal ? BUDGET_LABELS[suggestions.budgetSignal.next] : ""}
            />
            <FillRow
              active={selection.whatSpokeToThem}
              onToggle={(v) => setSelection({ ...selection, whatSpokeToThem: v })}
              show={!!suggestions.whatSpokeToThem}
              label="מה תפס אותו"
              value={suggestions.whatSpokeToThem?.next ?? ""}
              multiline
            />
            <FillRow
              active={selection.objections}
              onToggle={(v) => setSelection({ ...selection, objections: v })}
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
              onClick={() => setSelection({ ...selection, followup: !selection.followup })}
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
                    (selection.followup ? "bg-primary border-primary" : "border-border")
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

          <div className="grid grid-cols-2 gap-2 pt-1 sticky bottom-0 bg-card pb-1">
            <button
              type="button"
              disabled={busy === "apply"}
              onClick={onSkip}
              className="press h-11 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <X className="size-4" />
              דלג
            </button>
            <button
              type="button"
              disabled={busy === "apply" || !hasAnyChange}
              onClick={onApply}
              className="press h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {busy === "apply" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              החל עדכונים
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">אין מידע חדש לעדכן בליד.</p>
          <button
            type="button"
            onClick={onSkip}
            className="press w-full h-11 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold"
          >
            סגור
          </button>
        </div>
      )}
    </div>
  );
}

function LeadRow({
  lead,
  onPick,
  highlight,
}: {
  lead: LeadMatch;
  onPick: (l: LeadMatch) => void;
  highlight?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(lead)}
        className={
          "w-full text-right rounded-xl p-3 border transition press " +
          (highlight ? "bg-primary-soft border-primary/20" : "bg-card border-border")
        }
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold tracking-tight">{lead.name}</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
            {STATUS_LABELS[lead.status]}
          </span>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
          {lead.phone} · עודכן {smartDate(lead.updatedAt)}
        </div>
      </button>
    </li>
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
            className={"text-sm font-medium " + (multiline ? "whitespace-pre-wrap" : "truncate")}
            dir="auto"
          >
            {value}
          </div>
        </div>
      </button>
    </li>
  );
}
