import Link from "next/link";
import { asc, count, desc, eq, sql } from "drizzle-orm";
import {
  ChevronRight,
  Brain,
  TrendingUp,
  TrendingDown,
  Clock,
  Hash,
} from "lucide-react";
import { db, voiceExamples, appSettings } from "@/db";
import { smartDate } from "@/lib/format";
import { DeleteExampleButton } from "./delete-button";

export const dynamic = "force-dynamic";

const VIEW_VALUES = ["recent", "top", "bottom"] as const;
type View = (typeof VIEW_VALUES)[number];

const SCENARIO_LABELS: Record<string, string> = {
  first_reply: "מענה ראשון",
  send_price: "שליחת מחיר",
  price_objection: "התנגדות מחיר",
  silent_followup: "פולואפ שקט",
  date_confirmation: "אישור תאריך",
  closing_request: "בקשת סגירה",
  general: "כללי",
};

const AUDIENCE_LABELS: Record<string, string> = {
  israeli_haredi: "חרדי ישראלי",
  american_haredi: "חרדי אמריקאי",
  european_haredi: "חרדי אירופאי",
};

const LANGUAGE_LABELS: Record<string, string> = {
  he: "עברית",
  en: "אנגלית",
  yi: "אידיש",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "ידני",
  auto_outcome: "אוטומטי",
};

const PAGE_SIZE = 30;

