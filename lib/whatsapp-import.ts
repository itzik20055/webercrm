import JSZip from "jszip";
import { parseChat, renderChatForAI, inferLeadName, type ParsedChat } from "./whatsapp-parser";
import { transcribeAudio } from "./ai-client";
import { extractPhones, normalizePhone } from "./phone";

export interface ImportResult {
  chat: ParsedChat;
  /** filename → transcript */
  transcripts: Record<string, string>;
  renderedChat: string;
  inferredLeadName: string | null;
  /** Phone numbers detected in chat content, filenames, or sender names. */
  inferredPhones: string[];
  audioStats: { total: number; transcribed: number; skipped: number };
}

const AUDIO_EXT = /\.(opus|m4a|mp3|ogg|wav|aac)$/i;

function mediaTypeFor(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".opus") || lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a") || lower.endsWith(".aac")) return "audio/mp4";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  return "audio/ogg";
}

/**
 * Reads a WhatsApp export. Accepts either:
 *  - a ZIP file (with _chat.txt and media), or
 *  - a plain .txt chat file (no media — transcripts will be skipped).
 */
export async function importWhatsAppExport(
  file: ArrayBuffer | Uint8Array,
  opts: {
    isZip: boolean;
    myName: string;
    /**
     * Original uploaded filename. Critical: WhatsApp puts the contact's
     * phone in the outer ZIP filename ("WhatsApp Chat - +972 54-276-6496.zip"),
     * but the entries inside are flat ("_chat.txt", audio files). Without
     * this we lose the most reliable phone source.
     */
    originalFilename?: string;
    /** Optional language hint for the transcriber. */
    language?: "he" | "en" | "yi";
  }
): Promise<ImportResult> {
  let chatRaw = "";
  const audioFiles: { name: string; data: Uint8Array }[] = [];
  const filenameHints: string[] = [];
  if (opts.originalFilename) filenameHints.push(opts.originalFilename);

  if (opts.isZip) {
    const zip = await JSZip.loadAsync(file);
    // Filenames in WhatsApp exports often contain the contact's phone number,
    // e.g. "WhatsApp Chat - +972 50 1234567/_chat.txt"
    for (const name of Object.keys(zip.files)) {
      filenameHints.push(name);
    }
    // Find the chat text file (usually _chat.txt, sometimes WhatsApp Chat.txt)
    let chatEntry: JSZip.JSZipObject | null = null;
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      if (/_chat\.txt$|whatsapp[\s_-]*chat.*\.txt$|chat\.txt$/i.test(name)) {
        chatEntry = entry;
        break;
      }
    }
    if (!chatEntry) {
      // Last resort — first .txt
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        if (name.toLowerCase().endsWith(".txt")) {
          chatEntry = entry;
          break;
        }
      }
    }
    if (!chatEntry) {
      throw new Error(
        "לא נמצא קובץ צ'אט בתוך ה-ZIP. ודא שייצאת מוואטסאפ עם 'ייצוא צ'אט'."
      );
    }
    chatRaw = await chatEntry.async("string");

    // Collect audio files
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const baseName = name.split("/").pop() ?? name;
      if (AUDIO_EXT.test(baseName)) {
        const data = await entry.async("uint8array");
        audioFiles.push({ name: baseName, data });
      }
    }
  } else {
    chatRaw = new TextDecoder("utf-8").decode(file as Uint8Array);
  }

  const chat = parseChat(chatRaw);
  const inferredLeadName = inferLeadName(chat, opts.myName);

  // Collect phone candidates from: filenames, sender names that look like phones,
  // and the first ~50 messages (in case lead introduced themselves with a number)
  const phoneSources = [
    ...filenameHints,
    ...chat.participants.filter((p) => p !== opts.myName),
    ...chat.messages.slice(0, 50).map((m) => m.text),
  ].join(" ");
  const inferredPhones = extractPhones(phoneSources)
    .map(normalizePhone)
    .filter((p, i, arr) => arr.indexOf(p) === i);

  // Build a quick lookup of which audio files are actually referenced by the chat
  const referenced = new Set<string>();
  for (const m of chat.messages) {
    if (m.attachment?.kind === "audio") referenced.add(m.attachment.filename);
  }

  // Transcribe each referenced audio file (in parallel, with a small concurrency cap)
  const transcripts: Record<string, string> = {};
  const audioByName = new Map(audioFiles.map((a) => [a.name, a]));
  const toTranscribe = [...referenced].filter((n) => audioByName.has(n));
  let skipped = referenced.size - toTranscribe.length;

  const CONCURRENCY = 3;
  let cursor = 0;
  async function worker() {
    while (cursor < toTranscribe.length) {
      const idx = cursor++;
      const name = toTranscribe[idx];
      const file = audioByName.get(name)!;
      try {
        const { transcript } = await transcribeAudio(
          file.data,
          mediaTypeFor(name),
          { language: opts.language }
        );
        transcripts[name] = transcript;
      } catch (e) {
        console.error("Transcription failed for", name, e);
        skipped++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const renderedChat = renderChatForAI(chat, {
    myName: opts.myName,
    transcripts,
  });

  return {
    chat,
    transcripts,
    renderedChat,
    inferredLeadName,
    inferredPhones,
    audioStats: {
      total: referenced.size,
      transcribed: Object.keys(transcripts).length,
      skipped,
    },
  };
}
