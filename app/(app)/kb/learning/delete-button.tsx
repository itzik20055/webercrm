"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteVoiceExample } from "./actions";

export function DeleteExampleButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm("למחוק את הדוגמה? המערכת לא תחקה אותה יותר. לא ניתן לשחזור.")) return;
        start(async () => {
          await deleteVoiceExample(id);
        });
      }}
      className="press size-9 rounded-full text-rose-600 hover:bg-rose-500/10 flex items-center justify-center disabled:opacity-50 shrink-0"
      aria-label="מחק דוגמה"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
