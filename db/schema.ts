import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  boolean,
  jsonb,
  vector,
  customType,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const languageEnum = pgEnum("language", ["he", "en", "yi"]);
export const audienceEnum = pgEnum("audience", [
  "israeli_haredi",
  "american_haredi",
  "european_haredi",
]);
export const channelEnum = pgEnum("channel", [
  "call",
  "whatsapp",
  "email",
  "referral",
  "other",
]);
export const statusEnum = pgEnum("lead_status", [
  "new",
  "contacted",
  "interested",
  "quoted",
  "closing",
  "booked",
  "lost",
]);
export const priorityEnum = pgEnum("priority", ["hot", "warm", "cold"]);
export const buildingEnum = pgEnum("building", ["a", "b", "any"]);
export const budgetEnum = pgEnum("budget_signal", ["low", "mid", "high"]);
export const interactionTypeEnum = pgEnum("interaction_type", [
  "call_in",
  "call_out",
  "whatsapp",
  "email",
  "sms",
  "note",
]);
export const interactionDirectionEnum = pgEnum("interaction_direction", [
  "in",
  "out",
  "internal",
]);
export const kbCategoryEnum = pgEnum("kb_category", [
  "hotel",
  "rooms",
  "food",
  "activities",
  "prices",
  "logistics",
  "faq",
]);

export const draftScenarioEnum = pgEnum("draft_scenario", [
  "first_reply",
  "send_price",
  "price_objection",
  "silent_followup",
  "date_confirmation",
  "closing_request",
  "general",
]);

export const leads = pgTable(
  "leads",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    phone: text().notNull(),
    email: text(),
    language: languageEnum().notNull().default("he"),
    audience: audienceEnum().notNull().default("israeli_haredi"),
    channelFirst: channelEnum().notNull().default("whatsapp"),
    status: statusEnum().notNull().default("new"),
    lostReason: text(),
    source: text(),
    numAdults: integer(),
    numChildren: integer(),
    agesChildren: text(),
    datesInterest: text(),
    roomTypeInterest: text(),
    buildingPref: buildingEnum(),
    budgetSignal: budgetEnum(),
    interestTags: text().array().notNull().default(sql`'{}'::text[]`),
    whatSpokeToThem: text(),
    objections: text(),
    /** Free text — hotels the lead stayed at in previous years. */
    previousStays: text(),
    nextFollowupAt: timestamp({ withTimezone: true }),
    followupCompletedAt: timestamp({ withTimezone: true }),
    priority: priorityEnum().notNull().default("warm"),
    notes: text(),
    needsReview: boolean().notNull().default(false),
    pendingExtraction: jsonb(),
    /**
     * Snapshot of mutable lead fields taken right before the last AI reprocess,
     * so the user can hit "Undo" within a short window if the AI's edits were
     * worse than what we had. Cleared after the undo window passes (or on undo).
     */
    lastReprocessSnapshot: jsonb(),
    lastReprocessedAt: timestamp({ withTimezone: true }),
    /**
     * AI's proposal for what to do with the open followup after a reprocess.
     * Stored separately from field updates because moving a followup is easy
     * to miss — the user must explicitly approve. Shape:
     *   { action: "reschedule", dueAt: ISO, reason?: string }
     *   { action: "cancel", reason?: string }
     */
    pendingFollowupSuggestion: jsonb(),
    /**
     * AI's proposal for changing priority. Priority is stored separately from
     * other field updates because the operator may have manually pinned a lead
     * as "cold" and the AI shouldn't silently flip it back to "hot". Shape:
     *   { from: "hot" | "warm" | "cold", to: "hot" | "warm" | "cold" }
     */
    pendingPrioritySuggestion: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leads_phone_idx").on(t.phone),
    index("leads_status_idx").on(t.status),
    index("leads_next_followup_idx").on(t.nextFollowupAt),
    index("leads_priority_idx").on(t.priority),
    index("leads_created_idx").on(t.createdAt),
    index("leads_needs_review_idx").on(t.needsReview),
  ]
);

