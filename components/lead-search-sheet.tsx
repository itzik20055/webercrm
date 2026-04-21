"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import {
  AUDIENCE_LABELS,
  LANGUAGE_LABELS,
} from "@/db/schema";
import { searchLeadsForChat, type LeadSearchHit } from "@/app/(app)/chat/actions";

export function LeadSearchSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick?: (lead: LeadSearchHit) => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LeadSearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 1) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const rows = await searchLeadsForChat({ q: term, limit: 12 });
      if (!cancelled) {
        setHits(rows);
        setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  if (!open) return null;

  function handlePick(lead: LeadSearchHit) {
    if (onPick) {
      onPick(lead);
    } else {
      router.push(`/leads/${lead.id}`);
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="חיפוש ליד"
    >
      <div
        className="w-full sm:max-w-md bg-card border-t sm:border border-border rounded-t-3xl sm:rounded-3xl shadow-soft p-4 space-y-3 max-h-[85dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[15px]">חיפוש ליד</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className="press size-8 rounded-full hover:bg-accent/40 flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="שם או טלפון..."
            inputMode="search"
            className="w-full h-11 pr-10 pl-3 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {loading && (
            <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 overflow-y-auto -mx-4 px-4 space-y-1.5">
          {q.trim() === "" && (
            <p className="text-[12px] text-muted-foreground text-center py-6">
              הקלד שם או טלפון כדי לחפש
            </p>
          )}
          {q.trim() && !loading && hits.length === 0 && (
            <p className="text-[12px] text-muted-foreground text-center py-6">
              לא נמצאו לידים
            </p>
          )}
          {hits.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => handlePick(l)}
              className="press w-full text-right p-3 rounded-xl border border-border/70 hover:bg-accent/40 transition"
            >
              <div className="text-[14px] font-semibold truncate">{l.name}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums truncate">
                {l.phone} · {AUDIENCE_LABELS[l.audience]} · {LANGUAGE_LABELS[l.language]}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
