"use client";

import { useTransition } from "react";
import { toggleKbActive } from "./actions";

export function KbToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={pending}
      onClick={() => start(() => toggleKbActive(id, !active))}
      className={
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 " +
        (active ? "bg-primary" : "bg-muted")
      }
    >
      <span
        className={
          "inline-block size-5 rounded-full bg-white shadow transition-transform " +
          (active ? "translate-x-[18px]" : "translate-x-0.5")
        }
      />
    </button>
  );
}
