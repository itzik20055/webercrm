"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Send,
  Loader2,
  StopCircle,
  X,
  Search,
  User,
  Sparkles,
  BookmarkPlus,
  Check,
  Copy,
  RefreshCw,
  ClipboardPaste,
  ChevronRight,
  MessageSquareText,
  Mail,
} from "lucide-react";
import Link from "next/link";
import {
  AUDIENCE_LABELS,
  LANGUAGE_LABELS,
  type Lead,
} from "@/db/schema";
import {
  searchLeadsForChat,
  saveChatAsVoiceExample,
  logPasteToLead,
  type LeadSearchHit,
} from "./actions";

type Audience = Lead["audience"];
type Language = Lead["language"];

const AUDIENCES: Audience[] = ["israeli_haredi", "american_haredi", "european_haredi"];
const LANGUAGES: Language[] = ["he", "en", "yi"];

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Original AI text before any local edits — used to detect dirty state for save. */
  aiOriginal?: string;
  /** True for the assistant message currently streaming. */
  streaming?: boolean;
  /** Voice-example id once saved. */
  savedAs?: string;
};

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function ChatClient({
  initialLead,
  initialQuestion,
}: {
  initialLead: LeadSearchHit | null;
  initialQuestion: string;
}) {
  const [lead, setLead] = useState<LeadSearchHit | null>(initialLead);
  const [audience, setAudience] = useState<Audience>(
    initialLead?.audience ?? "israeli_haredi"
  );
  const [language, setLanguage] = useState<Language>(
    initialLead?.language ?? "he"
  );

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState(initialQuestion);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Lead picker state
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (lead) {
      setAudience(lead.audience);
      setLanguage(lead.language);
    }
  }, [lead]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Msg = { id: newId(), role: "user", content: text };
    const placeholder: Msg = {
      id: newId(),
      role: "assistant",
      content: "",
      aiOriginal: "",
      streaming: true,
    };
    const next = [...messages, userMsg, placeholder];
    setMessages(next);
    setInput("");

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);

    try {
      const apiMessages = next
        .filter((m) => m.role !== "assistant" || m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          leadId: lead?.id ?? null,
          audience,
          language,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        toast.error(msg || "השיחה נכשלה");
        setMessages((prev) => prev.filter((m) => m.id !== placeholder.id));
        return;
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        acc += value;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholder.id
              ? { ...m, content: acc, aiOriginal: acc }
              : m
          )
        );
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast.error(e instanceof Error ? e.message : "השיחה נכשלה");
      setMessages((prev) => prev.filter((m) => m.id !== placeholder.id));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setMessages((prev) =>
        prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
      );
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function reset() {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-col min-h-[calc(100dvh-5.5rem)]">
      <ChatHeader
        lead={lead}
        onClearLead={() => setLead(null)}
        onOpenPicker={() => setPickerOpen(true)}
        audience={audience}
        language={language}
        onAudience={setAudience}
        onLanguage={setLanguage}
        onReset={reset}
        canReset={messages.length > 0}
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pt-3 pb-4 space-y-3">
        {messages.length === 0 ? (
          <EmptyChat
            lead={lead}
            onPick={() => setPickerOpen(true)}
            onSeed={(q) => setInput(q)}
          />
        ) : (
          messages.map((m, i) => (
            <Bubble
              key={m.id}
              msg={m}
              isLast={i === messages.length - 1}
              lead={lead}
              audience={audience}
              language={language}
              onChange={(content) =>
                setMessages((prev) =>
                  prev.map((x) => (x.id === m.id ? { ...x, content } : x))
                )
              }
              onSaved={(savedId) =>
                setMessages((prev) =>
                  prev.map((x) => (x.id === m.id ? { ...x, savedAs: savedId } : x))
                )
              }
              userQuestion={
                m.role === "assistant"
                  ? messages[i - 1]?.role === "user"
                    ? messages[i - 1].content
                    : undefined
                  : undefined
              }
            />
          ))
        )}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSend={send}
        onStop={stop}
        onKeyDown={onKeyDown}
        streaming={streaming}
        lead={lead}
      />

      {pickerOpen && (
        <LeadPicker
          onClose={() => setPickerOpen(false)}
          onPick={(l) => {
            setLead(l);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ChatHeader({
  lead,
  onClearLead,
  onOpenPicker,
  audience,
  language,
  onAudience,
  onLanguage,
  onReset,
  canReset,
}: {
  lead: LeadSearchHit | null;
  onClearLead: () => void;
  onOpenPicker: () => void;
  audience: Audience;
  language: Language;
  onAudience: (a: Audience) => void;
  onLanguage: (l: Language) => void;
  onReset: () => void;
  canReset: boolean;
}) {
  return (
    <header className="px-4 pt-4 pb-3 space-y-2.5 border-b border-border/60 bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 sticky top-0 z-10">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          <h1 className="text-lg font-bold tracking-tight">צ'אט</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/leads/import#whatsapp"
            className="press text-[11px] font-medium text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1"
            aria-label="ייבוא צ'אט וואטסאפ"
          >
            <MessageSquareText className="size-3" />
            ייבוא וואטסאפ
          </Link>
          <Link
            href="/leads/import#email"
            className="press text-[11px] font-medium text-primary inline-flex items-center gap-1"
            aria-label="ייבוא התכתבות מייל"
          >
            <Mail className="size-3" />
            ייבוא מייל
          </Link>
          {canReset && (
            <button
              type="button"
              onClick={onReset}
              className="press text-[11px] text-muted-foreground inline-flex items-center gap-1"
            >
              <RefreshCw className="size-3" />
              שיחה חדשה
            </button>
          )}
        </div>
      </div>

      {lead ? (
        <div className="flex items-center gap-2 px-3 h-11 rounded-xl bg-primary-soft/60 border border-primary/15">
          <User className="size-4 text-primary shrink-0" />
          <Link
            href={`/leads/${lead.id}`}
            className="press min-w-0 flex-1 text-right"
          >
            <div className="text-sm font-semibold truncate">{lead.name}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums truncate">
              {lead.phone} · {AUDIENCE_LABELS[lead.audience]} · {LANGUAGE_LABELS[lead.language]}
            </div>
          </Link>
          <button
            type="button"
            onClick={onClearLead}
            aria-label="הסר ליד"
            className="press size-7 rounded-full hover:bg-background/60 text-muted-foreground flex items-center justify-center"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onOpenPicker}
            className="press w-full h-11 px-3 rounded-xl border border-dashed border-border bg-card text-right text-sm text-muted-foreground flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <Search className="size-4 shrink-0" />
            <span className="flex-1">בחר ליד (אופציונלי)</span>
            <ChevronRight className="size-4 -scale-x-100" />
          </button>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10.5px] font-semibold text-muted-foreground/70">
              קהל:
            </span>
            {AUDIENCES.map((a) => {
              const active = audience === a;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => onAudience(a)}
                  className={
                    "press text-[11px] px-2 py-1 rounded-full font-medium border transition " +
                    (active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-secondary-foreground border-transparent")
                  }
                >
                  {AUDIENCE_LABELS[a]}
                </button>
              );
            })}
            <span className="text-[10.5px] font-semibold text-muted-foreground/70 mr-1">
              שפה:
            </span>
            {LANGUAGES.map((l) => {
              const active = language === l;
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => onLanguage(l)}
                  className={
                    "press text-[11px] px-2 py-1 rounded-full font-medium border transition " +
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
      )}
    </header>
  );
}

function EmptyChat({
  lead,
  onPick,
  onSeed,
}: {
  lead: LeadSearchHit | null;
  onPick: () => void;
  onSeed: (q: string) => void;
}) {
  const seeds = lead
    ? [
        `נסח טיוטה ראשונה ל${lead.name}`,
        `מה ההתנגדות הצפויה ואיך עונים עליה?`,
        `איך מקדם את ${lead.name} לסגירה?`,
      ]
    : [
        "נסח תשובה ראשונה ללקוח חדש שפנה בוואטסאפ",
        "מה לענות על 'יקר לי' בלי להוריד מחיר?",
        "איך מסביר ערך מוסף של מנייני תפילה במלון?",
      ];
  return (
    <div className="pt-6 space-y-5 text-center">
      <div className="space-y-1.5">
        <p className="text-sm font-semibold tracking-tight">
          {lead ? `על מה לחשוב לגבי ${lead.name}?` : "במה אעזור?"}
        </p>
        <p className="text-[12px] text-muted-foreground leading-relaxed max-w-xs mx-auto">
          {lead
            ? "יש לי את הפרופיל וההיסטוריה האחרונה. שאל אותי לנסח טיוטה, להבין את הלקוח, או לחשוב על אסטרטגיה."
            : "שאל שאלה כללית, או "}
          {!lead && (
            <button
              type="button"
              onClick={onPick}
              className="press underline underline-offset-2 text-primary"
            >
              בחר ליד
            </button>
          )}
          {!lead && " לדבר עליו ספציפית."}
        </p>
      </div>
      <div className="space-y-1.5">
        {seeds.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSeed(s)}
            className="press w-full text-right text-[13px] px-3 py-2.5 rounded-xl bg-card border border-border/70 hover:bg-accent/40 transition"
          >
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <Link
          href="/leads/import#whatsapp"
          className="press flex items-center gap-3 text-right p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-900 dark:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <MessageSquareText className="size-5 shrink-0 text-emerald-700 dark:text-emerald-300" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">ייבוא צ'אט וואטסאפ</div>
            <div className="text-[11px] text-emerald-900/70 dark:text-emerald-200/70 leading-snug">
              ZIP מוואטסאפ → AI מחלץ ליד מלא, כולל הודעות קוליות.
            </div>
          </div>
          <ChevronRight className="size-4 -scale-x-100 text-emerald-700/60 dark:text-emerald-300/60" />
        </Link>

        <Link
          href="/leads/import#email"
          className="press flex items-center gap-3 text-right p-3 rounded-2xl bg-primary/10 border border-primary/25 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Mail className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">ייבוא התכתבות מייל</div>
            <div className="text-[11px] text-muted-foreground leading-snug">
              כתובת מייל → נשלפת כל ההתכתבות ו-AI מחלץ ליד.
            </div>
          </div>
          <ChevronRight className="size-4 -scale-x-100 text-primary/60" />
        </Link>
      </div>
    </div>
  );
}

function Bubble({
  msg,
  isLast,
  lead,
  audience,
  language,
  onChange,
  onSaved,
  userQuestion,
}: {
  msg: Msg;
  isLast: boolean;
  lead: LeadSearchHit | null;
  audience: Audience;
  language: Language;
  onChange: (content: string) => void;
  onSaved: (id: string) => void;
  userQuestion: string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, startSave] = useTransition();

  const dirty = useMemo(() => {
    if (msg.role !== "assistant" || !msg.aiOriginal) return false;
    return msg.content.trim() !== msg.aiOriginal.trim();
  }, [msg.role, msg.aiOriginal, msg.content]);

  if (msg.role === "user") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3.5 py-2 text-[14px] leading-relaxed whitespace-pre-wrap shadow-soft">
          {msg.content}
        </div>
      </div>
    );
  }

  async function copy() {
    await navigator.clipboard.writeText(msg.content);
    setCopied(true);
    toast.success("הועתק");
    setTimeout(() => setCopied(false), 1400);
  }

  function save() {
    if (!msg.content.trim()) return;
    startSave(async () => {
      const res = await saveChatAsVoiceExample({
        leadId: lead?.id ?? null,
        audience,
        language,
        aiDraft: msg.aiOriginal ?? msg.content,
        finalText: msg.content,
        question: userQuestion,
      });
      if (!res.ok) {
        toast.error(res.error || "שמירה נכשלה");
        return;
      }
      onSaved(res.id);
      toast.success(
        dirty
          ? "נשמר — ה-AI ילמד מהעריכה שלך"
          : "נשמר כדוגמת סגנון"
      );
    });
  }

  const showActions = !msg.streaming && msg.content.trim().length > 0;

  return (
    <div className="flex justify-end">
      <div className="max-w-[92%] w-full space-y-1.5">
        <div className="rounded-2xl rounded-tl-sm bg-card border border-border/70 shadow-soft overflow-hidden">
          {editing ? (
            <textarea
              autoFocus
              value={msg.content}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => setEditing(false)}
              className="w-full text-[14px] leading-relaxed bg-transparent p-3 resize-y min-h-[120px] focus:outline-none"
              dir="auto"
            />
          ) : (
            <div
              className="text-[14px] leading-relaxed whitespace-pre-wrap p-3"
              dir="auto"
            >
              {msg.content || (msg.streaming ? "" : "—")}
              {msg.streaming && (
                <Loader2 className="inline-block size-3.5 animate-spin text-muted-foreground mr-1.5 align-middle" />
              )}
            </div>
          )}
        </div>

        {showActions && isLast && (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="press text-[11px] px-2 py-1 rounded-md text-muted-foreground hover:bg-accent/40"
            >
              {editing ? "סיים עריכה" : "ערוך"}
            </button>
            <button
              type="button"
              onClick={copy}
              className="press text-[11px] px-2 py-1 rounded-md text-muted-foreground hover:bg-accent/40 inline-flex items-center gap-1"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "הועתק" : "העתק"}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !!msg.savedAs}
              className={
                "press text-[11px] px-2.5 py-1 rounded-md inline-flex items-center gap-1 disabled:opacity-50 " +
                (msg.savedAs
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : dirty
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "bg-primary/10 text-primary")
              }
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : msg.savedAs ? (
                <Check className="size-3" />
              ) : (
                <BookmarkPlus className="size-3" />
              )}
              {msg.savedAs
                ? "נשמר"
                : dirty
                  ? "שמור עם העריכות"
                  : "שמור כדוגמה"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onKeyDown,
  streaming,
  lead,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  streaming: boolean;
  lead: LeadSearchHit | null;
}) {
  const [pasting, startPaste] = useTransition();

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error("הקליפבורד ריק");
        return;
      }
      // If a lead is picked, also log it as an interaction so the chat has fresh context.
      if (lead) {
        startPaste(async () => {
          const res = await logPasteToLead({
            leadId: lead.id,
            content: text,
            type: "whatsapp",
          });
          if (!res.ok) toast.error(res.error || "שמירת ההדבקה נכשלה");
          else toast.success("נשמר כאינטראקציה");
        });
      }
      onChange(value ? `${value}\n\n${text}` : text);
    } catch {
      toast.error("לא הצלחתי להדביק — הקלד ידנית");
    }
  }

  return (
    <div className="sticky bottom-0 z-10 border-t border-border/60 bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 px-3 py-2.5">
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={pasteFromClipboard}
          disabled={pasting}
          aria-label="הדבק מהקליפבורד"
          className="press shrink-0 size-11 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center disabled:opacity-50"
        >
          {pasting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ClipboardPaste className="size-4" />
          )}
        </button>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={
            lead
              ? `שאל על ${lead.name} או בקש לנסח...`
              : "שאל שאלה או הדבק טקסט וואטסאפ..."
          }
          className="flex-1 text-[15px] resize-none rounded-2xl border border-border bg-card px-3.5 py-2.5 max-h-[180px] min-h-[44px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
          dir="auto"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="עצור"
            className="press shrink-0 size-11 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
          >
            <StopCircle className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!value.trim()}
            aria-label="שלח"
            className="press shrink-0 size-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40"
          >
            <Send className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function LeadPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (l: LeadSearchHit) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LeadSearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const rows = await searchLeadsForChat({ q: term, limit: 12 });
      if (!cancelled) {
        setHits(rows);
        setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="בחר ליד"
    >
      <div
        className="w-full sm:max-w-md bg-card border-t sm:border border-border rounded-t-3xl sm:rounded-3xl shadow-soft p-4 space-y-3 max-h-[85dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[15px]">בחר ליד</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className="press size-8 rounded-full hover:bg-accent/40 flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="שם או טלפון..."
            className="w-full h-11 pr-10 pl-3 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {loading && (
            <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 overflow-y-auto -mx-4 px-4 space-y-1.5">
          {q.trim() && !loading && hits.length === 0 && (
            <p className="text-[12px] text-muted-foreground text-center py-6">
              לא נמצאו לידים
            </p>
          )}
          {hits.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onPick(l)}
              className="press w-full text-right p-3 rounded-xl border border-border/70 hover:bg-accent/40 transition"
            >
              <div className="text-[14px] font-semibold truncate">{l.name}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums truncate">
                {l.phone} · {AUDIENCE_LABELS[l.audience]} · {LANGUAGE_LABELS[l.language]}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
