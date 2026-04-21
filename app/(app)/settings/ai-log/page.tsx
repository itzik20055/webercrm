import Link from "next/link";
import { db, aiAuditLog, leads } from "@/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { ChevronRight, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

const OP_LABEL: Record<string, string> = {
  transcribe: "תמלול שיחה",
  extract: "חילוץ ליד",
  draft: "ניסוח טיוטה",
  chat: "צ'אט",
  learning: "למידה לילית",
  embed: "אינדוקס",
};

const OP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "הכל" },
  { value: "transcribe", label: "תמלול" },
  { value: "extract", label: "חילוץ" },
  { value: "draft", label: "טיוטה" },
  { value: "chat", label: "צ'אט" },
  { value: "learning", label: "למידה" },
];

const RANGE_OPTIONS: Array<{ value: string; label: string; hours: number }> = [
  { value: "24h", label: "24 שעות", hours: 24 },
  { value: "7d", label: "7 ימים", hours: 24 * 7 },
  { value: "30d", label: "30 ימים", hours: 24 * 30 },
];

function fmtDate(d: Date) {
  return d.toLocaleString("he-IL", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default async function AiLogPage({
  searchParams,
}: {
  searchParams: Promise<{ op?: string; range?: string; failed?: string; lead?: string }>;
}) {
  const sp = await searchParams;
  const op = sp.op ?? "all";
  const range = sp.range ?? "24h";
  const failedOnly = sp.failed === "1";
  const leadFilter = sp.lead;

  const rangeCfg = RANGE_OPTIONS.find((r) => r.value === range) ?? RANGE_OPTIONS[0];
  const since = new Date(Date.now() - rangeCfg.hours * 60 * 60 * 1000);

  const whereParts = [gte(aiAuditLog.createdAt, since)];
  if (op !== "all") whereParts.push(eq(aiAuditLog.operation, op));
  if (failedOnly) whereParts.push(sql`${aiAuditLog.error} is not null`);
  if (leadFilter) whereParts.push(eq(aiAuditLog.leadId, leadFilter));

  const rows = await db
    .select({
      id: aiAuditLog.id,
      operation: aiAuditLog.operation,
      model: aiAuditLog.model,
      input: aiAuditLog.inputAnonymized,
      output: aiAuditLog.output,
      durationMs: aiAuditLog.durationMs,
      error: aiAuditLog.error,
      createdAt: aiAuditLog.createdAt,
      leadId: aiAuditLog.leadId,
      leadName: leads.name,
    })
    .from(aiAuditLog)
    .leftJoin(leads, eq(leads.id, aiAuditLog.leadId))
    .where(and(...whereParts))
    .orderBy(desc(aiAuditLog.createdAt))
    .limit(200);

  const filterQs = (params: Record<string, string | undefined>) => {
    const merged = { op, range, failed: failedOnly ? "1" : undefined, lead: leadFilter, ...params };
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "all") usp.set(k, v);
    }
    const q = usp.toString();
    return q ? `?${q}` : "";
  };

  return (
    <div className="px-4 pt-3 pb-8 space-y-4">
      <header className="flex items-center gap-2">
        <Link
          href="/settings"
          className="press size-11 -mr-2 rounded-full flex items-center justify-center hover:bg-accent"
          aria-label="חזרה להגדרות"
        >
          <ChevronRight className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight">לוג קריאות AI</h1>
          <p className="text-xs text-muted-foreground">
            {rows.length} קריאות · {rangeCfg.label}
            {failedOnly && " · רק כשלונות"}
            {leadFilter && " · ליד בודד"}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {OP_OPTIONS.map((o) => (
          <Link
            key={o.value}
            href={`/settings/ai-log${filterQs({ op: o.value })}`}
            className={
              "press text-[12px] px-2.5 py-1 rounded-full border " +
              (o.value === op
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card border-border")
            }
          >
            {o.label}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {RANGE_OPTIONS.map((r) => (
          <Link
            key={r.value}
            href={`/settings/ai-log${filterQs({ range: r.value })}`}
            className={
              "press text-[12px] px-2.5 py-1 rounded-full border " +
              (r.value === range
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card border-border")
            }
          >
            {r.label}
          </Link>
        ))}
        <span className="w-px h-4 bg-border mx-1" />
        <Link
          href={`/settings/ai-log${filterQs({ failed: failedOnly ? undefined : "1" })}`}
          className={
            "press text-[12px] px-2.5 py-1 rounded-full border " +
            (failedOnly
              ? "bg-destructive text-destructive-foreground border-destructive"
              : "bg-card border-border")
          }
        >
          רק כשלונות
        </Link>
        {leadFilter && (
          <Link
            href={`/settings/ai-log${filterQs({ lead: undefined })}`}
            className="press text-[12px] px-2.5 py-1 rounded-full border bg-card border-border"
          >
            × נקה סינון ליד
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          אין רשומות לפי הסינון.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="bg-card border border-border/70 rounded-2xl overflow-hidden"
            >
              <details className="group">
                <summary className="cursor-pointer p-3 flex items-start gap-2.5 list-none">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap text-[12px]">
                      <span className="font-semibold text-[13px]">
                        {OP_LABEL[r.operation] ?? r.operation}
                      </span>
                      {r.error && (
                        <span className="inline-flex items-center gap-1 text-destructive font-medium">
                          <AlertTriangle className="size-3" />
                          נכשל
                        </span>
                      )}
                      {r.leadName ? (
                        <span className="text-primary truncate max-w-[140px]">
                          {r.leadName}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5 truncate">
                      {r.model} · {fmtDate(r.createdAt)} · {fmtDuration(r.durationMs)}
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:-rotate-90 shrink-0 mt-0.5" />
                </summary>
                <div className="border-t border-border/60 divide-y divide-border/60 text-[12px]">
                  {r.error && (
                    <Block label="Error" body={r.error} tone="danger" />
                  )}
                  <Block label="Input (anonymized)" body={r.input} mono />
                  {r.output && <Block label="Output" body={r.output} mono />}
                  <div className="px-3 py-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="font-mono select-all">{r.id}</span>
                    {r.leadId && (
                      <Link
                        href={`/settings/ai-log${filterQs({ lead: r.leadId })}`}
                        className="text-primary press"
                      >
                        כל הקריאות לליד
                      </Link>
                    )}
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Block({
  label,
  body,
  mono,
  tone = "default",
}: {
  label: string;
  body: string;
  mono?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className={
        "px-3 py-2 " +
        (tone === "danger"
          ? "bg-destructive/8 text-destructive"
          : "bg-background/40 text-foreground")
      }
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        {label}
      </div>
      <pre
        className={
          "whitespace-pre-wrap break-words leading-relaxed max-h-[280px] overflow-y-auto " +
          (mono ? "font-mono text-[11px]" : "")
        }
        dir="auto"
      >
        {body}
      </pre>
    </div>
  );
}
