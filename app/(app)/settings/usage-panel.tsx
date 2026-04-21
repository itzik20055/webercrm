import Link from "next/link";
import { db, aiAuditLog, leads } from "@/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { AlertTriangle, CircleDollarSign } from "lucide-react";

const COST_PER_REQ_USD: Record<string, number> = {
  "google/gemini-2.5-pro": 0.08,
  "google/gemini-2.5-flash": 0.017,
  "anthropic/claude-sonnet-4.6": 0.11,
  "anthropic/claude-opus-4-7": 0.25,
  "anthropic/claude-haiku-4-5": 0.005,
  "openai/text-embedding-3-small": 0.0001,
};

const OP_LABEL: Record<string, string> = {
  transcribe: "תמלול שיחה",
  extract: "חילוץ ליד",
  draft: "ניסוח טיוטה",
  chat: "צ'אט",
  learning: "למידה לילית",
  embed: "אינדוקס",
};

function fmtUsd(n: number) {
  return `$${n.toFixed(2)}`;
}

function relTime(d: Date) {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${m} דק'`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} ש'`;
  return d.toLocaleDateString("he-IL");
}

export async function UsagePanel() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const grouped = await db
    .select({
      operation: aiAuditLog.operation,
      model: aiAuditLog.model,
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${aiAuditLog.error} is not null)::int`,
    })
    .from(aiAuditLog)
    .where(gte(aiAuditLog.createdAt, since))
    .groupBy(aiAuditLog.operation, aiAuditLog.model)
    .orderBy(desc(sql`count(*)`));

  let estCost = 0;
  let totalReq = 0;
  let totalFailed = 0;
  for (const r of grouped) {
    totalReq += r.total;
    totalFailed += r.failed;
    const per = COST_PER_REQ_USD[r.model ?? ""] ?? 0;
    estCost += r.total * per;
  }

  const recentFailures = await db
    .select({
      id: aiAuditLog.id,
      operation: aiAuditLog.operation,
      model: aiAuditLog.model,
      error: aiAuditLog.error,
      createdAt: aiAuditLog.createdAt,
      leadId: aiAuditLog.leadId,
      leadName: leads.name,
    })
    .from(aiAuditLog)
    .leftJoin(leads, eq(leads.id, aiAuditLog.leadId))
    .where(and(gte(aiAuditLog.createdAt, since), sql`${aiAuditLog.error} is not null`))
    .orderBy(desc(aiAuditLog.createdAt))
    .limit(8);

  const transcribeRow = grouped.find((g) => g.operation === "transcribe");
  const extractRow = grouped.find((g) => g.operation === "extract");
  const dupRisk =
    transcribeRow && extractRow
      ? Math.max(0, extractRow.total - transcribeRow.total)
      : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="קריאות 24ש'" value={totalReq.toLocaleString("he-IL")} />
        <Stat label="עלות משוערת" value={fmtUsd(estCost)} />
        <Stat
          label="כשלונות"
          value={totalFailed.toString()}
          tone={totalFailed > 0 ? "danger" : "default"}
        />
      </div>

      {totalFailed > 0 && (
        <div className="text-[12px] bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            יש {totalFailed} קריאות שנכשלו. תמלולים שנכשלו <b>נשלחים שוב</b> בריצה
            הבאה — אם הכשלון היה זמני אתה משלם פעמיים. בדוק את הרשימה למטה.
          </div>
        </div>
      )}

      {dupRisk > 0 && (
        <div className="text-[12px] bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            {dupRisk} קריאות חילוץ נוספות מעבר למספר התמלולים — כנראה שלידים
            קיימים מקבלים aggregate-fill על כל הקלטה חדשה. שווה לשקול לדלג אם אין
            תמלול חדש משמעותי.
          </div>
        </div>
      )}

      <ul className="divide-y divide-border/60 border border-border/60 rounded-xl overflow-hidden">
        {grouped.map((g) => {
          const per = COST_PER_REQ_USD[g.model ?? ""] ?? 0;
          const cost = g.total * per;
          return (
            <li
              key={`${g.operation}-${g.model}`}
              className="flex items-center justify-between gap-3 p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {OP_LABEL[g.operation] ?? g.operation}
                  {g.failed > 0 && (
                    <span className="text-destructive text-[11px] font-semibold ms-1.5">
                      ({g.failed} נכשלו)
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {g.model}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold tabular-nums">{g.total}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  ~{fmtUsd(cost)}
                </div>
              </div>
            </li>
          );
        })}
        {grouped.length === 0 && (
          <li className="p-4 text-sm text-muted-foreground text-center">
            אין קריאות AI ב-24 השעות האחרונות.
          </li>
        )}
      </ul>

      {recentFailures.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-[12px] font-semibold text-muted-foreground px-1">
            כשלונות אחרונים
          </h3>
          <ul className="divide-y divide-border/60 border border-border/60 rounded-xl overflow-hidden">
            {recentFailures.map((f) => (
              <li key={f.id} className="p-2.5 text-[12px] flex items-start gap-2">
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5 text-destructive" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {OP_LABEL[f.operation] ?? f.operation}
                      {f.leadName && (
                        <span className="text-muted-foreground font-normal">
                          {" · "}
                          {f.leadId ? (
                            <Link href={`/leads/${f.leadId}`} className="text-primary">
                              {f.leadName}
                            </Link>
                          ) : (
                            f.leadName
                          )}
                        </span>
                      )}
                    </span>
                    <span className="text-[10.5px] text-muted-foreground tabular-nums">
                      {relTime(f.createdAt)}
                    </span>
                  </div>
                  <p className="text-muted-foreground line-clamp-2">{f.error}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10.5px] text-muted-foreground leading-relaxed flex items-start gap-1">
        <CircleDollarSign className="size-3 shrink-0 mt-0.5" />
        עלות משוערת — חישוב גס לפי מודל ובקשה. הסכום המדויק מופיע ב-Vercel AI
        Gateway.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className={
        "rounded-xl border p-2.5 " +
        (tone === "danger"
          ? "bg-destructive/8 border-destructive/30"
          : "bg-background border-border/60")
      }
    >
      <div
        className={
          "text-lg font-bold tabular-nums " +
          (tone === "danger" ? "text-destructive" : "")
        }
      >
        {value}
      </div>
      <div className="text-[10.5px] text-muted-foreground">{label}</div>
    </div>
  );
}