export default async function LearningPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const view: View = (VIEW_VALUES as readonly string[]).includes(sp.view ?? "")
    ? (sp.view as View)
    : "recent";

  const [statsRow, distribution, lastRunRow, examples] = await Promise.all([
    db
      .select({
        total: count(),
        avgScore: sql<number>`coalesce(avg(${voiceExamples.score}), 0)`.mapWith(Number),
        manual: sql<number>`count(*) filter (where ${voiceExamples.source} = 'manual')`.mapWith(
          Number
        ),
        auto: sql<number>`count(*) filter (where ${voiceExamples.source} = 'auto_outcome')`.mapWith(
          Number
        ),
        positive: sql<number>`count(*) filter (where ${voiceExamples.score} > 0)`.mapWith(Number),
        negative: sql<number>`count(*) filter (where ${voiceExamples.score} < 0)`.mapWith(Number),
      })
      .from(voiceExamples),
    db
      .select({
        audience: voiceExamples.audience,
        scenario: voiceExamples.scenario,
        c: count(),
      })
      .from(voiceExamples)
      .groupBy(voiceExamples.audience, voiceExamples.scenario),
    db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "learning_last_run_at")),
    db
      .select()
      .from(voiceExamples)
      .orderBy(
        view === "top"
          ? desc(voiceExamples.score)
          : view === "bottom"
            ? asc(voiceExamples.score)
            : desc(voiceExamples.createdAt)
      )
      .limit(PAGE_SIZE),
  ]);

  const s = statsRow[0] ?? {
    total: 0,
    avgScore: 0,
    manual: 0,
    auto: 0,
    positive: 0,
    negative: 0,
  };
  const lastRun = lastRunRow[0]?.value ? new Date(lastRunRow[0].value) : null;

  const audienceTotals: Record<string, number> = {};
  for (const d of distribution) {
    audienceTotals[d.audience] = (audienceTotals[d.audience] ?? 0) + Number(d.c);
  }

  const scenarioTotals: Record<string, number> = {};
  for (const d of distribution) {
    scenarioTotals[d.scenario] = (scenarioTotals[d.scenario] ?? 0) + Number(d.c);
  }
  const topScenarios = Object.entries(scenarioTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div className="px-4 pt-5 pb-6 space-y-5">
      <header className="space-y-1">
        <Link
          href="/kb"
          className="press text-xs text-muted-foreground inline-flex items-center gap-1"
        >
          <ChevronRight className="size-3" />
          חזרה לידע
        </Link>
        <div className="flex items-center gap-2">
          <Brain className="size-5 text-primary" />
          <h1 className="text-[26px] font-bold tracking-tight leading-tight">למידת AI</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          דוגמאות שה-AI לומד מהן כדי לחקות את הטון שלך. מחק דוגמאות שנוקדו שגוי
          - הן יפסיקו להשפיע על טיוטות עתידיות.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-2">
        <StatCard
          label="סה״כ דוגמאות"
          value={String(s.total)}
          sub={`${s.manual} ידני · ${s.auto} אוטומטי`}
        />
        <StatCard
          label="ציון ממוצע"
          value={s.total > 0 ? s.avgScore.toFixed(2) : "—"}
          sub={`${s.positive} חיוביות · ${s.negative} שליליות`}
        />
        <StatCard
          label="ריצה אחרונה"
          value={lastRun ? smartDate(lastRun) : "עוד לא רץ"}
          sub={lastRun ? lastRun.toLocaleString("he-IL") : "קרון מתוכנן 03:00 UTC"}
        />
        <StatCard
          label="קהלים מכוסים"
          value={String(Object.keys(audienceTotals).length)}
          sub={
            Object.entries(audienceTotals)
              .map(([a, c]) => `${AUDIENCE_LABELS[a] ?? a}: ${c}`)
              .join(" · ") || "—"
          }
        />
      </section>

      {topScenarios.length > 0 && (
        <section className="p-3 rounded-2xl bg-card border border-border/70 shadow-soft space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Hash className="size-3" />
            תרחישים נפוצים
          </div>
          <div className="flex flex-wrap gap-1.5">
            {topScenarios.map(([sc, c]) => (
              <span
                key={sc}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-secondary text-secondary-foreground"
              >
                {SCENARIO_LABELS[sc] ?? sc}
                <span className="tabular-nums opacity-70">{c}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="flex gap-2">
        {VIEW_VALUES.map((v) => {
          const active = v === view;
          const label =
            v === "recent" ? "חדשות" : v === "top" ? "ציון גבוה" : "ציון נמוך";
          const Icon = v === "recent" ? Clock : v === "top" ? TrendingUp : TrendingDown;
          return (
            <Link
              key={v}
              href={`/kb/learning?view=${v}`}
              aria-current={active ? "page" : undefined}
              className={
                "press h-9 px-3.5 rounded-full text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors duration-150 " +
                (active
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "bg-card border border-border text-muted-foreground")
              }
            >
              <Icon className="size-3.5" />
              {label}
            </Link>
          );
        })}
      </div>

      <div className="space-y-2">
        {examples.length === 0 ? (
          <div className="text-sm text-muted-foreground py-10 text-center bg-card/60 border border-dashed border-border rounded-2xl">
            עוד אין דוגמאות. הקרון הלילי יתחיל לאסוף אחרי שהלידים צוברים היסטוריה,
            או תוכל להריץ backfill על ההיסטוריה.
          </div>
        ) : (
          examples.map((e) => {
            const ctx = (e.contextSnapshot as Record<string, unknown> | null) ?? null;
            const rationale =
              typeof ctx?.rationale === "string" ? ctx.rationale : null;
            return (
              <article
                key={e.id}
                className="p-3.5 rounded-2xl bg-card border border-border/70 shadow-soft space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center flex-wrap gap-1.5 min-w-0">
                    <ScoreBadge score={Number(e.score)} />
                    <Tag>{SCENARIO_LABELS[e.scenario] ?? e.scenario}</Tag>
                    <Tag tone="muted">{AUDIENCE_LABELS[e.audience] ?? e.audience}</Tag>
                    <Tag tone="muted">{LANGUAGE_LABELS[e.language] ?? e.language}</Tag>
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {SOURCE_LABELS[e.source] ?? e.source}
                    </span>
                    {e.scenarioTag && (
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {e.scenarioTag}
                      </span>
                    )}
                  </div>
                  <DeleteExampleButton id={e.id} />
                </div>

                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {e.finalText}
                </p>

                {rationale && (
                  <p className="text-xs text-muted-foreground pr-2 border-r-2 border-primary/40">
                    <span className="font-semibold">ניתוח: </span>
                    {rationale}
                  </p>
                )}

                <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                  <span>{smartDate(e.createdAt)}</span>
                  {e.leadId && (
                    <Link
                      href={`/leads/${e.leadId}`}
                      className="press text-primary"
                    >
                      הליד המקורי
                    </Link>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="p-3 rounded-2xl bg-card border border-border/70 shadow-soft">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tracking-tight tabular-nums mt-0.5">{value}</div>
      {sub && (
        <div className="text-[10px] text-muted-foreground mt-1 truncate">{sub}</div>
      )}
    </div>
  );
}

function Tag({
  children,
  tone = "accent",
}: {
  children: React.ReactNode;
  tone?: "accent" | "muted";
}) {
  const cls =
    tone === "accent"
      ? "bg-secondary text-secondary-foreground"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {children}
    </span>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score > 0.3
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : score < -0.3
        ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
        : "bg-muted text-muted-foreground";
  const sign = score > 0 ? "+" : "";
  return (
    <span className={`text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full ${cls}`}>
      {sign}
      {score.toFixed(2)}
    </span>
  );
}
