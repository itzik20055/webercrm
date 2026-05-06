import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/session";
import { previewPhoneArchive } from "@/lib/archive-phone";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { dateFrom?: string; dateTo?: string };
    if (!body.dateFrom || !body.dateTo) {
      return NextResponse.json(
        { error: "dateFrom ו-dateTo חובה" },
        { status: 400 }
      );
    }
    const from = new Date(body.dateFrom);
    const to = new Date(body.dateTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: "תאריך לא תקין" }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json(
        { error: "תאריך התחלה אחרי תאריך סיום" },
        { status: 400 }
      );
    }

    const result = await previewPhoneArchive({ dateFrom: from, dateTo: to });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
    console.error("[archive/phone/preview] failed", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
