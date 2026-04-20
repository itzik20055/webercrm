import { embed, embedMany } from "ai";

/**
 * Embedding model — `text-embedding-3-small` is multilingual (handles Hebrew /
 * Yiddish well), 1536 dimensions, ~5x cheaper than `-large`. Routed through
 * Vercel AI Gateway so we benefit from ZDR + observability.
 */
export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

function ensureGatewayKey() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "AI_GATEWAY_API_KEY is not set. Embeddings unavailable."
    );
  }
}

/**
 * Truncate to a safe token budget. text-embedding-3-small handles up to 8191
 * tokens, but our content is short — cap at ~6000 chars to keep latency tight
 * and avoid edge cases with extremely long inputs.
 */
function prepare(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 6000);
}

export async function embedOne(text: string): Promise<number[]> {
  ensureGatewayKey();
  const { embedding } = await embed({
    model: EMBEDDING_MODEL,
    value: prepare(text),
  });
  return embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  ensureGatewayKey();
  const { embeddings } = await embedMany({
    model: EMBEDDING_MODEL,
    values: texts.map(prepare),
  });
  return embeddings;
}
