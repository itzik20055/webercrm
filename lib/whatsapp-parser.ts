/**
 * WhatsApp chat export parser.
 *
 * Handles iOS and Android export formats. Examples:
 *
 * iOS:    [19/04/2026, 15:32:11] אהרון כהן: שלום
 * iOS:    [19/04/2026, 15:33:42] אהרון כהן: ‎<attached: 00023-AUDIO-...opus>
 * iOS:    [19/04/2026, 15:33:42] אהרון כהן: ‎audio omitted
 * Android: 19/04/2026, 15:32 - אהרון כהן: שלום
 * Android: 19/04/2026, 15:33 - אהרון כהן: <Media omitted>
 * Android: 19/04/2026, 15:33 - אהרון כהן: WhatsApp Audio file (file attached)
 */

export interface WhatsAppMessage {
  timestamp: Date;
  sender: string;
  text: string;
  attachment?: {
    filename: string;
    kind: "audio" | "image" | "video" | "document" | "unknown";
  };
  /** True when WhatsApp inserted "media omitted" / "audio omitted" — file is missing. */
  mediaOmitted?: "audio" | "image" | "video" | "document";
}

export interface ParsedChat {
  messages: WhatsAppMessage[];
  participants: string[];
  format: "ios" | "android";
}

const ZERO_WIDTH = /[\u200E\u200F\u202A-\u202E]/g;

