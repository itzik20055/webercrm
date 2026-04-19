import { LogOut, Smartphone, BellRing, Database } from "lucide-react";
import { db, pushSubscriptions, leads } from "@/db";
import { sql } from "drizzle-orm";
import { PushToggle } from "@/components/push-toggle";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [stats] = await db
    .select({
      leadsTotal: sql<number>`(select count(*) from ${leads})::int`,
      subs: sql<number>`(select count(*) from ${pushSubscriptions})::int`,
    })
    .from(leads)
    .limit(1);

  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  return (
    <div className="px-4 pt-4 pb-4 space-y-5">
      <h1 className="text-2xl font-bold">הגדרות</h1>

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
