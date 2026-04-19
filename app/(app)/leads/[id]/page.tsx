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
} from "lucide-react";
import { db, leads, interactions, followups } from "@/db";
import { eq, desc, and, isNull } from "drizzle-orm";
import {
  AUDIENCE_LABELS,
  CHANNEL_LABELS,
  INTERACTION_TYPE_LABELS,
  INTEREST_TAG_LABELS,
  LANGUAGE_LABELS,
} from "@/db/schema";
import { fullDate, relativeTime, telLink, whatsappLink } from "@/lib/format";
import { localTimeLabel, isGoodTimeToCall } from "@/lib/audience-tz";
import { StatusPicker, PriorityPicker } from "@/components/status-picker";
import { InterestTags } from "@/components/interest-tags";
import { ResolveFollowupButton } from "@/components/resolve-followup";
import { CopyChip } from "@/components/copy-chip";
import { DraftCard } from "@/components/draft-card";

export const dynamic = "force-dynamic";

export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) notFound();

  const [recentInteractions, openFollowups] = await Promise.all([
    db
      .select()
      .from(interactions)
      .where(eq(interactions.leadId, id))
      .orderBy(desc(interactions.occurredAt))
      .limit(20),
    db
      .select()
      .from(followups)
      .where(and(eq(followups.leadId, id), isNull(followups.completedAt)))
      .orderBy(followups.dueAt),
  ]);

  const goodTime = isGoodTimeToCall(lead.audience);
  const localNow = localTimeLabel(lead.audience);

  return (
    <div className="pb-8">
      <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-xl border-b border-border/60 px-4 py-3 flex items-center gap-2">
        <Link
          href="/leads"
          className="press size-10 -mr-2 rounded-full flex items-center justify-center hover:bg-accent"
          aria-label="חזרה"
        >
          <ChevronRight className="size-[18px]" />
        </Link>
        <h1 className="text-base font-bold flex-1 truncate tracking-tight">{lead.name}</h1>
        <Link
          href={`/leads/${id}/edit`}
          className="press size-10 rounded-full flex items-center justify-center hover:bg-accent"
          aria-label="עריכה"
        >
          <Pencil className="size-[16px]" />
        </Link>
      </header>

      <div className="px-4 pt-4 space-y-5">
        <div className="grid grid-cols-3 gap-2">
          <a
            href={telLink(lead.phone)}
            className="press flex flex-col items-center gap-1.5 py-3.5 rounded-2xl bg-primary-soft text-primary border border-primary/10"
          >
            <Phone className="size-5" strokeWidth={2.2} />
            <span className="text-xs font-semibold">חייג</span>
          </a>
          <a
            href={whatsappLink(lead.phone)}
            target="_blank"
            rel="noreferrer"
            className="press flex flex-col items-center gap-1.5 py-3.5 rounded-2xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/15"
          >
            <MessageCircle className="size-5" strokeWidth={2.2} />
            <span className="text-xs font-semibold">וואטסאפ</span>
          </a>
          <a
            href={lead.email ? `mailto:${lead.email}` : "#"}
            aria-disabled={!lead.email}
            className={
              "flex flex-col items-center gap-1.5 py-3.5 rounded-2xl border " +
              (lead.email
                ? "press bg-blue-500/12 text-blue-700 dark:text-blue-300 border-blue-500/15"
                : "bg-muted/60 text-muted-foreground border-transparent pointer-events-none")
            }
          >
            <Mail className="size-5" strokeWidth={2.2} />
            <span className="text-xs font-semibold">מייל</span>
          </a>
        </div>

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
            {!goodTime && <span className="text-amber-600 font-semibold"> · לא זמן טוב</span>}
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
                          "text-sm font-medium " +
                          (overdue ? "text-destructive" : "")
                        }
                      >
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
            <Link
              href={`/leads/${id}/log`}
              className="text-xs font-medium text-primary"
            >
              + תיעוד חדש
            </Link>
          }
        >
          {recentInteractions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              עדיין לא תועדה אינטראקציה.{" "}
              <Link href={`/leads/${id}/log`} className="text-primary">
                תעד את הראשונה
              </Link>
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

      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+72px)] inset-x-0 px-4 z-20 pointer-events-none">
        <div className="max-w-lg mx-auto flex gap-2 pointer-events-auto">
          <Link
            href={`/leads/${id}/log`}
            className="press flex-1 h-12 rounded-full bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 shadow-pop"
          >
            <MessageSquarePlus className="size-5" strokeWidth={2.2} />
            תיעוד שיחה
          </Link>
          <Link
            href={`/leads/${id}/followup`}
            className="press h-12 px-5 rounded-full bg-card border border-border font-semibold flex items-center justify-center gap-2 shadow-pop"
          >
            <BellRing className="size-5" strokeWidth={2.2} />
            פולואפ
          </Link>
        </div>
      </div>
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
