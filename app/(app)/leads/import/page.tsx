import Link from "next/link";
import { ChevronRight, MessageCircle, Mail } from "lucide-react";
import { getSetting } from "@/lib/settings";
import { ImportClient } from "./import-client";
import { ImportEmailClient } from "./import-email-client";

export const dynamic = "force-dynamic";

export default async function ImportLeadPage() {
  const myName = await getSetting("whatsapp_display_name");
  const hasGatewayKey = !!process.env.AI_GATEWAY_API_KEY;
  const hasGmailCreds = !!process.env.GMAIL_USER && !!process.env.GMAIL_APP_PASSWORD;

  const waReady = !!myName && hasGatewayKey;

  return (
    <div className="px-4 pt-4 pb-4 space-y-5">
      <header className="flex items-center justify-between">
        <Link
          href="/leads"
          className="flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ChevronRight className="size-4" />
          חזרה
        </Link>
        <h1 className="text-lg font-semibold">ייבוא ליד</h1>
        <div className="w-12" />
      </header>

      {(!myName || !hasGatewayKey) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center gap-2 font-medium text-amber-900">
            <MessageCircle className="size-4" />
            צריך להגדיר קודם
          </div>
          <ul className="text-sm text-amber-900 space-y-1 list-disc list-inside">
            {!myName && <li>השם שלך בוואטסאפ</li>}
            {!hasGatewayKey && <li>מפתח Vercel AI Gateway (AI_GATEWAY_API_KEY)</li>}
          </ul>
          <Link
            href="/settings"
            className="inline-block mt-2 h-9 px-3 rounded-lg bg-amber-900 text-white text-sm font-medium leading-9"
          >
            לעמוד ההגדרות
          </Link>
        </div>
      )}

      <section id="whatsapp" className="space-y-3 scroll-mt-20">
        <div className="flex items-center gap-2 px-1">
          <MessageCircle className="size-4 text-emerald-700 dark:text-emerald-300" />
          <h2 className="text-[13px] font-bold tracking-tight text-foreground">
            ייבוא שיחת וואטסאפ
          </h2>
        </div>
        {waReady ? (
          <ImportClient myName={myName} />
        ) : (
          <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
            מילוי ההגדרות הנדרשות למעלה יפעיל את הייבוא.
          </div>
        )}
      </section>

      <section id="email" className="space-y-3 scroll-mt-20">
        <div className="flex items-center gap-2 px-1">
          <Mail className="size-4 text-primary" />
          <h2 className="text-[13px] font-bold tracking-tight text-foreground">
            ייבוא התכתבות מייל
          </h2>
        </div>
        {hasGmailCreds && hasGatewayKey ? (
          <ImportEmailClient />
        ) : (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            חסר חיבור ל-Gmail (GMAIL_USER ו-GMAIL_APP_PASSWORD ב-env).
          </div>
        )}
      </section>

      <details className="rounded-xl border bg-card p-3 text-sm">
        <summary className="font-medium cursor-pointer">איך לייצא צ'אט מוואטסאפ?</summary>
        <ol className="text-muted-foreground space-y-2 mt-3 list-decimal list-inside">
          <li>פתח את הצ'אט עם הלקוח באפליקציית וואטסאפ</li>
          <li>iOS: לחץ על השם של הלקוח בראש הצ'אט → "ייצוא צ'אט"</li>
          <li>Android: ⋮ → עוד → ייצוא צ'אט</li>
          <li>בחר <strong>"כולל מדיה"</strong> כדי שגם הודעות קוליות יתומללו</li>
          <li>שמור את ה-ZIP (Files / Drive / שלח לעצמך) והעלה כאן</li>
        </ol>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          <strong>הקובץ גדול מ-100MB?</strong> שיחות עם הרבה הודעות קוליות מגיעות
          לעיתים ל-100MB+ (ZIP לא מצמצם קבצי אודיו דחוסים). פתרונות:
        </p>
        <ul className="text-muted-foreground space-y-1 mt-1 list-disc list-inside">
          <li>ייצא <strong>"ללא מדיה"</strong> (טקסט בלבד, מהיר וקטן - אבל בלי תמלול קולי)</li>
          <li>מחק הודעות קוליות ישנות מהצ'אט עצמו ואז ייצא מחדש</li>
        </ul>
      </details>

      <details className="rounded-xl border bg-card p-3 text-sm">
        <summary className="font-medium cursor-pointer">איך עובד ייבוא מייל?</summary>
        <ol className="text-muted-foreground space-y-2 mt-3 list-decimal list-inside">
          <li>הזן את כתובת המייל של הלקוח</li>
          <li>נשלפת כל ההתכתבות איתו (מ-1/4/2026 והלאה, משני הכיוונים)</li>
          <li>
            AI מחלץ ליד מהשרשור. הליד מופיע בתיבה לאישור/מיזוג.
          </li>
          <li>מרגע שהליד קיים במערכת, כל מייל חדש איתו ייאסף אוטומטית כל 4 שעות.</li>
        </ol>
      </details>
    </div>
  );
}
