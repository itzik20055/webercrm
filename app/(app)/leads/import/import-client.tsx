"use client";

import { useState, useTransition } from "react";
import { Upload, Loader2, CheckCircle2, AlertCircle, Mic, UserPlus, UserCheck } from "lucide-react";
import { createLeadFromImport, mergeImportIntoLead } from "../actions";
import {
  AUDIENCE_LABELS,
  LANGUAGE_LABELS,
  STATUS_LABELS,
  PRIORITY_LABELS,
  INTEREST_TAG_LABELS,
} from "@/db/schema";

interface ExtractedLead {
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

interface ExistingMatch {
  id: string;
  name: string;
  phone: string;
  status: string;
  updatedAt: string;
}

interface ImportResponse {
  ok: boolean;
  inferredLeadName: string | null;
  inferredPhones: string[];
  audioStats: { total: number; transcribed: number; skipped: number };
  messageCount: number;
  firstMessageAt: string;
  lastMessageAt: string;
  lead: ExtractedLead;
  renderedChat: string;
  existingMatches: ExistingMatch[];
}

export function ImportClient({ myName }: { myName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<"he" | "en" | "yi">("he");
  const [phase, setPhase] = useState<"idle" | "uploading" | "review">("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [mergeWith, setMergeWith] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      const data = json as ImportResponse;
      setResult(data);
      setName(data.inferredLeadName ?? "");
      if (data.inferredPhones.length > 0) setPhone(data.inferredPhones[0]);
      // Auto-suggest merging if there's exactly one match with the same name
      if (
        data.existingMatches.length === 1 &&
        data.existingMatches[0].name.trim() === (data.inferredLeadName ?? "").trim()
      ) {
        setMergeWith(data.existingMatches[0].id);
      } else {
        setMergeWith(null);
      }
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  function handleSubmit(formData: FormData) {
    if (!result) return;
    setSaving(true);
    startTransition(async () => {
      try {
        if (mergeWith) {
          formData.set("leadId", mergeWith);
          await mergeImportIntoLead(formData);
        } else {
          await createLeadFromImport(formData);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSaving(false);
      }
    });
  }

  if (phase === "uploading") {
    return (
      <div className="rounded-xl border bg-card p-6 text-center space-y-3">
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
    const lead = result.lead;
    const followupAt = lead.suggestedFollowupHours
      ? new Date(Date.now() + lead.suggestedFollowupHours * 3600 * 1000)
          .toISOString()
          .slice(0, 16)
      : "";
    return (
      <form action={handleSubmit} className="space-y-4">
        {result.audioStats.total > 0 && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm flex items-start gap-2">
            <Mic className="size-4 text-emerald-700 mt-0.5 shrink-0" />
            <div>
              תומללו <strong>{result.audioStats.transcribed}</strong> מתוך{" "}
              <strong>{result.audioStats.total}</strong> הודעות קוליות
              {result.audioStats.skipped > 0 &&
                ` (${result.audioStats.skipped} לא הצליחו)`}
            </div>
          </div>
        )}

        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="text-sm text-muted-foreground">
            סיכום AI · {result.messageCount} הודעות
          </div>
          <div className="text-sm whitespace-pre-line">{lead.summary}</div>
        </div>

        {result.existingMatches.length > 0 && (
          <Section title="לידים דומים בשיטה">
            <p className="text-xs text-muted-foreground">
              נמצאו לידים בשם זהה או דומה. בחר אם למזג את השיחה לליד קיים, או
              ליצור ליד חדש.
            </p>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 p-2.5 rounded-lg border has-[:checked]:bg-primary/10 has-[:checked]:border-primary cursor-pointer">
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
              {result.existingMatches.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2 p-2.5 rounded-lg border has-[:checked]:bg-primary/10 has-[:checked]:border-primary cursor-pointer"
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
                ℹ️ השיחה תתווסף להיסטוריה של הליד הקיים. שדות ריקים יתמלאו, שדות
                מלאים לא ייכתבו מחדש. תגיות עניין ימוזגו.
              </p>
            )}
          </Section>
        )}

        <Section title={mergeWith ? "פרטים שיתעדכנו" : "פרטי ליד"}>
          {!mergeWith && (
            <>
              <Field label="שם">
                <input
                  name="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-11 px-3 rounded-lg border bg-background"
                />
              </Field>
              <Field label="טלפון">
                <input
                  name="phone"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="לדוגמה: 0501234567"
                  className="w-full h-11 px-3 rounded-lg border bg-background"
                  dir="ltr"
                />
              </Field>
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="שפה">
              <Select
                name="language"
                defaultValue={lead.language}
                options={Object.entries(LANGUAGE_LABELS)}
              />
            </Field>
            <Field label="קהל">
              <Select
                name="audience"
                defaultValue={lead.audience}
                options={Object.entries(AUDIENCE_LABELS)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="סטטוס">
              <Select
                name="status"
                defaultValue={lead.status}
                options={Object.entries(STATUS_LABELS)}
              />
            </Field>
            <Field label="עדיפות">
              <Select
                name="priority"
                defaultValue={lead.priority}
                options={Object.entries(PRIORITY_LABELS)}
              />
            </Field>
          </div>
        </Section>

        <Section title="פרטי הזמנה (אם זוהו)">
          <div className="grid grid-cols-2 gap-2">
            <Field label="מבוגרים">
              <input
                name="numAdults"
                type="number"
                min={0}
                defaultValue={lead.numAdults ?? ""}
                className="w-full h-11 px-3 rounded-lg border bg-background"
              />
            </Field>
            <Field label="ילדים">
              <input
                name="numChildren"
                type="number"
                min={0}
                defaultValue={lead.numChildren ?? ""}
                className="w-full h-11 px-3 rounded-lg border bg-background"
              />
            </Field>
          </div>
          <Field label="גילאי ילדים">
            <input
              name="agesChildren"
              defaultValue={lead.agesChildren ?? ""}
              placeholder="לדוגמה: 5, 8, 12"
              className="w-full h-11 px-3 rounded-lg border bg-background"
            />
          </Field>
          <Field label="תאריכים">
            <input
              name="datesInterest"
              defaultValue={lead.datesInterest ?? ""}
              placeholder="לדוגמה: 1-7 אוגוסט"
              className="w-full h-11 px-3 rounded-lg border bg-background"
            />
          </Field>
          <Field label="סוג חדר">
            <input
              name="roomTypeInterest"
              defaultValue={lead.roomTypeInterest ?? ""}
              className="w-full h-11 px-3 rounded-lg border bg-background"
            />
          </Field>
          <Field label="תקציב">
            <select
              name="budgetSignal"
              defaultValue={lead.budgetSignal ?? ""}
              className="w-full h-11 px-3 rounded-lg border bg-background"
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
              const checked = lead.interestTags.includes(key);
              return (
                <label
                  key={key}
                  className="flex items-center gap-1.5 px-3 h-9 rounded-full border has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:border-primary cursor-pointer text-sm"
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
          <Field label="מה דיבר אליהם">
            <textarea
              name="whatSpokeToThem"
              rows={2}
              defaultValue={lead.whatSpokeToThem ?? ""}
              className="w-full px-3 py-2 rounded-lg border bg-background"
            />
          </Field>
          <Field label="התנגדויות / חששות">
            <textarea
              name="objections"
              rows={2}
              defaultValue={lead.objections ?? ""}
              className="w-full px-3 py-2 rounded-lg border bg-background"
            />
          </Field>
        </Section>

        {lead.suggestedFollowupHours !== null && (
          <Section title="פולואפ מוצע">
            <div className="rounded-md bg-blue-50 border border-blue-200 p-2.5 text-xs text-blue-900">
              <div className="font-medium mb-1">למה המועד הזה:</div>
              <div>{lead.followupReasoning}</div>
            </div>
            <Field label="מתי">
              <input
                name="followupAt"
                type="datetime-local"
                defaultValue={followupAt}
                className="w-full h-11 px-3 rounded-lg border bg-background"
                dir="ltr"
              />
            </Field>
            <Field label="סיבה">
              <input
                name="followupReason"
                defaultValue={lead.suggestedFollowupReason ?? ""}
                className="w-full h-11 px-3 rounded-lg border bg-background"
              />
            </Field>
          </Section>
        )}

        <input type="hidden" name="chatTranscript" value={result.renderedChat} />

        <details className="rounded-xl border bg-card p-3 text-sm">
          <summary className="font-medium cursor-pointer">
            הצג את השיחה שה-AI ניתח ({result.messageCount} הודעות)
          </summary>
          <pre className="text-xs mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono leading-relaxed text-muted-foreground" dir="ltr">
            {result.renderedChat}
          </pre>
        </details>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-2 sticky bottom-20 pt-2">
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setPhase("idle");
              setError(null);
            }}
            className="h-12 px-4 rounded-lg border font-medium"
          >
            בטל
          </button>
          <button
            type="submit"
            disabled={pending || saving || (!mergeWith && (!name || !phone))}
            className="flex-1 h-12 rounded-lg bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {pending || saving ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-5" />
            )}
            {mergeWith ? "מזג לליד הקיים" : "צור ליד"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleUpload} className="space-y-4">
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="text-sm text-muted-foreground">
          השם שלך בוואטסאפ: <strong className="text-foreground">{myName}</strong>
        </div>

        <label className="flex items-center justify-center w-full h-32 rounded-lg border-2 border-dashed cursor-pointer hover:bg-accent">
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
          <label className="text-sm font-medium block mb-1.5">שפה עיקרית בשיחה</label>
          <div className="grid grid-cols-3 gap-1.5">
            {(["he", "en", "yi"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLanguage(l)}
                className={
                  "h-10 rounded-lg border text-sm font-medium " +
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
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive flex items-start gap-2">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!file}
        className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-50"
      >
        עבד עם AI
      </button>
    </form>
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
      <div className="bg-card border rounded-xl p-3 space-y-2.5">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Select({
  name,
  defaultValue,
  options,
}: {
  name: string;
  defaultValue: string;
  options: [string, string][];
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className="w-full h-11 px-3 rounded-lg border bg-background"
    >
      {options.map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}
