"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mic,
  Mail,
  UserPlus,
  UserCheck,
  Phone as PhoneIcon,
} from "lucide-react";
import {
  AUDIENCE_LABELS,
  LANGUAGE_LABELS,
  STATUS_LABELS,
  PRIORITY_LABELS,
  INTEREST_TAG_LABELS,
} from "@/db/schema";
import {
  createLeadFromImport,
  mergeImportIntoLead,
} from "@/app/(app)/leads/actions";
import {
  approvePendingExtraction,
  approveCallRecording,
  mergeCallRecording,
  approveEmailImport,
  mergeEmailImport,
} from "@/app/(app)/inbox/actions";

export interface ExtractedLeadData {
  customerName: string | null;
  language: "he" | "en" | "yi";
  audience: "israeli_haredi" | "american_haredi" | "european_haredi";
  numAdults: number | null;
  numChildren: number | null;
  agesChildren: string | null;
  datesInterest: string | null;
  roomTypeInterest: string | null;
  budgetSignal: "low" | "mid" | "high" | null;
  interestTags: string[];
  whatSpokeToThem: string | null;
  objections: string | null;
  status:
    | "new"
    | "contacted"
    | "interested"
    | "quoted"
    | "closing"
    | "booked"
    | "lost";
  priority: "hot" | "warm" | "cold";
  summary: string;
  suggestedFollowupHours: number | null;
  suggestedFollowupReason: string | null;
  followupReasoning: string;
}

export interface ExistingMatch {
  id: string;
  name: string;
  phone: string;
  status: string;
  updatedAt: string;
}

export type ReviewMode =
  | {
      kind: "import";
      pendingImportId: string;
      inferredName: string | null;
      inferredPhone: string | null;
      existingMatches: ExistingMatch[];
      audioStats: { total: number; transcribed: number; skipped: number };
      chatTranscript: string;
      messageCount: number;
    }
  | {
      kind: "approve";
      leadId: string;
      leadName: string;
      leadPhone: string;
      transcriptPreview?: string | null;
      sourceLabel: string;
    }
  | {
      kind: "call";
      pendingId: string;
      inferredName: string | null;
      inferredPhone: string;
      existingMatches: ExistingMatch[];
      transcriptPreview: string | null;
      callAtLabel: string;
      direction: "in" | "out";
    }
  | {
      kind: "email-import";
      pendingId: string;
      inferredName: string | null;
      emailAddress: string;
      existingMatches: ExistingMatch[];
      messageCount: number;
    };

