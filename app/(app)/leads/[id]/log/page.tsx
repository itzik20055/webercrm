import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { db, leads } from "@/db";
import { eq } from "drizzle-orm";
import { logInteraction } from "../../actions";
import { INTERACTION_TYPE_LABELS } from "@/db/schema";

export default async function LogInteractionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) notFound();

  async function action(formData: FormData) {
    "use server";
    formData.set("leadId", id);
    await logInteraction(formData);
    redirect(`/leads/${id}`);
  }

  return (
    <div className="px-4 pt-3 pb-8">
      <header className="flex items-center gap-2 mb-5">
        <Link
          href={`/leads/${id}`}
          className="press size-11 -mr-2 rounded-full flex items-center justify-center hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`חזרה ל${lead.name}`}
        >
          <ChevronRight className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">תיעוד שיחה</h1>
          <p className="text-xs text-muted-foreground">{lead.name}</p>
        </div>
      </header>

      <form action={action} className="space-y-4">
        <div>
          <label htmlFor="interaction-type" className="text-sm font-medium block mb-1.5">
            סוג
          </label>
          <select id="interaction-type" name="type" defaultValue="whatsapp" className="form-input">
            {Object.entries(INTERACTION_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className="text-sm font-medium block mb-1.5">כיוון</legend>
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: "in", l: "נכנס" },
              { v: "out", l: "יוצא" },
              { v: "internal", l: "פנימי" },
            ].map((d) => (
              <label key={d.v} className="block">
                <input
                  type="radio"
                  name="direction"
                  value={d.v}
                  defaultChecked={d.v === "in"}
                  className="peer sr-only"
                />
                <div className="h-11 rounded-lg border bg-card flex items-center justify-center text-sm font-medium peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary cursor-pointer transition active:scale-95">
                  {d.l}
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="interaction-content" className="text-sm font-medium block mb-1.5">
            תוכן{" "}
            <span className="text-destructive" aria-label="חובה">
              *
            </span>{" "}
            <span className="text-xs text-muted-foreground font-normal">
              (תוכל להדביק וואטסאפ במלואו)
            </span>
          </label>
          <textarea
            id="interaction-content"
            name="content"
            required
            rows={10}
            autoFocus
            placeholder="תוכן השיחה / הודעה / סיכום..."
            className="form-input resize-none font-sans"
          />
        </div>

        <div>
          <label htmlFor="interaction-duration" className="text-sm font-medium block mb-1.5">
            משך (דקות)
          </label>
          <input
            id="interaction-duration"
            name="durationMin"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="לשיחות בלבד"
            className="form-input"
          />
        </div>

        <div className="flex gap-3 pt-3">
          <Link
            href={`/leads/${id}`}
            className="press flex-1 h-12 rounded-lg border flex items-center justify-center font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            ביטול
          </Link>
          <button
            type="submit"
            className="press flex-[2] h-12 rounded-lg bg-primary text-primary-foreground font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            שמור תיעוד
          </button>
        </div>
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
