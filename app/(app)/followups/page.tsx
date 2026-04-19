import Link from "next/link";
import { BellRing, Phone, MessageCircle } from "lucide-react";
import { db, followups, leads } from "@/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { CompleteFollowupButton } from "@/components/complete-followup-button";
import { fullDate, telLink, whatsappLink } from "@/lib/format";
import { localTimeLabel, isGoodTimeToCall } from "@/lib/audience-tz";
import { AUDIENCE_LABELS } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function FollowupsPage() {
  const rows = await db
    .select({
      id: followups.id,
      leadId: followups.leadId,
      dueAt: followups.dueAt,
      reason: followups.reason,
      leadName: leads.name,
      leadPhone: leads.phone,
      leadStatus: leads.status,
      leadAudience: leads.audience,
    })
    .from(followups)
    .innerJoin(leads, eq(followups.leadId, leads.id))
    .where(isNull(followups.completedAt))
    .orderBy(asc(followups.dueAt));

  const now = new Date();
  const overdue = rows.filter((r) => new Date(r.dueAt) < now);
  const today = rows.filter((r) => {
    const d = new Date(r.dueAt);
    return d >= now && d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
  });
  const upcoming = rows.filter(
    (r) => !overdue.includes(r) && !today.includes(r)
  );

  return (
    <div className="px-4 pt-4 pb-4 space-y-5">
      <h1 className="text-2xl font-bold">פולואפים</h1>

      {rows.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title="אין פולואפים פתוחים"
          description="כל הכבוד! 🎉"
        />
      ) : (
        <>
          {overdue.length > 0 && (
            <Group title="באיחור" tone="destructive">
              {overdue.map((r) => (
                <FollowupRow key={r.id} row={r} overdue />
              ))}
            </Group>
          )}
          {today.length > 0 && (
            <Group title="היום">
              {today.map((r) => (
                <FollowupRow key={r.id} row={r} />
              ))}
            </Group>
          )}
          {upcoming.length > 0 && (
            <Group title="הבא בתור">
              {upcoming.map((r) => (
                <FollowupRow key={r.id} row={r} />
              ))}
            </Group>
          )}
        </>
      )}
    </div>
  );
}

function Group({
  title,
  tone = "default",
  children,
}: {
  title: string;
  tone?: "default" | "destructive";
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2
        className={
          "text-sm font-semibold px-1 " +
          (tone === "destructive" ? "text-destructive" : "text-muted-foreground")
        }
      >
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

type Row = {
  id: string;
  leadId: string;
  dueAt: Date;
  reason: string | null;
  leadName: string;
  leadPhone: string;
  leadStatus: "new" | "contacted" | "interested" | "quoted" | "closing" | "booked" | "lost";
  leadAudience: "israeli_haredi" | "american_haredi" | "european_haredi";
};

function FollowupRow({ row, overdue }: { row: Row; overdue?: boolean }) {
  const goodTime = isGoodTimeToCall(row.leadAudience);
  return (
    <div className="bg-card border rounded-lg p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/leads/${row.leadId}`} className="min-w-0 flex-1 block">
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.leadName}</span>
            <StatusBadge status={row.leadStatus} />
          </div>
          <div
            className={
              "text-sm mt-0.5 " +
              (overdue ? "text-destructive font-medium" : "text-muted-foreground")
            }
          >
            {fullDate(row.dueAt)}
          </div>
          {row.reason && <p className="text-sm mt-1">{row.reason}</p>}
          <div className="text-xs text-muted-foreground mt-1">
            {localTimeLabel(row.leadAudience)} · {AUDIENCE_LABELS[row.leadAudience]}
            {!goodTime && <span className="text-amber-600"> · לא זמן טוב לחיוג</span>}
          </div>
        </Link>
      </div>
      <div className="flex gap-2">
        <a
          href={telLink(row.leadPhone)}
          className="flex-1 h-9 rounded-md bg-primary/10 text-primary text-sm font-medium flex items-center justify-center gap-1.5"
        >
          <Phone className="size-4" />
          חייג
        </a>
        <a
          href={whatsappLink(row.leadPhone)}
          target="_blank"
          rel="noreferrer"
          className="flex-1 h-9 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-sm font-medium flex items-center justify-center gap-1.5"
        >
          <MessageCircle className="size-4" />
          וואטסאפ
        </a>
        <CompleteFollowupButton followupId={row.id} leadId={row.leadId} label="בוצע" />
      </div>
    </div>
  );
}
