import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { db, leads } from "@/db";
import { eq } from "drizzle-orm";
import { scheduleFollowup } from "../../actions";
import { FollowupQuickForm } from "./quick-form";

export default async function ScheduleFollowupPage({
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
    await scheduleFollowup(formData);
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
          <h1 className="text-xl font-bold">קביעת פולואפ</h1>
          <p className="text-xs text-muted-foreground">{lead.name}</p>
        </div>
      </header>

      <FollowupQuickForm action={action} />
    </div>
  );
}