export const interactions = pgTable(
  "interactions",
  {
    id: uuid().primaryKey().defaultRandom(),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: interactionTypeEnum().notNull(),
    direction: interactionDirectionEnum().notNull().default("in"),
    content: text().notNull(),
    aiSummary: text(),
    aiTags: text().array(),
    durationMin: integer(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("interactions_lead_idx").on(t.leadId),
    index("interactions_occurred_idx").on(t.occurredAt),
  ]
);

export const followups = pgTable(
  "followups",
  {
    id: uuid().primaryKey().defaultRandom(),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    dueAt: timestamp({ withTimezone: true }).notNull(),
    reason: text(),
    reminderSentAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("followups_due_idx").on(t.dueAt),
    index("followups_lead_idx").on(t.leadId),
    index("followups_completed_idx").on(t.completedAt),
  ]
);

export const productKb = pgTable(
  "product_kb",
  {
    id: uuid().primaryKey().defaultRandom(),
    category: kbCategoryEnum().notNull(),
    language: languageEnum().notNull().default("he"),
    title: text().notNull(),
    content: text().notNull(),
    active: boolean().notNull().default(true),
    embedding: vector({ dimensions: 1536 }),
    embeddedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("product_kb_embedding_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops")),
  ]
);

export const voiceExamples = pgTable(
  "voice_examples",
  {
    id: uuid().primaryKey().defaultRandom(),
    leadId: uuid().references(() => leads.id, { onDelete: "set null" }),
    scenario: draftScenarioEnum().notNull(),
    language: languageEnum().notNull(),
    audience: audienceEnum().notNull(),
    aiDraft: text().notNull(),
    finalText: text().notNull(),
    contextSnapshot: jsonb(),
    embedding: vector({ dimensions: 1536 }),
    embeddedAt: timestamp({ withTimezone: true }),
    /**
     * "manual" — איציק אישר טיוטה דרך הצ'אט/הטופס.
     * "auto_outcome" — נוצר אוטומטית ע״י קרון הלמידה מתוך שיחה אמיתית.
     */
    source: text().notNull().default("manual"),
    /**
     * Score in range [-1, +1]. Positive = effective message (preceded warming
     * or won lead); negative = ineffective (preceded cooling or genuine loss).
     * 0 = neutral / unknown. Manual examples default to 0.5.
     */
    score: real().notNull().default(0.5),
    /**
     * Finer-grained tag than the enum scenario, free-text from the learning
     * cron (e.g. "kashrut_question", "price_anchor", "date_negotiation").
     * Used for richer scenario matching during retrieval.
     */
    scenarioTag: text(),
    /**
     * Raw signals from the learning cron — { warmedAfter, cooledAfter,
     * becameBooked, becameLost, lostReason, daysToOutcome }. Kept for
     * inspection/debugging and re-scoring without re-mining.
     */
    outcomeSignals: jsonb(),
    /**
     * Hash of (leadId + original message content) — used by the learning cron
     * to dedupe re-runs. NULL for manual examples.
     */
    messageHash: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("voice_examples_match_idx").on(t.audience, t.scenario, t.language),
    index("voice_examples_created_idx").on(t.createdAt),
    index("voice_examples_score_idx").on(t.score),
    uniqueIndex("voice_examples_message_hash_idx")
      .on(t.messageHash)
      .where(sql`${t.messageHash} is not null`),
    index("voice_examples_embedding_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops")),
  ]
);

