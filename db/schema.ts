import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  pgEnum,
  index,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

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
    nextFollowupAt: timestamp({ withTimezone: true }),
    followupCompletedAt: timestamp({ withTimezone: true }),
    priority: priorityEnum().notNull().default("warm"),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leads_phone_idx").on(t.phone),
    index("leads_status_idx").on(t.status),
    index("leads_next_followup_idx").on(t.nextFollowupAt),
    index("leads_priority_idx").on(t.priority),
    index("leads_created_idx").on(t.createdAt),
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

export const productKb = pgTable("product_kb", {
  id: uuid().primaryKey().defaultRandom(),
  category: kbCategoryEnum().notNull(),
  language: languageEnum().notNull().default("he"),
  title: text().notNull(),
  content: text().notNull(),
  active: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

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
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;

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
