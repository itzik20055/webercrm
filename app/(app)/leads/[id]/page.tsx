import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  Phone,
  MessageCircle,
  Mail,
  Pencil,
  BellRing,
  MessageSquarePlus,
  Calendar,
  Users,
  Building2,
  Languages,
  Globe,
  AlertTriangle,
} from "lucide-react";
import { db, leads, interactions, followups } from "@/db";
import { eq, desc, and, isNull } from "drizzle-orm";
import {
  AUDIENCE_LABELS,
  CHANNEL_LABELS,
  INTERACTION_TYPE_LABELS,
  INTEREST_TAG_LABELS,
  LANGUAGE_LABELS,
  STATUS_LABELS,
  PRIORITY_LABELS,
} from "@/db/schema";
import { fullDate, relativeTime, telLink, whatsappLink } from "@/lib/format";
import { localTimeLabel, isGoodTimeToCall } from "@/lib/audience-tz";
import { StatusPicker, PriorityPicker } from "@/components/status-picker";
import { InterestTags } from "@/components/interest-tags";
import { ResolveFollowupButton } from "@/components/resolve-followup";
import { CopyChip } from "@/components/copy-chip";
import { DraftCard } from "@/components/draft-card";
import { DeleteLeadButton } from "@/components/delete-lead-button";
import { LeadQuickActions } from "@/components/lead-action-sheets";
import { LeadAiReprocess } from "@/components/lead-ai-reprocess";
import type {
  PendingFollowupSuggestion,
  PendingPrioritySuggestion,
} from "@/app/(app)/leads/actions";

export const dynamic = "force-dynamic";

