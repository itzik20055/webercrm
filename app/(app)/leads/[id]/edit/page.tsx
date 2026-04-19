import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, Trash2 } from "lucide-react";
import { db, leads } from "@/db";
import { eq } from "drizzle-orm";
import { updateLead, deleteLead } from "../../actions";
import {
  AUDIENCE_LABELS,
  CHANNEL_LABELS,
  LANGUAGE_LABELS,
  STATUS_LABELS,
  PRIORITY_LABELS,
} from "@/db/schema";

export default async function EditLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) notFound();

  async function action(formData: FormData) {
    "use server";
    formData.set("id", id);
    await updateLead(formData);
    redirect(`/leads/${id}`);
  }

  async function remove() {
    "use server";
    await deleteLead(id);
  }

  return (
    <div className="px-4 pt-3 pb-8">
      <header className="flex items-center gap-2 mb-5">
        <Link
          href={`/leads/${id}`}
          className="size-9 -mr-2 rounded-full flex items-center justify-center hover:bg-accent"
          aria-label="חזרה"
        >
          <ChevronRight className="size-5" />
        </Link>
        <h1 className="text-xl font-bold">עריכת ליד</h1>
      </header>

      <form action={action} className="space-y-4">
        <Section title="פרטים אישיים">
          <Field label="שם">
            <input name="name" defaultValue={lead.name} required className="form-input" />
          </Field>
          <Field label="טלפון">
            <input name="phone" defaultValue={lead.phone} required type="tel" className="form-input" />
          </Field>
          <Field label="מייל">
            <input name="email" defaultValue={lead.email ?? ""} type="email" className="form-input" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="שפה">
              <select name="language" defaultValue={lead.language} className="form-input">
                {Object.entries(LANGUAGE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="קהל">
              <select name="audience" defaultValue={lead.audience} className="form-input">
                {Object.entries(AUDIENCE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="הגיע דרך">
              <select name="channelFirst" defaultValue={lead.channelFirst} className="form-input">
                {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="מקור">
              <input name="source" defaultValue={lead.source ?? ""} className="form-input" />
            </Field>
          </div>
        </Section>

        <Section title="סטטוס">
          <div className="grid grid-cols-2 gap-3">
            <Field label="סטטוס">
              <select name="status" defaultValue={lead.status} className="form-input">
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="עדיפות">
              <select name="priority" defaultValue={lead.priority} className="form-input">
                {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
          </div>
          {lead.status === "lost" && (
            <Field label="סיבת אובדן">
              <input
                name="lostReason"
                defaultValue={lead.lostReason ?? ""}
                placeholder="מחיר, סגר אצל מתחרה..."
                className="form-input"
              />
            </Field>
          )}
        </Section>

        <Section title="פרטי הנופש">
          <div className="grid grid-cols-2 gap-3">
            <Field label="מבוגרים">
              <input
                name="numAdults"
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={lead.numAdults ?? ""}
                className="form-input"
              />
            </Field>
            <Field label="ילדים">
              <input
                name="numChildren"
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={lead.numChildren ?? ""}
                className="form-input"
              />
            </Field>
          </div>
          <Field label="גילי ילדים">
            <input
              name="agesChildren"
              defaultValue={lead.agesChildren ?? ""}
              placeholder="5, 8, 12"
              className="form-input"
            />
          </Field>
          <Field label="תאריכים">
            <input
              name="datesInterest"
              defaultValue={lead.datesInterest ?? ""}
              placeholder="1-7 אוגוסט"
              className="form-input"
            />
          </Field>
          <Field label="סוג חדר">
            <input
              name="roomTypeInterest"
              defaultValue={lead.roomTypeInterest ?? ""}
              placeholder="סוויטה משפחתית"
              className="form-input"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="בניין">
              <select name="buildingPref" defaultValue={lead.buildingPref ?? ""} className="form-input">
                <option value="">לא נקבע</option>
                <option value="a">A</option>
                <option value="b">B</option>
                <option value="any">לא משנה</option>
              </select>
            </Field>
            <Field label="תקציב">
              <select name="budgetSignal" defaultValue={lead.budgetSignal ?? ""} className="form-input">
                <option value="">לא ידוע</option>
                <option value="low">נמוך</option>
                <option value="mid">בינוני</option>
                <option value="high">גבוה</option>
              </select>
            </Field>
          </div>
        </Section>

        <Section title="המכירה">
          <Field label="מה תפס אותו">
            <textarea
              name="whatSpokeToThem"
              defaultValue={lead.whatSpokeToThem ?? ""}
              rows={3}
              placeholder="התלהב מהאוכל, רוצה לדעת על מסלולי טיולים..."
              className="form-input resize-none"
            />
          </Field>
          <Field label="התנגדויות">
            <textarea
              name="objections"
              defaultValue={lead.objections ?? ""}
              rows={3}
              placeholder="אמר שיקר, מחפש משהו זול יותר..."
              className="form-input resize-none"
            />
          </Field>
          <Field label="הערות כלליות">
            <textarea
              name="notes"
              defaultValue={lead.notes ?? ""}
              rows={4}
              className="form-input resize-none"
            />
          </Field>
        </Section>

        <div className="flex gap-3 pt-3">
          <Link
            href={`/leads/${id}`}
            className="flex-1 h-12 rounded-lg border flex items-center justify-center font-medium"
          >
            ביטול
          </Link>
          <button
            type="submit"
            className="flex-[2] h-12 rounded-lg bg-primary text-primary-foreground font-medium active:scale-[0.98] transition"
          >
            שמור
          </button>
        </div>
      </form>

      <form action={remove} className="mt-8 pt-6 border-t">
        <button
          type="submit"
          className="w-full h-11 rounded-lg text-destructive border border-destructive/30 font-medium flex items-center justify-center gap-2 active:scale-[0.99] transition"
        >
          <Trash2 className="size-4" />
          מחק ליד
        </button>
        <p className="text-xs text-muted-foreground text-center mt-2">
          מחיקה היא לצמיתות וכוללת היסטוריית שיחות ופולואפים
        </p>
      </form>

      <style>{`
        .form-input {
          width: 100%;
          height: 3rem;
          padding: 0 0.875rem;
          border-radius: 0.5rem;
          border: 1px solid var(--border);
          background: var(--card);
          font-size: 1rem;
          color: var(--foreground);
        }
        textarea.form-input { height: auto; padding: 0.625rem 0.875rem; }
        .form-input:focus { outline: 2px solid var(--ring); outline-offset: -1px; }
      `}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground px-1">
        {title}
      </h2>
      <div className="bg-card border rounded-xl p-3.5 space-y-3">{children}</div>
    </section>
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
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
