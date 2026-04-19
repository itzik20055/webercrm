import { NextResponse } from "next/server";
import { importWhatsAppExport } from "@/lib/whatsapp-import";
import { extractLeadFromChat } from "@/lib/ai-client";
import { getSetting } from "@/lib/settings";
import { db, leads } from "@/db";
import { ilike, desc, or, sql } from "drizzle-orm";
import { phoneTail } from "@/lib/phone";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const myName = await getSetting("whatsapp_display_name");
    if (!myName) {
      return NextResponse.json(
        {
          error:
            "קודם הגדר את השם שלך בוואטסאפ בעמוד ההגדרות (כך נדע מה אתה שלחת ומה הלקוח).",
        },
        { status: 400 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    const language = (form.get("language") as "he" | "en" | "yi" | null) ?? undefined;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "לא הועלה קובץ." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const isZip = file.name.toLowerCase().endsWith(".zip") ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed";

    const imported = await importWhatsAppExport(buffer, {
      isZip,
      myName,
      language,
      originalFilename: file.name,
    });

    if (imported.chat.messages.length === 0) {
      return NextResponse.json(
        { error: "לא זוהו הודעות בקובץ. ייתכן שהפורמט לא נתמך." },
        { status: 400 }
      );
    }

    const extracted = await extractLeadFromChat({
      chatText: imported.renderedChat,
      leadName: imported.inferredLeadName,
      ourName: myName,
    });

    // Find potentially matching existing leads by name (fuzzy) OR by phone tail.
    // We compare the last 9 digits of phone numbers, ignoring formatting (+972 vs 05).
    const conds = [];
    if (imported.inferredLeadName) {
      conds.push(ilike(leads.name, `%${imported.inferredLeadName}%`));
    }
    for (const phone of imported.inferredPhones) {
      const tail = phoneTail(phone);
      if (tail.length >= 7) {
        conds.push(sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 9) = ${tail}`);
      }
    }

    const matches =
      conds.length > 0
        ? await db
            .select({
              id: leads.id,
              name: leads.name,
              phone: leads.phone,
              status: leads.status,
              updatedAt: leads.updatedAt,
            })
            .from(leads)
            .where(or(...conds))
            .orderBy(desc(leads.updatedAt))
            .limit(5)
        : [];

    return NextResponse.json({
      ok: true,
      inferredLeadName: imported.inferredLeadName,
      inferredPhones: imported.inferredPhones,
      audioStats: imported.audioStats,
      messageCount: imported.chat.messages.length,
      firstMessageAt: imported.chat.messages[0]?.timestamp,
      lastMessageAt: imported.chat.messages.at(-1)?.timestamp,
      lead: extracted.lead,
      renderedChat: imported.renderedChat,
      transcripts: imported.transcripts,
      existingMatches: matches,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
    console.error("WhatsApp import failed:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
