import Link from "next/link";
import { ChevronRight, MessageCircle } from "lucide-react";
import { getSetting } from "@/lib/settings";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function ImportWhatsAppPage() {
  const myName = await getSetting("whatsapp_display_name");
  const hasGatewayKey = !!process.env.AI_GATEWAY_API_KEY;

  return (
    <div className="px-4 pt-4 pb-4 space-y-4">
      <header className="flex items-center justify-between">
        <Link
          href="/leads"
          className="flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ChevronRight className="size-4" />
          חזרה
        </Link>
        <h1 className="text-lg font-semibold">ייבוא שיחת וואטסאפ</h1>
        <div className="w-12" />
      </header>

      {!myName || !hasGatewayKey ? (
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
      ) : (
        <ImportClient myName={myName} />
      )}

      <details className="rounded-xl border bg-card p-3 text-sm">
        <summary className="font-medium cursor-pointer">איך לייצא צ'אט מוואטסאפ?</summary>
        <ol className="text-muted-foreground space-y-2 mt-3 list-decimal list-inside">
          <li>פתח את הצ'אט עם הלקוח באפליקציית וואטסאפ</li>
          <li>iOS: לחץ על השם של הלקוח בראש הצ'אט → "ייצוא צ'אט"</li>
          <li>Android: ⋮ → עוד → ייצוא צ'אט</li>
          <li>בחר <strong>"כולל מדיה"</strong> כדי שגם הודעות קוליות יתומללו</li>
          <li>שמור את ה-ZIP (Files / Drive / שלח לעצמך) והעלה כאן</li>
        </ol>
      </details>
    </div>
  );
}