const IOS_LINE = /^\[(\d{1,2})[./](\d{1,2})[./](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\]\s+(.+?):\s?(.*)$/i;
const ANDROID_LINE = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\s+-\s+(.+?):\s(.*)$/i;

const IOS_ATTACHMENT = /<attached:\s*([^>]+)>/i;
const ANDROID_ATTACHMENT_LINE = /^(.+?)\s+\(file attached\)$/i;
const MEDIA_OMITTED = /^(?:‎)?(audio|image|video|sticker|gif|document)\s+omitted$/i;
const ANDROID_MEDIA_OMITTED = /^<Media omitted>$/i;

function detectKind(filename: string): WhatsAppMessage["attachment"] extends infer A
  ? A extends { kind: infer K }
    ? K
    : never
  : never {
  const lower = filename.toLowerCase();
  if (/\.(opus|m4a|mp3|ogg|wav|aac)$/i.test(lower)) return "audio";
  if (/\.(jpg|jpeg|png|webp|heic|heif|gif)$/i.test(lower)) return "image";
  if (/\.(mp4|mov|3gp|webm|avi)$/i.test(lower)) return "video";
  if (/\.(pdf|docx?|xlsx?|pptx?|txt)$/i.test(lower)) return "document";
  // WhatsApp filename hints
  if (/-AUDIO-|PTT-/i.test(lower)) return "audio";
  if (/-PHOTO-|-IMAGE-|IMG-/i.test(lower)) return "image";
  if (/-VIDEO-|VID-/i.test(lower)) return "video";
  return "unknown";
}

function omittedKind(label: string): WhatsAppMessage["mediaOmitted"] {
  const k = label.toLowerCase();
  if (k === "audio") return "audio";
  if (k === "image" || k === "sticker" || k === "gif") return "image";
  if (k === "video") return "video";
  if (k === "document") return "document";
  return undefined;
}

function buildDate(
  d: string,
  m: string,
  y: string,
  h: string,
  min: string,
  s: string | undefined,
  ampm: string | undefined
): Date {
  let day = parseInt(d, 10);
  let month = parseInt(m, 10);
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;
  // WhatsApp exports use the device's locale order. We assume DD/MM (most common
  // outside the US). If the supposed "day" is > 12 and "month" <= 12, the order
  // is DD/MM. If supposed "month" > 12, swap. Otherwise keep DD/MM.
  if (month > 12 && day <= 12) {
    [day, month] = [month, day];
  }
  let hour = parseInt(h, 10);
  const minute = parseInt(min, 10);
  const second = s ? parseInt(s, 10) : 0;
  if (ampm) {
    const isPm = ampm.toLowerCase() === "pm";
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  }
  return new Date(year, month - 1, day, hour, minute, second);
}

function classifyContent(rawContent: string): {
  text: string;
  attachment?: WhatsAppMessage["attachment"];
  mediaOmitted?: WhatsAppMessage["mediaOmitted"];
} {
  const content = rawContent.replace(ZERO_WIDTH, "").trim();

  const iosAtt = content.match(IOS_ATTACHMENT);
  if (iosAtt) {
    const filename = iosAtt[1].trim();
    return {
      text: "",
      attachment: { filename, kind: detectKind(filename) },
    };
  }

  const androidAtt = content.match(ANDROID_ATTACHMENT_LINE);
  if (androidAtt) {
    const filename = androidAtt[1].trim();
    return {
      text: "",
      attachment: { filename, kind: detectKind(filename) },
    };
  }

  const omitted = content.match(MEDIA_OMITTED);
  if (omitted) {
    return { text: "", mediaOmitted: omittedKind(omitted[1]) };
  }
  if (ANDROID_MEDIA_OMITTED.test(content)) {
    return { text: "", mediaOmitted: "audio" /* unknown — treat conservatively */ };
  }

  return { text: content };
}

export function parseChat(raw: string): ParsedChat {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const messages: WhatsAppMessage[] = [];
  const participants = new Set<string>();
  let format: ParsedChat["format"] = "ios";

  let current: WhatsAppMessage | null = null;

  for (const lineRaw of lines) {
    const line = lineRaw.replace(ZERO_WIDTH, "");
    if (!line.trim()) continue;

    const ios = line.match(IOS_LINE);
    const android = !ios ? line.match(ANDROID_LINE) : null;

    if (ios || android) {
      if (current) messages.push(current);
      const m = ios ?? android!;
      if (android) format = "android";
      const date = buildDate(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
      const sender = m[8].trim();
      const content = m[9] ?? "";
      participants.add(sender);
      const cls = classifyContent(content);
      current = {
        timestamp: date,
        sender,
        text: cls.text,
        ...(cls.attachment ? { attachment: cls.attachment } : {}),
        ...(cls.mediaOmitted ? { mediaOmitted: cls.mediaOmitted } : {}),
      };
    } else if (current) {
      // Continuation of a multi-line message
      current.text = current.text ? `${current.text}\n${line.trim()}` : line.trim();
    }
    // else: header lines like "Messages and calls are end-to-end encrypted." — drop
  }

  if (current) messages.push(current);

  return {
    messages,
    participants: [...participants],
    format,
  };
}

export interface RenderOptions {
  /** Display name of the user (so we can label "Me" vs lead). */
  myName: string;
  /** Map of attachment filename → transcript (for audio). */
  transcripts?: Record<string, string>;
}

/**
 * Renders a parsed chat as a single text block, ready for AI extraction.
 * Audio messages are inlined as `[🎤 Voice message: <transcript>]`.
 */
export function renderChatForAI(chat: ParsedChat, opts: RenderOptions): string {
  const lines: string[] = [];
  for (const m of chat.messages) {
    const role = m.sender === opts.myName ? "Me" : m.sender;
    const ts = m.timestamp.toISOString().replace("T", " ").slice(0, 16);
    let body = m.text;
    if (m.attachment) {
      if (m.attachment.kind === "audio") {
        const transcript = opts.transcripts?.[m.attachment.filename];
        body = transcript
          ? `[🎤 Voice: "${transcript}"]`
          : `[🎤 Voice message — not transcribed]`;
      } else if (m.attachment.kind === "image") {
        body = `[📷 Image attached]`;
      } else if (m.attachment.kind === "video") {
        body = `[🎥 Video attached]`;
      } else {
        body = `[📎 ${m.attachment.filename}]`;
      }
    } else if (m.mediaOmitted) {
      body = `[${m.mediaOmitted} omitted from export]`;
    }
    lines.push(`[${ts}] ${role}: ${body}`);
  }
  return lines.join("\n");
}

/**
 * Renders a parsed chat for the archive learning pipeline. Differs from
 * `renderChatForAI` in two ways:
 *
 *   1. Absolute timestamps are replaced with relative day numbers
 *      (`[יום 1, 09:42]`) so the LLM sees how much time passed between
 *      messages without learning specific calendar dates that expire
 *      year-over-year.
 *
 *   2. Silence gaps longer than 12 hours get an explicit annotation
 *      (`-- אחרי N ימי שתיקה --`) on their own line so the cadence signal
 *      survives even if the time-of-day gets scrubbed downstream by the
 *      archive scrubber.
 *
 * The HH:MM time-of-day is preserved here; if the scrubber chooses to remove
 * it, the relative day number still carries the cadence information.
 */
export function renderChatForArchive(chat: ParsedChat, opts: RenderOptions): string {
  const lines: string[] = [];
  if (chat.messages.length === 0) return "";

  const startMs = chat.messages[0].timestamp.getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const silenceThresholdMs = 12 * 60 * 60 * 1000;

  let prevTs: Date | null = null;

  for (const m of chat.messages) {
    if (prevTs) {
      const gapMs = m.timestamp.getTime() - prevTs.getTime();
      if (gapMs >= silenceThresholdMs) {
        const gapDays = Math.round(gapMs / oneDayMs);
        const label =
          gapDays === 0
            ? "אחרי שתיקה של חצי יום"
            : gapDays === 1
              ? "אחרי יום שתיקה"
              : `אחרי ${gapDays} ימי שתיקה`;
        lines.push(`-- ${label} --`);
      }
    }

    const dayN = Math.floor((m.timestamp.getTime() - startMs) / oneDayMs) + 1;
    const role = m.sender === opts.myName ? "Me" : m.sender;
    const hh = String(m.timestamp.getUTCHours()).padStart(2, "0");
    const mm = String(m.timestamp.getUTCMinutes()).padStart(2, "0");

    let body = m.text;
    if (m.attachment) {
      if (m.attachment.kind === "audio") {
        const transcript = opts.transcripts?.[m.attachment.filename];
        body = transcript
          ? `[🎤 Voice: "${transcript}"]`
          : `[🎤 Voice message — not transcribed]`;
      } else if (m.attachment.kind === "image") {
        body = `[📷 Image attached]`;
      } else if (m.attachment.kind === "video") {
        body = `[🎥 Video attached]`;
      } else {
        body = `[📎 ${m.attachment.filename}]`;
      }
    } else if (m.mediaOmitted) {
      body = `[${m.mediaOmitted} omitted from export]`;
    }
    lines.push(`[יום ${dayN}, ${hh}:${mm}] ${role}: ${body}`);
    prevTs = m.timestamp;
  }
  return lines.join("\n");
}

/** Returns the lead's name = the participant that is NOT the user. */
export function inferLeadName(chat: ParsedChat, myName: string): string | null {
  const others = chat.participants.filter((p) => p !== myName);
  if (others.length === 1) return others[0];
  // Pick the participant with the most messages other than us
  const counts = new Map<string, number>();
  for (const m of chat.messages) {
    if (m.sender === myName) continue;
    counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}
