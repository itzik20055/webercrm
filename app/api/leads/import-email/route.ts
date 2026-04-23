import { NextResponse, after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, pendingEmails } from "@/db";
import { processEmailImport } from "@/lib/email-import-worker";
import { isBlockedEmailAddress, normalizeEmailAddress } from "@/lib/email-config";

export const runtime = "nodejs";
// Fetching 100 messages from IMAP + AI extraction can take 30-60s on a long
// thread. 300s matches the WhatsApp import route.
export const maxDuration = 300;

const bodySchema = z.object({
  emailAddress: z
    .string()
    .trim()
    .email("כתובת מייל לא תקינה")
    .max(254),
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const emailAddress = normalizeEmailAddress(body.emailAddress);

    if (isBlockedEmailAddress(emailAddress)) {
      return NextResponse.json(
        {
          error:
            "הכתובת הזו חסומה (no-reply / מערכת). אי אפשר לעקוב אחריה.",
        },
        { status: 400 }
      );
    }

    // Dedup: if there's already an open import row for this address, return it
    // instead of starting a second one. "Open" = pending/processing/done
    // (awaiting review). Already-merged/dismissed rows are historic — the
    // user is free to import again.
    const [openRow] = await db
      .select({
        id: pendingEmails.id,
        status: pendingEmails.status,
      })
      .from(pendingEmails)
      .where(
        and(
          eq(pendingEmails.kind, "new_import"),
          eq(pendingEmails.emailAddress, emailAddress),
          inArray(pendingEmails.status, ["pending", "processing", "done"])
        )
      );

    if (openRow) {
      return NextResponse.json({
        ok: true,
        id: openRow.id,
        status: openRow.status,
        duplicate: true,
      });
    }

    const [inserted] = await db
      .insert(pendingEmails)
      .values({
        kind: "new_import",
        emailAddress,
        status: "pending",
      })
      .returning({ id: pendingEmails.id });

    const finalId = inserted.id;
    after(async () => {
      try {
        await processEmailImport({ id: finalId });
      } catch (e) {
        console.error("[email-import] background worker crashed", finalId, e);
      }
    });

    return NextResponse.json(
      { ok: true, id: finalId, status: "pending", duplicate: false },
      { status: 202 }
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      const message = e.issues[0]?.message ?? "קלט לא תקין";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
    console.error("Email import enqueue failed:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
