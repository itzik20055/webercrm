import { NextResponse } from "next/server";
import { importWhatsAppExport } from "@/lib/whatsapp-import";
import { transcribeAudio } from "@/lib/ai-client";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 300;

const AUDIO_EXT = /\.(opus|m4a|mp3|ogg|wav|aac)$/i;

function err(msg: string, status = 400) {
  return new NextResponse(msg, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function processFile(file: File, myName: string): Promise<string> {
  const name = file.name;
  const lower = name.toLowerCase();
  const isZip =
    lower.endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed";
  const isAudio = AUDIO_EXT.test(lower) || /^audio\//i.test(file.type);
  const isText = lower.endsWith(".txt") || file.type === "text/plain";
  const isImage = /^image\//i.test(file.type);

  if (isZip) {
    const buf = await file.arrayBuffer();
    const imported = await importWhatsAppExport(buf, {
      isZip: true,
      myName,
      originalFilename: name,
    });
    return imported.renderedChat;
  }

  if (isText) {
    const text = await file.text();
    if (/^\[?\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}.*\]?\s/m.test(text)) {
      const buf = new TextEncoder().encode(text);
      const imported = await importWhatsAppExport(buf.buffer as ArrayBuffer, {
        isZip: false,
        myName,
        originalFilename: name,
      });
      return imported.renderedChat;
    }
    return text;
  }

  if (isAudio) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const mt = file.type || "audio/ogg";
    const { transcript } = await transcribeAudio(buf, mt);
    return `[🎤 הודעה קולית]\n${transcript}`;
  }

  if (isImage) {
    return `[📷 תמונה: ${name}]`;
  }

  return `[קובץ לא נתמך: ${name}]`;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expected = process.env.CAPTURE_SHARE_TOKEN;
  if (!expected) {
    return err("CAPTURE_SHARE_TOKEN not configured on server", 500);
  }
  if (!token || token !== expected) {
    return err("Unauthorized", 401);
  }

  const myName = (await getSetting("whatsapp_display_name")) ?? "Me";

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err("Invalid multipart form data", 400);
  }

  const files: File[] = [];
  for (const v of form.values()) {
    if (v instanceof File && v.size > 0) files.push(v);
  }
  const directText = form.get("text");

  if (files.length === 0 && (typeof directText !== "string" || !directText.trim())) {
    return err("No files or text in upload", 400);
  }

  const parts: string[] = [];
  for (const f of files) {
    try {
      const out = await processFile(f, myName);
      if (out.trim()) parts.push(out.trim());
    } catch (e) {
      console.error("[capture/upload] processFile failed", f.name, e);
      parts.push(`[שגיאה בעיבוד ${f.name}]`);
    }
  }
  if (typeof directText === "string" && directText.trim()) {
    parts.unshift(directText.trim());
  }

  const combined = parts.join("\n\n");

  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const target = new URL(`${proto}://${host}/`);
  target.searchParams.set("capture", combined);
  const finalUrl = target.toString();

  if (finalUrl.length > 16000) {
    return err(
      "השיחה ארוכה מדי לשיתוף ישיר (>16KB). שתף בחירה קטנה יותר של הודעות.",
      413
    );
  }

  return new NextResponse(finalUrl, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
