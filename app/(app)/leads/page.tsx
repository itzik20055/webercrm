import Link from "next/link";
import { Plus, Search, Users, Phone, MessageCircle } from "lucide-react";
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
    <div className="px-4 pt-4 pb-4 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">לידים</h1>
        <Button asChild size="sm" className="rounded-full">
          <Link href="/leads/new">
            <Plus className="size-4" />
            חדש
          </Link>
        </Button>
      </header>

      <form className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          name="q"
          defaultValue={q}
          placeholder="חיפוש לפי שם, טלפון, מייל..."
          className="w-full h-11 pr-10 pl-4 rounded-lg border border-input bg-card text-base focus:outline-none focus:ring-2 focus:ring-ring"
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
                "px-3.5 h-8 rounded-full text-sm font-medium whitespace-nowrap flex items-center transition " +
                (active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground")
              }
            >
              {f.l}
            </Link>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground px-1">
        {total} לידים{total === 200 ? " (מציג 200 ראשונים — חפש כדי לצמצם)" : ""}
      </p>

      <div className="space-y-2">
        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={q ? "לא נמצאו לידים" : "אין עדיין לידים"}
            description={q ? "נסה חיפוש אחר" : "הוסף את הליד הראשון שלך"}
            action={
              !q ? (
                <Button asChild className="mt-2">
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
            <Link
              key={l.id}
              href={`/leads/${l.id}`}
              className="block p-3 rounded-lg bg-card border hover:bg-accent transition active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{l.name}</span>
                    <StatusBadge status={l.status} />
                    {l.priority === "hot" && <PriorityBadge priority="hot" />}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {l.phone}
                  </div>
                  {l.notes && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                      {l.notes}
                    </p>
                  )}
                  <div className="text-xs text-muted-foreground mt-1.5">
                    עודכן {smartDate(l.updatedAt)}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <a
                    href={telLink(l.phone)}
                    onClick={(e) => e.stopPropagation()}
                    className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center"
                    aria-label="חייג"
                  >
                    <Phone className="size-4" />
                  </a>
                  <a
                    href={whatsappLink(l.phone)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="size-9 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center"
                    aria-label="וואטסאפ"
                  >
                    <MessageCircle className="size-4" />
                  </a>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
