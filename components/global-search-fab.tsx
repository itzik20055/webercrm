"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { LeadSearchSheet } from "./lead-search-sheet";

export function GlobalSearchFab() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="חיפוש ליד"
        className="press fixed z-40 bottom-[calc(env(safe-area-inset-bottom)+74px)] right-4 size-12 rounded-full bg-card border border-border/70 shadow-soft flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-accent/40"
      >
        <Search className="size-[18px]" strokeWidth={2.4} />
      </button>
      <LeadSearchSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
