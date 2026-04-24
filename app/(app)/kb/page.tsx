import Link from "next/link";
import { db, productKb } from "@/db";
import { asc } from "drizzle-orm";
import {
  BookOpen,
  Plus,
  ChevronLeft,
  Hotel,
  BedDouble,
  UtensilsCrossed,
  Mountain,
  Tag,
  Plane,
  HelpCircle,
  EyeOff,
  Brain,
} from "lucide-react";
import { KbToggle } from "./toggle";
import { RulesEditor } from "@/components/rules-editor";
import { getAiRules } from "@/lib/ai-rules";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  hotel: "מלון ומיקום",
  rooms: "חדרים",
  food: "אוכל וכשרות",
  activities: "טיולים ופעילויות",
  prices: "מחירון",
  logistics: "לוגיסטיקה",
  faq: "שאלות והתנגדויות",
};

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  hotel: Hotel,
  rooms: BedDouble,
  food: UtensilsCrossed,
  activities: Mountain,
  prices: Tag,
  logistics: Plane,
  faq: HelpCircle,
};

const CATEGORY_ORDER = ["hotel", "rooms", "food", "activities", "prices", "logistics", "faq"];

export default async function KbPage() {
  const [entries, rules] = await Promise.all([
    db
      .select()
      .from(productKb)
      .orderBy(asc(productKb.category), asc(productKb.title)),
    getAiRules(),
  ]);

  const grouped = entries.reduce<Record<string, typeof entries>>((acc, e) => {
    (acc[e.category] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="px-4 pt-5 pb-6 space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground tracking-tight flex items-center gap-1.5">
            <BookOpen className="size-3.5" />
            ידע
          </p>
          <h1 className="text-[26px] font-bold tracking-tight leading-tight">
            כללי כתיבה וידע
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            כללים גלובליים + ידע על המוצר. ה-AI ניזון מכל מה שכאן.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/kb/learning"
            className="press inline-flex items-center gap-1.5 h-11 px-3.5 rounded-full bg-card border border-border text-sm font-semibold text-foreground shadow-soft"
          >
            <Brain className="size-4 text-primary" />
            למידה
          </Link>
          <Link
            href="/kb/new"
            className="press inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-card"
          >
            <Plus className="size-[18px]" strokeWidth={2.5} />
            חדש
          </Link>
        </div>
      </header>

      <RulesEditor initialRules={rules} />

      {entries.length === 0 ? (
        <div className="text-sm text-muted-foreground py-10 px-4 text-center bg-card/60 border border-dashed border-border/80 rounded-2xl">
          עוד אין ידע. הרץ <code className="px-1 py-0.5 rounded bg-muted">npm run db:seed-kb</code> או הוסף ערך חדש.
        </div>
      ) : (
        CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((cat) => {
          const Icon = CATEGORY_ICONS[cat] ?? BookOpen;
          const items = grouped[cat]!;
          return (
            <section key={cat} className="space-y-2.5">
              <div className="flex items-center gap-2 px-1">
                <Icon className="size-[18px] text-primary" />
                <h2 className="font-bold tracking-tight">{CATEGORY_LABELS[cat]}</h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-secondary text-secondary-foreground">
                  {items.length}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-card border border-border/70 shadow-soft"
                  >
                    <Link
                      href={`/kb/${e.id}/edit`}
                      className="min-w-0 flex-1 press"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold truncate tracking-tight">
                          {e.title}
                        </span>
                        {!e.active && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
                            <EyeOff className="size-3" />
                            כבוי
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">
                        {e.content}
                      </p>
                    </Link>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <KbToggle id={e.id} active={e.active} />
                      <Link
                        href={`/kb/${e.id}/edit`}
                        className="press text-muted-foreground"
                        aria-label="ערוך"
                      >
                        <ChevronLeft className="size-4" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
