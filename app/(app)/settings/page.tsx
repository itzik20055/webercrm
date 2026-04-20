import Link from "next/link";
import {
  LogOut,
  Smartphone,
  BellRing,
  Database,
  MessageCircle,
  BookOpen,
  ChevronLeft,
  Phone,
} from "lucide-react";
import { db, pushSubscriptions, leads, productKb } from "@/db";
import { sql } from "drizzle-orm";
import { PushToggle } from "@/components/push-toggle";
import { getSetting, setSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";
import { CallRecordingsPanel } from "./call-recordings-panel";
import { countPendingCallRecordings } from "@/lib/gmail-imap";

export const dynamic = "force-dynamic";

async function saveWhatsAppName(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await setSetting("whatsapp_display_name", name);
  revalidatePath("/settings");
}

export default async function SettingsPage() {
  const [stats] = await db
    .select({
      leadsTotal: sql<number>`(select count(*) from ${leads})::int`,
      subs: sql<number>`(select count(*) from ${pushSubscriptions})::int`,
      kbActive: sql<number>`(select count(*) from ${productKb} where active = true)::int`,
      kbTotal: sql<number>`(select count(*) from ${productKb})::int`,
    })
    .from(leads)
    .limit(1);

  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const whatsappName = await getSetting("whatsapp_display_name");
  const hasGatewayKey = !!process.env.AI_GATEWAY_API_KEY;

  const callStatus = await countPendingCallRecordings().catch((e) => ({
    error: e instanceof Error ? e.message : String(e),
  }));

  return (
    <div className="px-4 pt-4 pb-4 space-y-5">
      <h1 className="text-2xl font-bold">הגדרות</h1>

      <Section title="ספר הידע" icon={<BookOpen className="size-4" />}>
        <p className="text-sm text-muted-foreground">
          הידע על המוצר שמוזרק לכל שיחה עם ה-AI. עדכן בכל פעם שמשהו משתנה.
        </p>
        <Link
          href="/kb"
          className="press flex items-center justify-between h-11 px-3.5 rounded-xl border border-border bg-background"
        >
          <span className="font-medium text-sm">פתח את ספר הידע</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
            {stats?.kbActive ?? 0} / {stats?.kbTotal ?? 0} פעילים
            <ChevronLeft className="size-4" />
          </span>
        </Link>
      </Section>

      <Section title="ייבוא וואטסאפ + AI" icon={<MessageCircle className="size-4" />}>
        <p className="text-sm text-muted-foreground">
          השם שלך כפי שהוא מופיע בוואטסאפ ללקוחות. נחוץ כדי שה-AI ידע מה אתה
          שלחת ומה הלקוח שלח.
        </p>
        <form action={saveWhatsAppName} className="space-y-2">
          <input
            name="name"
            type="text"
            defaultValue={whatsappName ?? ""}
            placeholder="לדוגמה: איציק וובר"
            className="w-full h-11 px-3 rounded-lg border bg-background"
            dir="rtl"
          />
          <button
            type="submit"
            className="w-full h-10 rounded-lg bg-primary text-primary-foreground font-medium active:scale-[0.99]"
          >
            שמור
          </button>
        </form>
        <div className="text-xs text-muted-foreground pt-2 border-t">
          מפתח Vercel AI Gateway:{" "}
          {hasGatewayKey ? (
            <span className="text-emerald-600 font-medium">מוגדר ✓</span>
          ) : (
            <span className="text-amber-600 font-medium">
              חסר — הוסף AI_GATEWAY_API_KEY ב-.env.local
            </span>
          )}
        </div>
      </Section>

      <Section title="הקלטות שיחה" icon={<Phone className="size-4" />}>
        <CallRecordingsPanel initial={callStatus} />
      </Section>

      <Section title="התראות" icon={<BellRing className="size-4" />}>
        <p className="text-sm text-muted-foreground">
          קבל push notification כשמגיע זמן פולואפ. צריך להפעיל פעם אחת לכל מכשיר.
        </p>
        <PushToggle vapidPublicKey={vapid} />
      </Section>

      <Section title="התקנה" icon={<Smartphone className="size-4" />}>
        <p className="text-sm text-muted-foreground">
          הוסף את האפליקציה למסך הבית של הטלפון לחוויה מלאה (אייקון, ללא כתובת URL, התראות).
        </p>
        <ol className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
          <li>iOS Safari: כפתור Share → "Add to Home Screen"</li>
          <li>Android Chrome: תפריט ⋮ → "Add to Home Screen" / "Install app"</li>
        </ol>
      </Section>

      <Section title="סטטיסטיקה" icon={<Database className="size-4" />}>
        <dl className="grid grid-cols-2 gap-3">
          <Stat label="סה״כ לידים" value={stats?.leadsTotal ?? 0} />
          <Stat label="מכשירים מנויים" value={stats?.subs ?? 0} />
        </dl>
      </Section>

      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="w-full h-12 rounded-lg border border-destructive/30 text-destructive font-medium flex items-center justify-center gap-2 active:scale-[0.99] transition"
        >
          <LogOut className="size-4" />
          התנתק
        </button>
      </form>

      <p className="text-xs text-center text-muted-foreground pt-4">
        Weber Leads · עונה 2026
      </p>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-1.5 px-1">
        {icon}
        {title}
      </h2>
      <div className="bg-card border rounded-xl p-3.5 space-y-3">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
