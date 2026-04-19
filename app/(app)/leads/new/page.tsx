import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createLead } from "../actions";
import {
  AUDIENCE_LABELS,
  CHANNEL_LABELS,
  LANGUAGE_LABELS,
} from "@/db/schema";

export default function NewLeadPage() {
  return (
    <div className="px-4 pt-4 pb-8">
      <header className="flex items-center gap-2 mb-5">
        <Link
          href="/leads"
          className="size-9 -mr-2 rounded-full flex items-center justify-center hover:bg-accent"
          aria-label="חזרה"
        >
          <ChevronRight className="size-5" />
        </Link>
        <h1 className="text-xl font-bold">ליד חדש</h1>
      </header>

      <form action={createLead} className="space-y-4" autoComplete="off">
        <Field label="שם *" required>
          <input
            name="name"
            required
            autoFocus
            placeholder="שם הלקוח"
            className="form-input"
          />
        </Field>

        <Field label="טלפון *" required>
          <input
            name="phone"
            type="tel"
            required
            inputMode="tel"
            placeholder="050-1234567 או +1..."
            className="form-input"
          />
        </Field>

        <Field label="מייל">
          <input
            name="email"
            type="email"
            inputMode="email"
            placeholder="לא חובה"
            className="form-input"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="שפה">
            <select name="language" defaultValue="he" className="form-input">
              {Object.entries(LANGUAGE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="קהל">
            <select name="audience" defaultValue="israeli_haredi" className="form-input">
              {Object.entries(AUDIENCE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="הגיע דרך">
          <select name="channelFirst" defaultValue="whatsapp" className="form-input">
            {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>

        <Field label="מקור (איך שמע עלינו)">
          <input
            name="source"
            placeholder="חבר, פייסבוק, מודעה..."
            className="form-input"
          />
        </Field>

        <Field label="הערה ראשונית">
          <textarea
            name="notes"
            rows={3}
            placeholder="מה רצה? מה שאל?"
            className="form-input resize-none"
          />
        </Field>

        <div className="flex gap-3 pt-3">
          <Link
            href="/leads"
            className="flex-1 h-12 rounded-lg border flex items-center justify-center font-medium"
          >
            ביטול
          </Link>
          <button
            type="submit"
            className="flex-[2] h-12 rounded-lg bg-primary text-primary-foreground font-medium active:scale-[0.98] transition"
          >
            שמור ליד
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

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> </span>}
      </span>
      {children}
    </label>
  );
}
