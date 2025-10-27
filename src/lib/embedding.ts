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

export async function embedText(input: string | string[]) {
  if (!KEY) throw new Error("Missing OPENROUTER_API_KEY");
  const inputs = Array.isArray(input) ? input : [input];
  const body = {
    model: EMBEDDING_MODEL,
    input: inputs,
  };
  const resp = await fetch(`${BASE}/embeddings`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Embeddings error: ${resp.status} ${t}`);
  }
  const json = await resp.json();
  // OpenRouter sigue el formato OpenAI: data[i].embedding
  const vectors: number[][] = (json?.data || []).map((d: any) => d.embedding);
  return { vectors, model: EMBEDDING_MODEL, dim: vectors[0]?.length || 0 };
}
