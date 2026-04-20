import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createKbEntry } from "../actions";
import { LANGUAGE_LABELS } from "@/db/schema";

const CATEGORY_LABELS: Record<string, string> = {
  hotel: "מלון ומיקום",
  rooms: "חדרים",
  food: "אוכל וכשרות",
  activities: "טיולים ופעילויות",
  prices: "מחירון",
  logistics: "לוגיסטיקה",
  faq: "שאלות והתנגדויות",
};

export default async function NewKbPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const sp = await searchParams;
  const defaultCategory =
    sp.category && CATEGORY_LABELS[sp.category] ? sp.category : "hotel";

  return (
    <div className="px-4 pt-4 pb-8">
      <header className="flex items-center gap-2 mb-5">
        <Link
          href="/kb"
          className="press size-11 -mr-2 rounded-full flex items-center justify-center hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="חזרה לספר הידע"
        >
          <ChevronRight className="size-5" />
        </Link>
        <h1 className="text-xl font-bold">ידע חדש</h1>
      </header>

      <form action={createKbEntry} className="space-y-4" autoComplete="off">
        <div className="grid grid-cols-2 gap-3">
          <Field label="קטגוריה *">
            <select name="category" defaultValue={defaultCategory} className="form-input" required>
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="שפה">
            <select name="language" defaultValue="he" className="form-input">
              {Object.entries(LANGUAGE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="כותרת *">
          <input
            name="title"
            required
            autoFocus
            placeholder="לדוגמה: מי הרב המשגיח?"
            className="form-input"
          />
        </Field>

        <Field label="תוכן *">
          <textarea
            name="content"
            rows={10}
            required
            placeholder={"הכנס את הידע. אפשר רשימות, פסקאות, מספרים — מה שעוזר לזכור.\nככל שהתשובה מדויקת ומפורטת, ה-AI יענה טוב יותר."}
            className="form-input resize-none whitespace-pre-wrap"
          />
        </Field>

        <label className="flex items-center gap-2 px-1">
          <input type="checkbox" name="active" defaultChecked className="size-4 accent-primary" />
          <span className="text-sm">פעיל (יישלח ל-AI)</span>
        </label>

        <div className="flex gap-3 pt-3">
          <Link
            href="/kb"
            className="press flex-1 h-12 rounded-full border border-border flex items-center justify-center font-medium"
          >
            ביטול
          </Link>
          <button
            type="submit"
            className="press flex-[2] h-12 rounded-full bg-primary text-primary-foreground font-semibold shadow-card"
          >
            שמור ידע
          </button>
        </div>
      </form>

      <style>{`
        .form-input {
          width: 100%;
          height: 3rem;
          padding: 0 0.875rem;
          border-radius: 0.75rem;
          border: 1px solid var(--border);
          background: var(--card);
          font-size: 1rem;
          color: var(--foreground);
        }
        textarea.form-input { height: auto; padding: 0.625rem 0.875rem; line-height: 1.5; }
        .form-input:focus { outline: 2px solid var(--ring); outline-offset: -1px; }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
