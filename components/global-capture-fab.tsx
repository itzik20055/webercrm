"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  MessageSquarePlus,
  X,
  Loader2,
  Search,
  UserPlus,
  Phone,
} from "lucide-react";
import { findLeadsForCapture, type LeadMatch } from "@/app/(app)/leads/actions";
import { STATUS_LABELS } from "@/db/schema";
import { smartDate } from "@/lib/format";

type Step = "compose" | "match";

function encodeForUrl(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return encodeURIComponent(btoa(bin));
}

export function GlobalCaptureFab() {
  const router = useRouter();
  const pathname = usePathname();
  const hidden =
    /^\/leads\/[^/]+/.test(pathname) ||
    pathname === "/login" ||
    pathname.startsWith("/leads/new") ||
    pathname.startsWith("/leads/import");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("compose");
  const [text, setText] = useState("");
  const [phones, setPhones] = useState<string[]>([]);
  const [matches, setMatches] = useState<LeadMatch[]>([]);
  const [recent, setRecent] = useState<LeadMatch[]>([]);
  const [pending, startSearch] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function reset() {
    setStep("compose");
    setText("");
    setPhones([]);
    setMatches([]);
    setRecent([]);
  }

  function close() {
    setOpen(false);
    setTimeout(reset, 200);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open && step === "compose") {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, step]);

  function search() {
    const trimmed = text.trim();
    if (!trimmed) return;
    startSearch(async () => {
      const res = await findLeadsForCapture(trimmed);
      setPhones(res.phones);
      setMatches(res.matches);
      setRecent(res.recent);
      setStep("match");
    });
  }

  function pickLead(lead: LeadMatch) {
    const url = `/leads/${lead.id}?capture=${encodeForUrl(text)}#capture`;
    close();
    router.push(url);
  }

  function createNew() {
    const params = new URLSearchParams();
    if (phones[0]) params.set("phone", phones[0]);
    if (text.trim()) params.set("notes", text.trim().slice(0, 1000));
    close();
    router.push(`/leads/new?${params.toString()}`);
  }

  if (hidden && !open) return null;

  return (
    <>
      {!hidden && (
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

          <div className="relative w-full max-w-lg bg-card rounded-t-3xl border-t border-x border-border shadow-pop max-h-[88dvh] flex flex-col animate-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="font-bold text-base tracking-tight">
                {step === "compose" ? "תיעוד מהיר" : "לאיזה ליד לקשר?"}
              </h2>
              <button
                type="button"
                onClick={close}
                className="press size-9 rounded-full hover:bg-accent flex items-center justify-center"
                aria-label="סגור"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] overflow-y-auto flex-1 space-y-3">
              {step === "compose" && (
                <>
                  <p className="text-xs text-muted-foreground">
                    הדבק טקסט מוואטסאפ או רשום סיכום שיחה. נחפש לידים קיימים לפי הטלפון בטקסט.
                  </p>
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="הדבק כאן…"
                    dir="auto"
                    className="w-full text-sm rounded-xl border border-border bg-background p-3 min-h-[160px] resize-y placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/30 leading-relaxed"
                  />
                  <button
                    type="button"
                    disabled={pending || !text.trim()}
                    onClick={search}
                    className="press w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {pending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Search className="size-4" />
                    )}
                    המשך
                  </button>
                </>
              )}

              {step === "match" && (
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
                          <LeadRow key={m.id} lead={m} onPick={pickLead} highlight />
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
                            <LeadRow key={r.id} lead={r} onPick={pickLead} />
                          ))}
                      </ul>
                    </section>
                  )}

                  <button
                    type="button"
                    onClick={createNew}
                    className="press w-full h-12 rounded-xl bg-primary-soft text-primary border border-primary/15 font-semibold flex items-center justify-center gap-2"
                  >
                    <UserPlus className="size-4" />
                    ליד חדש מהטקסט
                  </button>

                  <button
                    type="button"
                    onClick={() => setStep("compose")}
                    className="press w-full h-10 rounded-xl bg-card border border-border text-sm text-muted-foreground"
                  >
                    חזור לעריכה
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
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
          (highlight
            ? "bg-primary-soft border-primary/20"
            : "bg-card border-border")
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
