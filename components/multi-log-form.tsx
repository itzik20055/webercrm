"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { logInteractionsBatch } from "@/app/(app)/leads/actions";
import { INTERACTION_TYPE_LABELS } from "@/db/schema";
import { cn } from "@/lib/utils";

type Direction = "in" | "out" | "internal";
type InteractionType = "call_in" | "call_out" | "whatsapp" | "email" | "sms" | "note";

interface Row {
  id: string;
  direction: Direction;
  type: InteractionType;
  content: string;
  durationMin: string;
  occurredAt: string;
}

function newRow(direction: Direction): Row {
  return {
    id: crypto.randomUUID(),
    direction,
    type: "whatsapp",
    content: "",
    durationMin: "",
    occurredAt: "",
  };
}

export function MultiLogForm({
  leadId,
  leadName,
}: {
  leadId: string;
  leadName: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => [newRow("in")]);
  const [pending, start] = useTransition();

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((rs) => {
      const last = rs[rs.length - 1];
      const nextDir: Direction =
        last?.direction === "in"
          ? "out"
          : last?.direction === "out"
            ? "in"
            : "in";
      return [...rs, newRow(nextDir)];
    });
  }

  function removeRow(id: string) {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.id !== id)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const ready = rows
      .map((r) => ({ ...r, content: r.content.trim() }))
      .filter((r) => r.content.length > 0);
    if (ready.length === 0) {
      toast.error("תוכן ההודעה חובה");
      return;
    }

    const fd = new FormData();
    fd.set("leadId", leadId);
    for (const r of ready) {
      fd.append(
        "rows",
        JSON.stringify({
          type: r.type,
          direction: r.direction,
          content: r.content,
          durationMin: r.durationMin || null,
          occurredAt: r.occurredAt || null,
        })
      );
    }

    start(async () => {
      try {
        await logInteractionsBatch(fd);
        toast.success(
          ready.length === 1 ? "השיחה תועדה" : `${ready.length} הודעות נשמרו`
        );
        router.push(`/leads/${leadId}`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "שמירה נכשלה");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        תעד את כל ההודעות בהלוך-חזור עם {leadName}. אל תריץ AI כאן — אחרי השמירה,
        לחץ "עיבוד עם AI" בעמוד הליד כדי שהפרופיל יתעדכן.
      </p>

      <div className="space-y-3">
        {rows.map((r, idx) => (
          <RowCard
            key={r.id}
            row={r}
            index={idx}
            canRemove={rows.length > 1}
            onChange={(patch) => updateRow(r.id, patch)}
            onRemove={() => removeRow(r.id)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="press w-full h-11 rounded-xl border border-dashed border-border bg-background text-sm font-medium flex items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground hover:border-primary/40"
      >
        <Plus className="size-4" />
        הוסף הודעה
      </button>

      <div className="pt-2">
        <button
          type="submit"
          disabled={pending}
          className="press w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          שמור {rows.filter((r) => r.content.trim()).length || ""} הודעות
        </button>
      </div>
    </form>
  );
}

function RowCard({
  row,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  row: Row;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const isCall = row.type === "call_in" || row.type === "call_out";
  const accent =
    row.direction === "in"
      ? "border-r-4 border-r-blue-400"
      : row.direction === "out"
        ? "border-r-4 border-r-emerald-400"
        : "border-r-4 border-r-muted-foreground/30";

  return (
    <div
      className={cn(
        "bg-card border border-border rounded-2xl p-3 space-y-2.5",
        accent
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
          #{index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="מחק הודעה"
            className="press size-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            { v: "in" as const, l: "נכנס" },
            { v: "out" as const, l: "יוצא" },
            { v: "internal" as const, l: "פנימי" },
          ] as const
        ).map((d) => (
          <button
            key={d.v}
            type="button"
            onClick={() => onChange({ direction: d.v })}
            aria-pressed={row.direction === d.v}
            className={cn(
              "press h-9 rounded-lg text-sm font-medium border",
              row.direction === d.v
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border"
            )}
          >
            {d.l}
          </button>
        ))}
      </div>

      <textarea
        value={row.content}
        onChange={(e) => onChange({ content: e.target.value })}
        rows={3}
        placeholder="תוכן ההודעה..."
        dir="auto"
        className="w-full text-sm rounded-xl border border-border bg-background p-2.5 resize-y placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />

      <div className="grid grid-cols-2 gap-2">
        <select
          value={row.type}
          onChange={(e) =>
            onChange({ type: e.target.value as InteractionType })
          }
          aria-label="סוג"
          className="w-full h-9 px-2 rounded-lg border border-border bg-background text-xs"
        >
          {Object.entries(INTERACTION_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={row.occurredAt}
          onChange={(e) => onChange({ occurredAt: e.target.value })}
          aria-label="זמן"
          className="w-full h-9 px-2 rounded-lg border border-border bg-background text-xs"
        />
      </div>

      {isCall && (
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={row.durationMin}
          onChange={(e) => onChange({ durationMin: e.target.value })}
          placeholder="משך בדקות (לשיחה)"
          className="w-full h-9 px-2 rounded-lg border border-border bg-background text-xs"
        />
      )}
    </div>
  );
}
