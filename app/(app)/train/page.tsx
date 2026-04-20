import { TrainerClient } from "./trainer-client";
import { GraduationCap } from "lucide-react";

export const dynamic = "force-dynamic";

export default function TrainPage() {
  return (
    <div className="px-4 pt-5 pb-6 space-y-4">
      <header>
        <p className="text-xs font-medium text-muted-foreground tracking-tight flex items-center gap-1.5">
          <GraduationCap className="size-3.5" />
          אימון
        </p>
        <h1 className="text-[26px] font-bold tracking-tight leading-tight">
          תרגול שאלות לקוחות
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          שאל שאלה כמו לקוח. ה-AI יענה לפי הידע שיש לו. אתה עורך — הגרסה הסופית נשמרת כשאלה נפוצה ומזינה את כל ההצעות העתידיות.
        </p>
      </header>
      <TrainerClient />
    </div>
  );
}
