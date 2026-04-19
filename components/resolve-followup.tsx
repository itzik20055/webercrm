"use client";

import { useState, useTransition } from "react";
import { addDays, addHours, format, setHours, setMinutes } from "date-fns";
import { Check, BellRing, CheckCircle2, XCircle, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { resolveFollowup } from "@/app/(app)/leads/actions";
import { cn } from "@/lib/utils";

const QUICK_OPTIONS = [
  { label: "בעוד שעה", build: () => addHours(new Date(), 1) },
  { label: "בעוד 4 שעות", build: () => addHours(new Date(), 4) },
  { label: "מחר 9:00", build: () => setMinutes(setHours(addDays(new Date(), 1), 9), 0) },
  { label: "מחר 14:00", build: () => setMinutes(setHours(addDays(new Date(), 1), 14), 0) },
  { label: "בעוד 3 ימים", build: () => addDays(new Date(), 3) },
  { label: "שבוע", build: () => addDays(new Date(), 7) },
];

function toLocalInput(d: Date) {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

type Mode = "menu" | "next" | "booked" | "lost";

export function ResolveFollowupButton({
  followupId,
  leadId,
  label = "בוצע",
}: {
  followupId: string;
  leadId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");

  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (!o) setTimeout(() => setMode("menu"), 250);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press inline-flex items-center gap-1.5 px-3.5 h-10 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-sm font-semibold"
      >
        <Check className="size-4" />
        {label}
      </button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="rounded-t-3xl border-t-0 px-0 pt-2 pb-[calc(env(safe-area-inset-bottom)+16px)] max-h-[92vh]"
        >
          <div className="mx-auto h-1 w-9 rounded-full bg-muted-foreground/30 mb-2" />

          {mode === "menu" && (
            <MenuView
              onPick={(m) => setMode(m)}
            />
          )}

          {mode === "next" && (
            <NextFollowupForm
              followupId={followupId}
              leadId={leadId}
              onBack={() => setMode("menu")}
              onDone={() => handleOpenChange(false)}
            />
          )}

          {mode === "booked" && (
            <BookedForm
              followupId={followupId}
              leadId={leadId}
              onBack={() => setMode("menu")}
              onDone={() => handleOpenChange(false)}
            />
          )}

          {mode === "lost" && (
            <LostForm
              followupId={followupId}
              leadId={leadId}
              onBack={() => setMode("menu")}
              onDone={() => handleOpenChange(false)}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function MenuView({ onPick }: { onPick: (m: Mode) => void }) {
  return (
    <div className="px-4 pt-2 space-y-3">
      <SheetTitle className="text-center text-lg font-bold">סגירת הפולואפ</SheetTitle>
      <p className="text-center text-sm text-muted-foreground">מה הצעד הבא בליד הזה?</p>

      <div className="space-y-2 pt-2">
        <ActionRow
          icon={<BellRing className="size-5" />}
          title="קבע פולואפ הבא"
          subtitle="בוצע + תזכורת חדשה"
          tone="primary"
          onClick={() => onPick("next")}
        />
        <ActionRow
          icon={<CheckCircle2 className="size-5" />}
          title="נסגר ✓"
          subtitle="הליד הזמין — סטטוס: נסגר"
          tone="success"
          onClick={() => onPick("booked")}
        />
        <ActionRow
          icon={<XCircle className="size-5" />}
          title="לא רלוונטי"
          subtitle="הליד נופל — סטטוס: אבוד"
          tone="muted"
          onClick={() => onPick("lost")}
        />
      </div>
    </div>
  );
}

function ActionRow({
  icon,
  title,
  subtitle,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tone: "primary" | "success" | "muted";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "press w-full flex items-center gap-3 p-4 rounded-2xl border text-right",
        tone === "primary" && "bg-primary-soft border-primary/15 text-primary",
        tone === "success" && "bg-emerald-500/10 border-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        tone === "muted" && "bg-muted/60 border-border text-foreground"
      )}
    >
      <span className="size-10 rounded-full bg-background/70 flex items-center justify-center shrink-0">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-[15px]">{title}</span>
        <span className="block text-xs opacity-75 font-medium mt-0.5">{subtitle}</span>
      </span>
    </button>
  );
}

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-1">
      <button
        type="button"
        onClick={onBack}
        className="press size-9 -mr-2 rounded-full flex items-center justify-center hover:bg-accent"
        aria-label="חזרה"
      >
        <ChevronLeft className="size-5 rotate-180" />
      </button>
      <SheetTitle className="text-base font-bold flex-1 text-center pr-7">{title}</SheetTitle>
    </div>
  );
}

function NextFollowupForm({
  followupId,
  leadId,
  onBack,
  onDone,
}: {
  followupId: string;
  leadId: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [dueLocal, setDueLocal] = useState(() => toLocalInput(addHours(new Date(), 24)));
  const [reason, setReason] = useState("");

  function submit() {
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("action", "next");
        fd.set("followupId", followupId);
        fd.set("leadId", leadId);
        fd.set("dueAt", new Date(dueLocal).toISOString());
        if (reason) fd.set("reason", reason);
        await resolveFollowup(fd);
        toast.success("פולואפ הבא נקבע");
        onDone();
      } catch {
        toast.error("שמירה נכשלה");
      }
    });
  }

  return (
    <div className="space-y-4">
      <BackHeader title="פולואפ הבא" onBack={onBack} />
      <div className="px-4 space-y-4">
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1.5">בחירה מהירה</label>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_OPTIONS.map((o) => {
              const v = toLocalInput(o.build());
              const active = v === dueLocal;
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => setDueLocal(v)}
                  className={cn(
                    "h-11 rounded-xl border text-sm font-medium press",
                    active ? "bg-primary text-primary-foreground border-primary" : "bg-card"
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1.5">זמן מדויק</label>
          <input
            type="datetime-local"
            value={dueLocal}
            onChange={(e) => setDueLocal(e.target.value)}
            className="w-full h-12 px-3 rounded-xl border border-input bg-card text-base"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1.5">סיבה / מה לזכור</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="לחזור עם מחיר, מחכה לבת זוג..."
            className="w-full h-12 px-3 rounded-xl border border-input bg-card text-base"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="press w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
        >
          קבע פולואפ
        </button>
      </div>
    </div>
  );
}

function BookedForm({
  followupId,
  leadId,
  onBack,
  onDone,
}: {
  followupId: string;
  leadId: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");

  function submit() {
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("action", "booked");
        fd.set("followupId", followupId);
        fd.set("leadId", leadId);
        if (note) fd.set("note", note);
        await resolveFollowup(fd);
        toast.success("נסגר ✓");
        onDone();
      } catch {
        toast.error("שמירה נכשלה");
      }
    });
  }

  return (
    <div className="space-y-4">
      <BackHeader title="סימון כנסגר" onBack={onBack} />
      <div className="px-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          הליד יעבור לסטטוס <strong>נסגר</strong> והתזכורות ייפסקו.
        </p>
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1.5">הערה (אופציונלי)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="פרטי החבילה, תאריכים, סכום..."
            className="w-full h-12 px-3 rounded-xl border border-input bg-card text-base"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="press w-full h-12 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-50"
        >
          סגור כ-נסגר
        </button>
      </div>
    </div>
  );
}

function LostForm({
  followupId,
  leadId,
  onBack,
  onDone,
}: {
  followupId: string;
  leadId: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");

  function submit() {
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("action", "lost");
        fd.set("followupId", followupId);
        fd.set("leadId", leadId);
        if (reason) fd.set("reason", reason);
        await resolveFollowup(fd);
        toast.success("הליד סומן כאבוד");
        onDone();
      } catch {
        toast.error("שמירה נכשלה");
      }
    });
  }

  return (
    <div className="space-y-4">
      <BackHeader title="לא רלוונטי" onBack={onBack} />
      <div className="px-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          הליד יעבור לסטטוס <strong>אבוד</strong>. תוכל למצוא אותו תמיד דרך חיפוש.
        </p>
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1.5">סיבה (אופציונלי)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="מחיר, תאריכים לא מתאימים, בחר מתחרה..."
            className="w-full h-12 px-3 rounded-xl border border-input bg-card text-base"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="press w-full h-12 rounded-xl bg-foreground text-background font-semibold disabled:opacity-50"
        >
          סגור כאבוד
        </button>
      </div>
    </div>
  );
}