export const responseTemplates = pgTable("response_templates", {
  id: uuid().primaryKey().defaultRandom(),
  language: languageEnum().notNull().default("he"),
  scenario: text().notNull(),
  title: text().notNull(),
  content: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid().primaryKey().defaultRandom(),
  endpoint: text().notNull().unique(),
  p256dh: text().notNull(),
  auth: text().notNull(),
  userAgent: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const pendingCallRecordingStatusEnum = pgEnum(
  "pending_call_recording_status",
  ["pending", "approved", "merged", "dismissed"]
);

/**
 * Inbox staging area for incoming phone-call recordings. Every transcribed
 * recording lands here first; the user reviews the AI's extraction and
 * chooses to create a brand-new lead, merge into an existing one, or dismiss.
 * Auto-creating leads from raw call data turned out noisy (FreeTelecom
 * delivers spam calls too) — this gates everything behind a one-tap approval.
 */
export const pendingCallRecordings = pgTable(
  "pending_call_recordings",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** customer-side phone number (normalized) */
    customerPhone: text().notNull(),
    /** "in" if call was inbound to us, "out" if we called them */
    direction: interactionDirectionEnum().notNull(),
    /** original IMAP message subject (for debugging) */
    mailSubject: text().notNull(),
    /** the call's actual timestamp (Date header on the email) */
    callAt: timestamp({ withTimezone: true }).notNull(),
    transcript: text(),
    transcriptionError: text(),
    /** AI-extracted lead profile + suggested followup (ExtractedLead shape) */
    extraction: jsonb(),
    /** lead IDs that match this customer phone — UI offers them as merge targets */
    matchCandidateIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    status: pendingCallRecordingStatusEnum().notNull().default("pending"),
    /** if user picked merge, the target lead */
    resolvedLeadId: uuid().references(() => leads.id, { onDelete: "set null" }),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pending_call_recordings_status_idx").on(t.status),
    index("pending_call_recordings_created_idx").on(t.createdAt),
    index("pending_call_recordings_phone_idx").on(t.customerPhone),
  ]
);

export const pendingWhatsAppImportStatusEnum = pgEnum(
  "pending_whatsapp_import_status",
  ["pending", "processing", "done", "failed", "merged", "dismissed"]
);

/**
 * Inbox staging area for user-uploaded WhatsApp chat exports. Upload handler
 * writes the raw ZIP here and returns immediately; a worker (triggered fire-
 * and-forget from the handler, plus a cron safety net) claims rows via
 * SKIP LOCKED, transcribes audio, extracts the lead, and moves the row to
 * `done` for review. `content_hash` is UNIQUE so accidental double-uploads of
 * the same export collapse to one job — no repeat AI/transcription spend.
 *
 * `failed` is terminal: we never auto-retry. The user decides from the inbox
 * whether to delete and try again — mechanical retries could burn tokens on
 * a malformed file or a transient gateway error we can't diagnose.
 */
export const pendingWhatsAppImports = pgTable(
  "pending_whatsapp_imports",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** SHA-256 of the uploaded file bytes — idempotency key. */
    contentHash: text().notNull(),
    originalFilename: text().notNull(),
    /** Raw upload bytes. Cleared (set to empty) once processing succeeds to save space. */
    fileBytes: bytea().notNull(),
    /** true when the upload is a .zip (else .txt, no audio). */
    isZip: boolean().notNull(),
    language: languageEnum(),
    status: pendingWhatsAppImportStatusEnum().notNull().default("pending"),
    /** When the worker claimed the row. Reset only on terminal transition. */
    processingStartedAt: timestamp({ withTimezone: true }),
    processedAt: timestamp({ withTimezone: true }),
    /** Populated when status transitions to `failed`. */
    error: text(),
    /** Populated on `done`: lead name we detected in the chat. */
    inferredLeadName: text(),
    inferredPhones: text().array().notNull().default(sql`'{}'::text[]`),
    /** Populated on `done`: full chat text sent to the AI (for preview/debug). */
    renderedChat: text(),
    /** Populated on `done`: AI-extracted lead profile (ExtractedLead shape). */
    extraction: jsonb(),
    /** { total, transcribed, skipped } */
    audioStats: jsonb(),
    messageCount: integer(),
    firstMessageAt: timestamp({ withTimezone: true }),
    lastMessageAt: timestamp({ withTimezone: true }),
    /** Lead IDs that match inferred name/phone — UI offers them as merge targets. */
    matchCandidateIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    /** If user picked merge/approve, the resulting/target lead. */
    resolvedLeadId: uuid().references(() => leads.id, { onDelete: "set null" }),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pending_wa_imports_hash_idx").on(t.contentHash),
    index("pending_wa_imports_status_idx").on(t.status),
    index("pending_wa_imports_created_idx").on(t.createdAt),
  ]
);