export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [leadRows, recentInteractions, openFollowups] = await Promise.all([
    db.select().from(leads).where(eq(leads.id, id)).limit(1),
    db
      .select()
      .from(interactions)
      .where(eq(interactions.leadId, id))
      .orderBy(desc(interactions.occurredAt), desc(interactions.id))
      .limit(20),
    db
      .select()
      .from(followups)
      .where(and(eq(followups.leadId, id), isNull(followups.completedAt)))
      .orderBy(followups.dueAt),
  ]);
  const lead = leadRows[0];
  if (!lead) notFound();

  const goodTime = isGoodTimeToCall(lead.audience);
  const localNow = localTimeLabel(lead.audience);

  return (
    <div className="pb-24">
      <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-xl border-b border-border/60 px-4 py-3 flex items-center gap-2">
        <Link
          href="/leads"
          className="press size-11 -mr-2 rounded-full flex items-center justify-center hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="חזרה לרשימת לידים"
        >
          <ChevronRight className="size-[20px]" />
        </Link>
        <h1 className="text-base font-bold flex-1 truncate tracking-tight">{lead.name}</h1>
        <Link
          href={`/leads/${id}/edit`}
          className="press size-11 rounded-full flex items-center justify-center hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`עריכת ${lead.name}`}
        >
          <Pencil className="size-[18px]" />
        </Link>
        <DeleteLeadButton leadId={lead.id} leadName={lead.name} />
      </header>

      <div className="px-4 pt-4 space-y-5">
        <div className="grid grid-cols-3 gap-2">
          <a
            href={telLink(lead.phone)}
            className="press flex flex-col items-center gap-1.5 py-3.5 rounded-2xl bg-primary-soft text-primary border border-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`חייג ל${lead.name}`}
          >
            <Phone className="size-5" strokeWidth={2.2} />
            <span className="text-xs font-semibold">חייג</span>
          </a>
          <a
            href={whatsappLink(lead.phone)}
            target="_blank"
            rel="noreferrer"
            className="press flex flex-col items-center gap-1.5 py-3.5 rounded-2xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            aria-label={`וואטסאפ ל${lead.name}`}
          >
            <MessageCircle className="size-5" strokeWidth={2.2} />
            <span className="text-xs font-semibold">וואטסאפ</span>
          </a>
          {lead.email ? (
            <a
              href={`mailto:${lead.email}`}
              className="press flex flex-col items-center gap-1.5 py-3.5 rounded-2xl border bg-blue-500/12 text-blue-700 dark:text-blue-300 border-blue-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Mail className="size-5" strokeWidth={2.2} />
              <span className="text-xs font-semibold">מייל</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              aria-label="אין כתובת מייל"
              className="flex flex-col items-center gap-1.5 py-3.5 rounded-2xl border bg-muted/60 text-muted-foreground border-transparent cursor-not-allowed opacity-60"
            >
              <Mail className="size-5" strokeWidth={2.2} />
              <span className="text-xs font-semibold">מייל</span>
            </button>
          )}
        </div>

        <SynthesisCard
          status={lead.status}
          priority={lead.priority}
          nextFollowup={openFollowups[0] ?? null}
          numAdults={lead.numAdults}
          numChildren={lead.numChildren}
          datesInterest={lead.datesInterest}
          whatSpokeToThem={lead.whatSpokeToThem}
          interestTags={lead.interestTags}
        />

        <LeadAiReprocess
          leadId={lead.id}
          lastReprocessedAt={lead.lastReprocessedAt}
          followupSuggestion={
            (lead.pendingFollowupSuggestion as PendingFollowupSuggestion | null) ?? null
          }
          prioritySuggestion={
            (lead.pendingPrioritySuggestion as PendingPrioritySuggestion | null) ?? null
          }
        />

        <div className="flex flex-wrap gap-1.5 text-xs">
          <CopyChip
            value={lead.phone}
            label="מספר טלפון"
            icon={<Phone className="size-3.5" />}
          />
          {lead.email && (
            <CopyChip
              value={lead.email}
              label="אימייל"
              icon={<Mail className="size-3.5" />}
            />
          )}
          <Chip icon={<Languages className="size-3.5" />}>
            {LANGUAGE_LABELS[lead.language]}
          </Chip>
          <Chip icon={<Globe className="size-3.5" />}>
            {AUDIENCE_LABELS[lead.audience]} · {localNow}
            {!goodTime && (
              <span className="text-amber-700 dark:text-amber-400 font-semibold inline-flex items-center gap-0.5">
                <AlertTriangle className="size-3" strokeWidth={2.4} aria-hidden="true" />
                לא זמן טוב
              </span>
            )}
          </Chip>
          <Chip>הגיע דרך: {CHANNEL_LABELS[lead.channelFirst]}</Chip>
          {lead.source && <Chip>מקור: {lead.source}</Chip>}
        </div>

        <Card title="סטטוס">
          <StatusPicker leadId={lead.id} current={lead.status} />
          <div className="mt-3">
            <div className="text-xs text-muted-foreground mb-1.5">עדיפות</div>
            <PriorityPicker leadId={lead.id} current={lead.priority} />
          </div>
        </Card>

        <Card
          title="פולואפ"
          icon={<BellRing className="size-4" />}
          action={
            <Link
              href={`/leads/${id}/followup`}
              className="text-xs font-medium text-primary"
            >
              קבע חדש
            </Link>
          }
        >
          {openFollowups.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין פולואפ קבוע</p>
          ) : (
            <ul className="space-y-2">
              {openFollowups.map((f) => {
                const overdue = new Date(f.dueAt) < new Date();
                return (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <div>
                      <div
                        className={
                          "text-sm font-medium flex items-center gap-1 " +
                          (overdue ? "text-destructive" : "")
                        }
                      >
                        {overdue && (
                          <AlertTriangle
                            className="size-3.5 shrink-0"
                            strokeWidth={2.4}
                            aria-label="באיחור"
                          />
                        )}
                        {fullDate(f.dueAt)}
                      </div>
                      {f.reason && (
                        <div className="text-xs text-muted-foreground">
                          {f.reason}
                        </div>
                      )}
                    </div>
                    <ResolveFollowupButton
                      followupId={f.id}
                      leadId={lead.id}
                      label="בוצע"
                      hasOtherOpen={openFollowups.length > 1}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <DraftCard leadId={lead.id} leadPhone={lead.phone} />

        <Card
          title="פרטי הנופש"
          icon={<Calendar className="size-4" />}
          action={
            <Link
              href={`/leads/${id}/edit`}
              className="text-xs font-medium text-primary"
            >
              ערוך
            </Link>
          }
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row label="מבוגרים" value={lead.numAdults} icon={<Users className="size-3.5" />} />
            <Row label="ילדים" value={lead.numChildren} />
            {lead.agesChildren && (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">גילי ילדים</dt>
                <dd>{lead.agesChildren}</dd>
              </div>
            )}
            <Row label="תאריכים" value={lead.datesInterest} className="col-span-2" />
            <Row
              label="חדר"
              value={lead.roomTypeInterest}
              className="col-span-2"
            />
            <Row
              label="בניין"
              value={
                lead.buildingPref === "a"
                  ? "A"
                  : lead.buildingPref === "b"
                    ? "B"
                    : lead.buildingPref === "any"
                      ? "לא משנה"
                      : null
              }
              icon={<Building2 className="size-3.5" />}
            />
            <Row
              label="תקציב"
              value={
                lead.budgetSignal === "low"
                  ? "נמוך"
                  : lead.budgetSignal === "mid"
                    ? "בינוני"
                    : lead.budgetSignal === "high"
                      ? "גבוה"
                      : null
              }
            />
            <Row
              label="איפה היה בעבר"
              value={lead.previousStays}
              className="col-span-2"
            />
          </dl>
        </Card>

        <Card title="מה תפס אותו">
          <InterestTags leadId={lead.id} selected={lead.interestTags ?? []} />
          {lead.whatSpokeToThem && (
            <p className="text-sm mt-3 whitespace-pre-wrap">
              {lead.whatSpokeToThem}
            </p>
          )}
          <div className="text-xs text-muted-foreground mt-2">
            <Link href={`/leads/${id}/edit`} className="text-primary">
              {lead.whatSpokeToThem ? "ערוך" : "הוסף הערה"}
            </Link>
          </div>
        </Card>

        {lead.objections && (
          <Card title="התנגדויות">
            <p className="text-sm whitespace-pre-wrap">{lead.objections}</p>
          </Card>
        )}

        {lead.notes && (
          <Card title="הערות">
            <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
          </Card>
        )}

        <Card
          title="היסטוריית שיחות"
          icon={<MessageSquarePlus className="size-4" />}
          action={
            <a href="#capture" className="text-xs font-medium text-primary">
              + תיעוד חדש
            </a>
          }
        >
          {recentInteractions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              עדיין לא תועדה אינטראקציה.{" "}
              <a href="#capture" className="text-primary">
                תעד את הראשונה
              </a>
            </p>
          ) : (
            <ul className="space-y-3">
              {recentInteractions.map((i) => (
                <li key={i.id} className="border-r-2 border-primary/40 pr-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {INTERACTION_TYPE_LABELS[i.type]}
                    </span>
                    <span>·</span>
                    <span>{relativeTime(i.occurredAt)}</span>
                    {i.durationMin != null && (
                      <>
                        <span>·</span>
                        <span>{i.durationMin} דק׳</span>
                      </>
                    )}
                  </div>
                  <p className="text-sm mt-1 whitespace-pre-wrap line-clamp-6">
                    {i.content}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <LeadQuickActions leadId={lead.id} />
    </div>
  );
}

function Card({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card border border-border/70 rounded-2xl p-4 space-y-3 shadow-soft">
      <header className="flex items-center justify-between">
        <h2 className="font-bold text-[13px] tracking-tight text-muted-foreground flex items-center gap-1.5">
          {icon}
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Chip({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground font-medium">
      {icon}
      {children}
    </span>
  );
}

function Row({
  label,
  value,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  new: "bg-blue-500/12 text-blue-700 dark:text-blue-300 border-blue-500/20",
  contacted: "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/20",
  interested: "bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/20",
  quoted: "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/20",
  closing: "bg-orange-500/12 text-orange-700 dark:text-orange-300 border-orange-500/20",
  booked: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  lost: "bg-muted text-muted-foreground border-border",
};

const PRIORITY_TONE: Record<string, string> = {
  hot: "bg-destructive/12 text-destructive border-destructive/30",
  warm: "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/20",
  cold: "bg-muted text-muted-foreground border-border",
};

function SynthesisCard({
  status,
  priority,
  nextFollowup,
  numAdults,
  numChildren,
  datesInterest,
  whatSpokeToThem,
  interestTags,
}: {
  status: keyof typeof STATUS_LABELS;
  priority: keyof typeof PRIORITY_LABELS;
  nextFollowup: { dueAt: Date; reason: string | null } | null;
  numAdults: number | null;
  numChildren: number | null;
  datesInterest: string | null;
  whatSpokeToThem: string | null;
  interestTags: string[] | null;
}) {
  const tripBits: string[] = [];
  if (numAdults != null || numChildren != null) {
    const a = numAdults ?? 0;
    const c = numChildren ?? 0;
    if (c > 0) tripBits.push(`${a} מבוגרים · ${c} ילדים`);
    else if (a > 0) tripBits.push(`${a} מבוגרים`);
  }
  if (datesInterest) tripBits.push(datesInterest);

  const topInterests = (interestTags ?? []).slice(0, 3);
  const fuOverdue = nextFollowup && new Date(nextFollowup.dueAt) < new Date();

  return (
    <section className="bg-card border border-border/70 rounded-2xl p-3.5 space-y-2.5 shadow-soft">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={
            "inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold border " +
            (STATUS_TONE[status] ?? STATUS_TONE.lost)
          }
        >
          {STATUS_LABELS[status]}
        </span>
        <span
          className={
            "inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold border " +
            (PRIORITY_TONE[priority] ?? PRIORITY_TONE.cold)
          }
        >
          {PRIORITY_LABELS[priority]}
        </span>
      </div>

      <div
        className={
          "flex items-center gap-1.5 text-[13px] " +
          (fuOverdue ? "text-destructive font-semibold" : "text-foreground")
        }
      >
        <BellRing className="size-3.5 shrink-0" strokeWidth={2.2} />
        {nextFollowup ? (
          <span className="truncate">
            {fuOverdue ? "באיחור — " : "פולואפ "}
            {fullDate(nextFollowup.dueAt)}
            {nextFollowup.reason ? (
              <span className="text-muted-foreground font-normal">
                {" · "}
                {nextFollowup.reason}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">אין פולואפ קבוע</span>
        )}
      </div>

      {tripBits.length > 0 && (
        <div className="text-[13px] text-foreground tabular-nums">
          {tripBits.join(" · ")}
        </div>
      )}

      {whatSpokeToThem && (
        <p className="text-[13px] text-foreground/90 line-clamp-2 leading-relaxed">
          “{whatSpokeToThem}”
        </p>
      )}

      {topInterests.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {topInterests.map((t) => (
            <span
              key={t}
              className="inline-flex px-2 py-0.5 rounded-full bg-secondary/70 text-secondary-foreground text-[11px] font-medium"
            >
              {INTEREST_TAG_LABELS[t] ?? t}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
