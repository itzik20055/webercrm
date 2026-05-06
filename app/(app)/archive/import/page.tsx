import Link from "next/link";
import { ChevronLeft, Archive } from "lucide-react";
import { db, conversationArchive } from "@/db";
import { sql, eq, desc } from "drizzle-orm";
import { ArchiveImportClient } from "./archive-import-client";

export const dynamic = "force-dynamic";

export default async function ArchiveImportPage() {
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      whatsapp: sql<number>`count(*) filter (where ${conversationArchive.source} = 'whatsapp_archive')::int`,
      phone: sql<number>`count(*) filter (where ${conversationArchive.source} = 'phone_archive')::int`,
      booked: sql<number>`count(*) filter (where ${conversationArchive.outcome} = 'booked')::int`,
      lost: sql<number>`count(*) filter (where ${conversationArchive.outcome} = 'lost')::int`,
    })
    .from(conversationArchive);

  const recent = await db
    .select({
      id: conversationArchive.id,
      source: conversationArchive.source,
      audience: conversationArchive.audience,
      outcome: conversationArchive.outcome,
      interactionCount: conversationArchive.interactionCount,
      createdAt: conversationArchive.createdAt,
    })
    .from(conversationArchive)
    .where(eq(conversationArchive.source, "whatsapp_archive"))
    .orderBy(desc(conversationArchive.createdAt))
    .limit(5);

  return (
    <div className="px-4 pt-4 pb-8 space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/settings"
          className="press size-9 rounded-full flex items-center justify-center"
          aria-label="חזור"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold">העלאה לארכיון</h1>
      </div>

      <div className="rounded-xl bg-muted/40 border border-border p-4 space-y-2 text-sm">
        <div className="flex items-center gap-2 font-semibold">
          <Archive className="size-4" />
          מה זה הארכיון?
        </div>
        <p className="text-muted-foreground leading-relaxed">
          השיחות פה <strong>אינן</strong> נכנסות לתור הלידים שלך — הן יושבות בנפרד
          ומשמשות את הצ&apos;אט להבין דפוסים: סוגי לקוחות, התנגדויות, מה מוכר ומה לא.
          מחירים ותאריכי פעילות נמחקים אוטומטית, כך שהמערכת לא תשתמש בהם בטיוטות.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          המלצה: תייצא רק שיחות שסגרת — הן הסיגנל הכי חזק ללמידה.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="בארכיון" value={stats?.total ?? 0} />
        <Stat label="סגרת" value={stats?.booked ?? 0} tone="emerald" />
        <Stat label="לא סגרת" value={stats?.lost ?? 0} tone="rose" />
      </div>

      <ArchiveImportClient />

      {recent.length > 0 && (
        <div className="space-y-2 pt-4">
          <h2 className="text-sm font-bold tracking-tight text-muted-foreground">
            הועלו לאחרונה
          </h2>
          <ul className="space-y-1.5">
            {recent.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-border bg-card px-3 py-2.5 flex items-center justify-between text-sm"
              >
                <div className="flex flex-col">
                  <span className="font-medium">
                    {r.audience === "israeli_haredi"
                      ? "חרדי ישראלי"
                      : r.audience === "american_haredi"
                        ? "חרדי אמריקאי"
                        : "חרדי אירופאי"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.interactionCount ?? "?"} הודעות ·{" "}
                    {r.createdAt.toLocaleDateString("he-IL")}
                  </span>
                </div>
                <span
                  className={
                    "text-xs font-bold px-2 py-1 rounded-full " +
                    (r.outcome === "booked"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : r.outcome === "lost"
                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                        : "bg-muted text-muted-foreground")
                  }
                >
                  {r.outcome === "booked"
                    ? "סגירה"
                    : r.outcome === "lost"
                      ? "אובדן"
                      : "לא ידוע"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "rose";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "rose"
        ? "text-rose-700 dark:text-rose-300"
        : "";
  return (
    <div className="rounded-xl bg-card border border-border py-3">
      <div className={"text-2xl font-bold tabular-nums " + toneClass}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