export const appSettings = pgTable("app_settings", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const aiAuditLog = pgTable(
  "ai_audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    operation: text().notNull(),
    model: text(),
    inputAnonymized: text().notNull(),
    output: text(),
    placeholderMap: jsonb(),
    leadId: uuid().references(() => leads.id, { onDelete: "set null" }),
    durationMs: integer(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_audit_created_idx").on(t.createdAt)]
);

export const leadsRelations = relations(leads, ({ many }) => ({
  interactions: many(interactions),
  followups: many(followups),
}));

export const interactionsRelations = relations(interactions, ({ one }) => ({
  lead: one(leads, {
    fields: [interactions.leadId],
    references: [leads.id],
  }),
}));

export const followupsRelations = relations(followups, ({ one }) => ({
  lead: one(leads, {
    fields: [followups.leadId],
    references: [leads.id],
  }),
}));

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Interaction = typeof interactions.$inferSelect;
export type NewInteraction = typeof interactions.$inferInsert;
export type Followup = typeof followups.$inferSelect;
export type NewFollowup = typeof followups.$inferInsert;
export type ProductKb = typeof productKb.$inferSelect;
export type ResponseTemplate = typeof responseTemplates.$inferSelect;
export type VoiceExample = typeof voiceExamples.$inferSelect;
export type NewVoiceExample = typeof voiceExamples.$inferInsert;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type PendingCallRecording = typeof pendingCallRecordings.$inferSelect;
export type NewPendingCallRecording = typeof pendingCallRecordings.$inferInsert;
export type PendingWhatsAppImport = typeof pendingWhatsAppImports.$inferSelect;
export type NewPendingWhatsAppImport = typeof pendingWhatsAppImports.$inferInsert;

export const LANGUAGE_LABELS: Record<Lead["language"], string> = {
  he: "עברית",
  en: "אנגלית",
  yi: "אידיש",
};

export const AUDIENCE_LABELS: Record<Lead["audience"], string> = {
  israeli_haredi: "חרדי ישראלי",
  american_haredi: "חרדי אמריקאי",
  european_haredi: "חרדי אירופאי",
};

export const CHANNEL_LABELS: Record<Lead["channelFirst"], string> = {
  call: "טלפון",
  whatsapp: "וואטסאפ",
  email: "מייל",
  referral: "המלצה",
  other: "אחר",
};

export const STATUS_LABELS: Record<Lead["status"], string> = {
  new: "חדש",
  contacted: "בקשר",
  interested: "מתעניין",
  quoted: "ניתן הצעה",
  closing: "בסגירה",
  booked: "נסגר",
  lost: "אבד",
};

export const PRIORITY_LABELS: Record<Lead["priority"], string> = {
  hot: "חם",
  warm: "פושר",
  cold: "קר",
};

export const INTEREST_TAG_LABELS: Record<string, string> = {
  hotel: "מלון",
  food: "אוכל",
  trips: "טיולים",
  spa: "ספא",
  pool: "בריכה",
  minyan: "מניין",
  kids: "ילדים",
  shabbat: "שבת",
  flights: "טיסות",
  views: "נוף",
};

export const INTERACTION_TYPE_LABELS: Record<Interaction["type"], string> = {
  call_in: "שיחה נכנסת",
  call_out: "שיחה יוצאת",
  whatsapp: "וואטסאפ",
  email: "מייל",
  sms: "SMS",
  note: "הערה",
};

export const DRAFT_SCENARIO_LABELS: Record<VoiceExample["scenario"], string> = {
  first_reply: "תשובה ראשונה",
  send_price: "שליחת מחיר",
  price_objection: "התנגדות מחיר",
  silent_followup: "פולואפ לליד שותק",
  date_confirmation: "אישור תאריכים",
  closing_request: "בקשת סגירה",
  general: "כללי",
};
