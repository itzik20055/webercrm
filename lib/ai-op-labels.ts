/**
 * Human-readable labels for values of `aiAuditLog.operation`. The operation
 * column is a raw snake_case string written by `lib/ai-client.ts` and callers;
 * exposing those strings in the UI leaks internal identifiers to the user.
 *
 * `labelOperation` handles three shapes:
 *   - fixed names (e.g. `transcribe`, `extract_lead_from_chat`)
 *   - `draft_reply:<scenario>` dynamic prefix from `ai-client.ts:1275`
 *   - `chat:<kind>` dynamic prefix from `api/ai/chat/route.ts`
 * Unknown values fall through to the raw string.
 */

const OP_LABEL: Record<string, string> = {
  transcribe: "תמלול שיחה",
  extract: "חילוץ ליד",
  extract_lead_from_chat: "חילוץ ליד מצ'אט",
  extract_lead_from_whatsapp: "חילוץ ליד מוואטסאפ",
  extract_lead_from_email: "חילוץ ליד ממייל",
  draft: "ניסוח טיוטה",
  chat: "צ'אט",
  chat_general: "צ'אט כללי",
  chat_lead: "צ'אט על ליד",
  learning: "למידה לילית",
  embed: "אינדוקס",
  reprocess_lead_profile: "עדכון פרופיל ליד",
  answer_customer_qa: "מענה לשאלת לקוח",
};

const DRAFT_SCENARIO_LABELS: Record<string, string> = {
  first_reply: "מענה ראשון",
  send_price: "שליחת מחיר",
  price_objection: "התנגדות מחיר",
  silent_followup: "פולואפ שקט",
  date_confirmation: "אישור תאריך",
  closing_request: "בקשת סגירה",
  general: "כללי",
};

export function labelOperation(op: string): string {
  if (OP_LABEL[op]) return OP_LABEL[op];
  if (op.startsWith("draft_reply:")) {
    const scenario = op.slice("draft_reply:".length);
    const label = DRAFT_SCENARIO_LABELS[scenario] ?? scenario;
    return `טיוטת תשובה · ${label}`;
  }
  if (op.startsWith("chat:")) {
    const kind = op.slice("chat:".length);
    if (kind === "lead") return "צ'אט על ליד";
    if (kind === "general") return "צ'אט כללי";
    return `צ'אט · ${kind}`;
  }
  return op;
}
