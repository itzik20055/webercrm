import Link from "next/link";
import { Plus, Search, Users, Phone, MessageCircle, Sparkles } from "lucide-react";
import { db, leads } from "@/db";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { StatusBadge, PriorityBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { smartDate, telLink, whatsappLink } from "@/lib/format";
import { STATUS_LABELS } from "@/db/schema";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = [
  { v: "all", l: "הכל" },
  { v: "active", l: "פעילים" },
  { v: "new", l: "חדשים" },
  { v: "contacted", l: "בקשר" },
  { v: "interested", l: "מתעניינים" },
  { v: "quoted", l: "הצעה" },
  { v: "closing", l: "בסגירה" },
  { v: "booked", l: "נסגרו" },
  { v: "lost", l: "אבד" },
] as const;

export default async function LeadsListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; priority?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilter = sp.status ?? "active";
  const priorityFilter = sp.priority;

  const conds: SQL[] = [];
  if (q) {
    const term = `%${q}%`;
    conds.push(
      or(
        ilike(leads.name, term),
        ilike(leads.phone, term),
        ilike(leads.email, term),
        ilike(leads.notes, term)
      )!
    );
  }
  if (statusFilter && statusFilter !== "all") {
    if (statusFilter === "active") {
      conds.push(sql`${leads.status} not in ('booked','lost')`);
    } else {
      conds.push(eq(leads.status, statusFilter as "new"));
    }
  }
  if (priorityFilter === "hot" || priorityFilter === "warm" || priorityFilter === "cold") {
    conds.push(eq(leads.priority, priorityFilter));
  }

  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select()
    .from(leads)
    .where(where)
    .orderBy(desc(leads.updatedAt))
    .limit(200);

  const total = rows.length;

  return (
    <div className="px-4 pt-5 pb-4 space-y-4">
      <header className="flex items-end justify-between gap-3">
        <h1 className="text-[26px] font-bold tracking-tight leading-none">לידים</h1>
        <div className="flex gap-2">
          <Link
            href="/leads/import"
            className="press inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full bg-card border border-border text-sm font-semibold text-foreground shadow-soft"
          >
            <Sparkles className="size-4 text-primary" />
            ייבוא AI
          </Link>
          <Link
            href="/leads/new"
            className="press inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-card"
          >
            <Plus className="size-[18px]" strokeWidth={2.5} />
            חדש
          </Link>
        </div>
      </header>

      <form className="relative">
        <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 size-[18px] text-muted-foreground" />
        <input
          name="q"
          defaultValue={q}
          placeholder="חיפוש שם, טלפון, מייל…"
          className="w-full h-12 pr-11 pl-4 rounded-2xl border border-border bg-card text-[15px] shadow-soft placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition"
        />
        {statusFilter !== "active" && (
          <input type="hidden" name="status" value={statusFilter} />
        )}
        {priorityFilter && <input type="hidden" name="priority" value={priorityFilter} />}
      </form>

      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-hide">
        {STATUS_FILTERS.map((f) => {
          const active = f.v === statusFilter || (!statusFilter && f.v === "active");
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          params.set("status", f.v);
          if (priorityFilter) params.set("priority", priorityFilter);
          return (
            <Link
              key={f.v}
              href={`/leads?${params}`}
              className={
                "press px-3.5 h-9 rounded-full text-[13px] font-semibold whitespace-nowrap flex items-center transition-colors duration-150 " +
                (active
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "bg-card border border-border text-muted-foreground")
              }
            >
              {f.l}
            </Link>
          );
        })}
      </div>

      <p className="text-xs font-medium text-muted-foreground px-1 tabular-nums">
        {total} לידים{total === 200 ? " · מציג 200 ראשונים, חפש כדי לצמצם" : ""}
      </p>

      <div className="space-y-2">
        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={q ? "לא נמצאו לידים" : "אין עדיין לידים"}
            description={q ? "נסה חיפוש אחר" : "הוסף את הליד הראשון שלך"}
            action={
              !q ? (
                <Button asChild className="mt-2" size="lg">
                  <Link href="/leads/new">
                    <Plus className="size-4" />
                    הוסף ליד
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          rows.map((l) => (
            <div
              key={l.id}
              className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-card border border-border/70 shadow-soft"
            >
              <Link
                href={`/leads/${l.id}`}
                className="min-w-0 flex-1 press"
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold tracking-tight">{l.name}</span>
                  <StatusBadge status={l.status} />
                  {l.priority === "hot" && <PriorityBadge priority="hot" />}
                </div>
                <div className="text-sm text-muted-foreground mt-1 tabular-nums">
                  {l.phone}
                </div>
                {l.notes && (
                  <p className="text-sm text-muted-foreground/90 mt-1 line-clamp-1">
                    {l.notes}
                  </p>
                )}
                <div className="text-[11px] font-medium text-muted-foreground mt-1.5">
                  עודכן {smartDate(l.updatedAt)}
                </div>
              </Link>
              <div className="flex flex-col gap-1.5 shrink-0">
                <a
                  href={telLink(l.phone)}
                  className="press size-10 rounded-full bg-primary-soft text-primary flex items-center justify-center"
                  aria-label="חייג"
                >
                  <Phone className="size-[18px]" strokeWidth={2.2} />
                </a>
                <a
                  href={whatsappLink(l.phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="press size-10 rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"
                  aria-label="וואטסאפ"
                >
                  <MessageCircle className="size-[18px]" strokeWidth={2.2} />
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