export function LeadReviewForm({
  extracted,
  mode,
}: {
  extracted: ExtractedLeadData;
  mode: ReviewMode;
}) {
  const [mergeWith, setMergeWith] = useState<string | null>(() => {
    if (
      mode.kind === "import" ||
      mode.kind === "call" ||
      mode.kind === "email-import"
    ) {
      if (
        mode.existingMatches.length === 1 &&
        mode.existingMatches[0].name.trim() === (mode.inferredName ?? "").trim()
      ) {
        return mode.existingMatches[0].id;
      }
    }
    return null;
  });
  const [name, setName] = useState(() => {
    if (mode.kind === "import")
      return mode.inferredName ?? extracted.customerName ?? "";
    if (mode.kind === "call")
      return mode.inferredName ?? extracted.customerName ?? "";
    if (mode.kind === "email-import")
      return mode.inferredName ?? extracted.customerName ?? "";
    // For auto-created leads from call recordings, name === phone is a
    // placeholder — prefer the AI-extracted name from the conversation.
    const isPlaceholder = mode.leadName === mode.leadPhone;
    if (isPlaceholder) return extracted.customerName ?? "";
    return mode.leadName;
  });
  const [phone, setPhone] = useState(() => {
    if (mode.kind === "import") return mode.inferredPhone ?? "";
    if (mode.kind === "call") return mode.inferredPhone;
    if (mode.kind === "email-import") return "";
    return mode.leadPhone;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const followupDefault = extracted.suggestedFollowupHours
    ? toLocalDateTimeInput(
        new Date(Date.now() + extracted.suggestedFollowupHours * 3600 * 1000)
      )
    : "";

  const identityRequired = mode.kind === "approve" || !mergeWith;

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        if (mode.kind === "import") {
          if (mergeWith) {
            formData.set("leadId", mergeWith);
            await mergeImportIntoLead(formData);
          } else {
            await createLeadFromImport(formData);
          }
        } else if (mode.kind === "call") {
          if (mergeWith) {
            formData.set("leadId", mergeWith);
            await mergeCallRecording(mode.pendingId, formData);
          } else {
            await approveCallRecording(mode.pendingId, formData);
          }
        } else if (mode.kind === "email-import") {
          if (mergeWith) {
            formData.set("leadId", mergeWith);
            await mergeEmailImport(mode.pendingId, formData);
          } else {
            await approveEmailImport(mode.pendingId, formData);
          }
        } else {
          await approvePendingExtraction(mode.leadId, formData);
        }
      } catch (err) {
        // next/navigation redirect throws a special error — let it propagate.
        if (
          err instanceof Error &&
          (err.message === "NEXT_REDIRECT" ||
            (err as { digest?: string }).digest?.startsWith?.("NEXT_REDIRECT"))
        ) {
          throw err;
        }
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4 pb-4">
      {mode.kind === "import" && mode.audioStats.total > 0 && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm flex items-start gap-2">
          <Mic className="size-4 text-emerald-700 dark:text-emerald-300 mt-0.5 shrink-0" />
          <div>
            תומללו <strong>{mode.audioStats.transcribed}</strong> מתוך{" "}
            <strong>{mode.audioStats.total}</strong> הודעות קוליות
            {mode.audioStats.skipped > 0 &&
              ` (${mode.audioStats.skipped} לא הצליחו)`}
          </div>
        </div>
      )}

      {mode.kind === "approve" && (
        <div className="rounded-xl bg-primary-soft border border-primary/20 p-3 text-sm flex items-center gap-2">
          <PhoneIcon className="size-4 text-primary shrink-0" />
          <div>
            מקור: <strong>{mode.sourceLabel}</strong>
          </div>
        </div>
      )}

      {mode.kind === "call" && (
        <div className="rounded-xl bg-primary-soft border border-primary/20 p-3 text-sm flex items-center gap-2">
          <PhoneIcon className="size-4 text-primary shrink-0" />
          <div>
            <strong>
              {mode.direction === "in" ? "שיחה נכנסת" : "שיחה יוצאת"}
            </strong>{" "}
            · {mode.callAtLabel}
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-card p-4 space-y-2 shadow-soft">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          סיכום AI
          {mode.kind === "import" && ` · ${mode.messageCount} הודעות`}
        </div>
        <div className="text-sm whitespace-pre-line leading-relaxed">
          {extracted.summary}
        </div>
      </div>

      {mode.kind === "email-import" && (
        <div className="rounded-xl bg-primary-soft border border-primary/20 p-3 text-sm flex items-start gap-2">
          <Mail className="size-4 text-primary mt-0.5 shrink-0" />
          <div>
            <div>
              ייבוא מייל ·{" "}
              <strong dir="ltr">{mode.emailAddress}</strong>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {mode.messageCount} הודעות מה-1 באפריל 2026 והלאה
            </div>
          </div>
        </div>
      )}

      {(mode.kind === "import" ||
        mode.kind === "call" ||
        mode.kind === "email-import") &&
        mode.existingMatches.length > 0 && (
        <Section title="לידים דומים במערכת">
          <p className="text-xs text-muted-foreground">
            נמצאו לידים בשם זהה או דומה. בחר אם למזג את השיחה לליד קיים, או ליצור
            ליד חדש.
          </p>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 p-2.5 rounded-lg border has-[:checked]:bg-primary-soft has-[:checked]:border-primary cursor-pointer">
              <input
                type="radio"
                name="_target"
                checked={mergeWith === null}
                onChange={() => setMergeWith(null)}
                className="sr-only"
              />
              <UserPlus className="size-4 text-primary" />
              <div className="text-sm font-medium">צור ליד חדש</div>
            </label>
            {mode.existingMatches.map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-2 p-2.5 rounded-lg border has-[:checked]:bg-primary-soft has-[:checked]:border-primary cursor-pointer"
              >
                <input
                  type="radio"
                  name="_target"
                  checked={mergeWith === m.id}
                  onChange={() => setMergeWith(m.id)}
                  className="sr-only"
                />
                <UserCheck className="size-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.phone} · {m.status}
                  </div>
                </div>
              </label>
            ))}
          </div>
          {mergeWith && (
            <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
              השיחה תתווסף להיסטוריה של הליד הקיים. שדות ריקים יתמלאו, שדות
              מלאים לא ייכתבו מחדש. תגיות עניין ימוזגו.
            </p>
          )}
        </Section>
      )}

      <Section
        title={
          (mode.kind === "import" ||
            mode.kind === "call" ||
            mode.kind === "email-import") &&
          mergeWith
            ? "פרטים שיתעדכנו"
            : "פרטי ליד"
        }
      >
        {identityRequired && (
          <>
            <Field label="שם" htmlFor="lrf-name">
              <input
                id="lrf-name"
                name="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-11 px-3 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                autoComplete="name"
              />
              {extracted.customerName &&
                extracted.customerName.trim() !== name.trim() && (
                  <button
                    type="button"
                    onClick={() => setName(extracted.customerName ?? "")}
                    className="mt-1 inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1 -mx-1"
                  >
                    AI חילץ מהשיחה: <strong>{extracted.customerName}</strong>{" "}
                    · החלף
                  </button>
                )}
            </Field>
            <Field label="טלפון" htmlFor="lrf-phone">
              <input
                id="lrf-phone"
                name="phone"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="לדוגמה: 0501234567"
                className="w-full h-11 px-3 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
              />
            </Field>
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="שפה" htmlFor="lrf-language">
            <Select
              id="lrf-language"
              name="language"
              defaultValue={extracted.language}
              options={Object.entries(LANGUAGE_LABELS)}
            />
          </Field>
          <Field label="קהל" htmlFor="lrf-audience">
            <Select
              id="lrf-audience"
              name="audience"
              defaultValue={extracted.audience}
              options={Object.entries(AUDIENCE_LABELS)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="סטטוס" htmlFor="lrf-status">
            <Select
              id="lrf-status"
              name="status"
              defaultValue={extracted.status}
              options={Object.entries(STATUS_LABELS)}
            />
          </Field>
          <Field label="עדיפות" htmlFor="lrf-priority">
            <Select
              id="lrf-priority"
              name="priority"
              defaultValue={extracted.priority}
              options={Object.entries(PRIORITY_LABELS)}
            />
          </Field>
        </div>
      </Section>

      <Section title="פרטי הזמנה (אם זוהו)">
        <div className="grid grid-cols-2 gap-2">
          <Field label="מבוגרים" htmlFor="lrf-adults">
            <input
              id="lrf-adults"
              name="numAdults"
              type="number"
              min={0}
              defaultValue={extracted.numAdults ?? ""}
              className="w-full h-11 px-3 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
              inputMode="numeric"
            />
          </Field>
          <Field label="ילדים" htmlFor="lrf-children">
            <input
              id="lrf-children"
              name="numChildren"
              type="number"
              min={0}
              defaultValue={extracted.numChildren ?? ""}
              className="w-full h-11 px-3 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
              inputMode="numeric"
            />
          </Field>
        </div>
        <Field label="גילאי ילדים" htmlFor="lrf-ages">
          <input
            id="lrf-ages"
            name="agesChildren"
            defaultValue={extracted.agesChildren ?? ""}
            placeholder="לדוגמה: 5, 8, 12"
            className="w-full h-11 px-3 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
          />
        </Field>
        <Field label="תאריכים" htmlFor="lrf-dates">
          <input
            id="lrf-dates"
            name="datesInterest"
            defaultValue={extracted.datesInterest ?? ""}
            placeholder="לדוגמה: 1-7 אוגוסט"
            className="w-full h-11 px-3 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
          />
        </Field>
        <Field label="סוג חדר" htmlFor="lrf-room">
          <input
            id="lrf-room"
            name="roomTypeInterest"
            defaultValue={extracted.roomTypeInterest ?? ""}
            className="w-full h-11 px-3 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
          />
        </Field>
        <Field label="תקציב" htmlFor="lrf-budget">
          <select
            id="lrf-budget"
            name="budgetSignal"
            defaultValue={extracted.budgetSignal ?? ""}
            className="w-full h-11 px-3 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
          >
            <option value="">לא ידוע</option>
            <option value="low">נמוך</option>
            <option value="mid">בינוני</option>
            <option value="high">גבוה</option>
          </select>
        </Field>
      </Section>

      <Section title="תחומי עניין">
        <div className="flex flex-wrap gap-2">
          {Object.entries(INTEREST_TAG_LABELS).map(([key, label]) => {
            const checked = extracted.interestTags.includes(key);
            return (
              <label
                key={key}
                className="flex items-center gap-1.5 px-3 h-9 rounded-full border has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:border-primary cursor-pointer text-sm focus-within:ring-2 focus-within:ring-primary/40"
              >
                <input
                  type="checkbox"
                  name="interestTags"
                  value={key}
                  defaultChecked={checked}
                  className="sr-only"
                />
                {label}
              </label>
            );
          })}
        </div>
      </Section>

      <Section title="תובנות AI">
        <Field label="מה דיבר אליהם" htmlFor="lrf-what">
          <textarea
            id="lrf-what"
            name="whatSpokeToThem"
            rows={2}
            defaultValue={extracted.whatSpokeToThem ?? ""}
            className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
          />
        </Field>
        <Field label="התנגדויות / חששות" htmlFor="lrf-obj">
          <textarea
            id="lrf-obj"
            name="objections"
            rows={2}
            defaultValue={extracted.objections ?? ""}
            className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
          />
        </Field>
      </Section>

      {extracted.suggestedFollowupHours !== null && (
        <Section title="פולואפ מוצע">
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-2.5 text-xs">
            <div className="font-semibold mb-1 text-blue-900 dark:text-blue-200">
              למה המועד הזה:
            </div>
            <div className="text-blue-900/80 dark:text-blue-200/80 leading-relaxed">
              {extracted.followupReasoning}
            </div>
          </div>
          <Field label="מתי" htmlFor="lrf-followup-at">
            <input
              id="lrf-followup-at"
              name="followupAt"
              type="datetime-local"
              defaultValue={followupDefault}
              className="w-full h-11 px-3 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
              dir="ltr"
            />
          </Field>
          <Field label="סיבה" htmlFor="lrf-followup-reason">
            <input
              id="lrf-followup-reason"
              name="followupReason"
              defaultValue={extracted.suggestedFollowupReason ?? ""}
              className="w-full h-11 px-3 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
            />
          </Field>
        </Section>
      )}

      {mode.kind === "import" && (
        <>
          <input
            type="hidden"
            name="chatTranscript"
            value={mode.chatTranscript}
          />
          <input
            type="hidden"
            name="pendingImportId"
            value={mode.pendingImportId}
          />
        </>
      )}

      {mode.kind === "import" && (
        <details className="rounded-2xl border bg-card p-3 text-sm">
          <summary className="font-medium cursor-pointer">
            הצג את השיחה שה-AI ניתח ({mode.messageCount} הודעות)
          </summary>
          <pre
            className="text-xs mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono leading-relaxed text-muted-foreground"
            dir="ltr"
          >
            {mode.chatTranscript}
          </pre>
        </details>
      )}

      {mode.kind === "approve" && mode.transcriptPreview && (
        <details className="rounded-2xl border bg-card p-3 text-sm">
          <summary className="font-medium cursor-pointer">
            תמלול השיחה (תצוגה מקדימה)
          </summary>
          <pre className="text-xs mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono leading-relaxed text-muted-foreground">
            {mode.transcriptPreview}
            {mode.transcriptPreview.length >= 500 && "…"}
          </pre>
        </details>
      )}

      {mode.kind === "call" && mode.transcriptPreview && (
        <details className="rounded-2xl border bg-card p-3 text-sm" open>
          <summary className="font-medium cursor-pointer">
            תמלול מלא של השיחה
          </summary>
          <pre className="text-xs mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono leading-relaxed text-muted-foreground">
            {mode.transcriptPreview}
          </pre>
        </details>
      )}

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

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+64px)] -mx-4 px-4 py-3 bg-background/95 backdrop-blur-sm border-t border-border/60 flex gap-2">
        <Link
          href="/inbox"
          className="press h-12 px-4 rounded-full border border-border font-medium flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          חזרה
        </Link>
        <button
          type="submit"
          disabled={pending || (identityRequired && (!name || !phone))}
          className="press flex-1 h-12 rounded-full bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50 shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {pending ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <CheckCircle2 className="size-5" />
          )}
          {submitLabel(mode, mergeWith)}
        </button>
      </div>
    </form>
  );
}

function submitLabel(mode: ReviewMode, mergeWith: string | null): string {
  if (mode.kind === "import" || mode.kind === "call") {
    return mergeWith ? "מזג לליד הקיים" : "צור ליד";
  }
  return "אשר ושמור";
}

/**
 * Format a Date as the local-time string `<input type="datetime-local">`
 * expects (YYYY-MM-DDTHH:mm). Using `toISOString().slice(0,16)` would render
 * the time in UTC and shift the followup by the local timezone offset.
 */
function toLocalDateTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-sm font-semibold px-1">{title}</h3>
      <div className="bg-card border rounded-2xl p-3.5 space-y-2.5 shadow-soft">
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="text-xs text-muted-foreground block"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Select({
  id,
  name,
  defaultValue,
  options,
}: {
  id?: string;
  name: string;
  defaultValue: string;
  options: [string, string][];
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      className="w-full h-11 px-3 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
    >
      {options.map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}
