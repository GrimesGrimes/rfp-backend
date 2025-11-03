// src/lib/embedding.ts — usa OpenRouter /embeddings con un modelo gratuito (nomic-ai)
const BASE = process.env.OPENROUTER_BASE || "https://openrouter.ai/api/v1";
const KEY = process.env.OPENROUTER_API_KEY!;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-ai/nomic-embed-text-v1.5";

function headers() {
  const h: Record<string, string> = {
    "Authorization": `Bearer ${KEY}`,
    "Content-Type": "application/json",
  };
  if (process.env.APP_PUBLIC_URL) h["HTTP-Referer"] = process.env.APP_PUBLIC_URL;
  if (process.env.APP_TITLE) h["X-Title"] = process.env.APP_TITLE;
  return h;
}

function ensureArray<T>(x: T | T[]): T[] {
  return Array.isArray(x) ? x : [x];
}

async function readJSONOrThrow(resp: Response, ctx: string) {
  const ct = resp.headers.get("content-type") || "";
  const raw = await resp.text();
  if (!ct.includes("application/json")) {
    throw new Error(`[embed:${ctx}] Non-JSON response (status ${resp.status}): ${raw.slice(0, 300)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`[embed:${ctx}] JSON parse failed (status ${resp.status}): ${raw.slice(0, 300)}`);
  }
}

export function chunkText(text: string, chunkSize = 800, overlap = 120): string[] {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + chunkSize, clean.length);
    let slice = clean.slice(i, end);
    // intenta cortar en límite de oración
    const lastDot = slice.lastIndexOf(". ");
    if (lastDot > 200 && end < clean.length) {
      slice = slice.slice(0, lastDot + 1);
      i += lastDot + 1 - overlap;
    } else {
      i += chunkSize - overlap;
    }
    if (slice.trim()) chunks.push(slice.trim());
  }
  return chunks;
}

// Reemplaza SOLAMENTE esta función en src/lib/embedding.ts
// Reemplaza SOLAMENTE esta función
export async function embedText(
  input: string | string[]
): Promise<{ vectors: number[][]; model: string; dim: number }> {
  const hdrs = headers();                 // usa tu helper existente
  const inputs = ensureArray(input);

  // 1) Modelo preferido desde .env (si no existe, probamos fallback)
  const primary = process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";

  // 2) Lista de respaldo (sin duplicados)
  const candidates = Array.from(new Set([
    primary,
    "openai/text-embedding-3-small",
    "openai/text-embedding-3-large",
    "jinaai/jina-embeddings-v3",
  ]));

  async function tryModel(model: string) {
    const resp = await fetch(`${BASE}/embeddings`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify({ model, input: inputs }),
    });

    const json = await readJSONOrThrow(resp, `openrouter:${model}`);
    if (!resp.ok) {
      throw new Error(`[embed:openrouter:${model}] HTTP ${resp.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }

    // OpenAI-like: { data: [{ embedding: number[] }, ...] }
    const data = Array.isArray(json?.data) ? json.data : [];
    const vectors: number[][] = data
      .map((d: any) => d?.embedding)
      .filter((v: any) => Array.isArray(v));

    if (!vectors.length) throw new Error(`[embed:openrouter:${model}] No embeddings returned`);

    const dim = vectors[0]?.length || 0;
    return { vectors, model, dim };
  }

  let lastErr: unknown;
  for (const m of candidates) {
    try {
      return await tryModel(m);
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      // si el modelo no existe (400/404) probamos el siguiente
      if (/does not exist|Unknown model|HTTP\s+400|HTTP\s+404/i.test(msg)) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}


