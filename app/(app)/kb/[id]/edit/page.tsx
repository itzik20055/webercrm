import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Trash2 } from "lucide-react";
import { eq } from "drizzle-orm";
import { db, productKb, LANGUAGE_LABELS } from "@/db";
import { updateKbEntry, deleteKbEntry } from "../../actions";

const CATEGORY_LABELS: Record<string, string> = {
  hotel: "מלון ומיקום",
  rooms: "חדרים",
  food: "אוכל וכשרות",
  activities: "טיולים ופעילויות",
  prices: "מחירון",
  logistics: "לוגיסטיקה",
  faq: "שאלות והתנגדויות",
};

export default async function EditKbPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [entry] = await db.select().from(productKb).where(eq(productKb.id, id));
  if (!entry) notFound();

  async function deleteAction() {
    "use server";
    await deleteKbEntry(id);
  }

  return (
    <div className="px-4 pt-4 pb-8">
      <header className="flex items-center justify-between gap-2 mb-5">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/kb"
            className="size-9 -mr-2 rounded-full flex items-center justify-center hover:bg-accent shrink-0"
            aria-label="חזרה"
          >
            <ChevronRight className="size-5" />
          </Link>
          <h1 className="text-xl font-bold truncate">עריכת ידע</h1>
        </div>
        <form action={deleteAction}>
          <button
            type="submit"
            className="press inline-flex items-center justify-center size-10 rounded-full text-destructive bg-destructive/10"
            aria-label="מחק"
          >
            <Trash2 className="size-[18px]" />
          </button>
        </form>
      </header>

      <form action={updateKbEntry} className="space-y-4" autoComplete="off">
        <input type="hidden" name="id" value={entry.id} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="קטגוריה">
            <select name="category" defaultValue={entry.category} className="form-input" required>
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="שפה">
            <select name="language" defaultValue={entry.language} className="form-input">
              {Object.entries(LANGUAGE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="כותרת">
          <input
            name="title"
            required
            defaultValue={entry.title}
            className="form-input"
          />
        </Field>

        <Field label="תוכן">
          <textarea
            name="content"
            rows={12}
            required
            defaultValue={entry.content}
            className="form-input resize-none whitespace-pre-wrap"
          />
        </Field>

        <label className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            name="active"
            defaultChecked={entry.active}
            className="size-4 accent-primary"
          />
          <span className="text-sm">פעיל (יישלח ל-AI)</span>
        </label>

        <div className="text-xs text-muted-foreground px-1 tabular-nums">
          עודכן: {new Date(entry.updatedAt).toLocaleString("he-IL")}
        </div>

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
            שמור שינויים
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
