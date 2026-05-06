import Link from "next/link";
import { ChevronLeft, Phone } from "lucide-react";
import { db, archiveImports, conversationArchive } from "@/db";
import { sql, eq, desc } from "drizzle-orm";
import { ArchivePhoneClient } from "./archive-phone-client";

export const dynamic = "force-dynamic";

export default async function ArchivePhonePage() {
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      booked: sql<number>`count(*) filter (where ${conversationArchive.outcome} = 'booked')::int`,
      lost: sql<number>`count(*) filter (where ${conversationArchive.outcome} = 'lost')::int`,
      unknown: sql<number>`count(*) filter (where ${conversationArchive.outcome} = 'unknown')::int`,
    })
    .from(conversationArchive)
    .where(eq(conversationArchive.source, "phone_archive"));

  const recentBatches = await db
    .select()
    .from(archiveImports)
    .where(eq(archiveImports.kind, "phone"))
    .orderBy(desc(archiveImports.createdAt))
    .limit(5);

  return (
    <div className="px-4 pt-4 pb-8 space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/archive/import"
          className="press size-9 rounded-full flex items-center justify-center"
          aria-label="חזור"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold">ארכיון טלפון</h1>
      </div>

      <div className="rounded-xl bg-muted/40 border border-border p-4 space-y-2 text-sm">
        <div className="flex items-center gap-2 font-semibold">
          <Phone className="size-4" />
          איך זה עובד
        </div>
        <ol className="text-muted-foreground space-y-1 list-decimal list-inside leading-relaxed">
          <li>תבחר טווח תאריכים — האפליקציה תספור הקלטות שיש לך במייל בטווח</li>
          <li>תאשר → הקלטות יקובצו לפי מספר הלקוח, ייעובדו לארכיטיפים</li>
          <li>תוצאה (סגר/לא סגר) תוסק מהשיחה האחרונה — ה-AI לא יודע מראש</li>
          <li>אם הטווח גדול והעיבוד נעצר באמצע — תלחץ "המשך" עד שהושלם</li>
        </ol>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="בארכיון" value={stats?.total ?? 0} />
        <Stat label="סגירות" value={stats?.booked ?? 0} tone="emerald" />
        <Stat label="אובדנים" value={stats?.lost ?? 0} tone="rose" />
        <Stat label="לא ברור" value={stats?.unknown ?? 0} />
      </div>

      <ArchivePhoneClient />

      {recentBatches.length > 0 && (
        <div className="space-y-2 pt-4">
          <h2 className="text-sm font-bold tracking-tight text-muted-foreground">
            ריצות אחרונות
          </h2>
          <ul className="space-y-1.5">
            {recentBatches.map((b) => (
              <li
                key={b.id}
                className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {b.dateFrom?.toLocaleDateString("he-IL")} →{" "}
                    {b.dateTo?.toLocaleDateString("he-IL")}
                  </span>
                  <BatchStatusBadge status={b.status} />
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {b.successCount} הצלחות · {b.failureCount} כשלים ·{" "}
                  {b.processedCount} בסך הכל
                  {b.itemCount != null && ` (מתוך ${b.itemCount} מיילים)`}
                </div>
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
      <div className={"text-xl font-bold tabular-nums " + toneClass}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function BatchStatusBadge({ status }: { status: string }) {
  const labels: Record<string, { text: string; cls: string }> = {
    pending: { text: "ממתין", cls: "bg-muted text-muted-foreground" },
    counting: { text: "סופר", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
    ready: { text: "מוכן", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
    processing: {
      text: "בעיבוד",
      cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    },
    done: {
      text: "הסתיים",
      cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    },
    failed: {
      text: "נכשל",
      cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    },
    cancelled: { text: "בוטל", cls: "bg-muted text-muted-foreground" },
  };
  const { text, cls } = labels[status] ?? {
    text: status,
    cls: "bg-muted text-muted-foreground",
  };
  return (
    <span className={"text-xs font-bold px-2 py-0.5 rounded-full " + cls}>
      {text}
    </span>
  );
}
