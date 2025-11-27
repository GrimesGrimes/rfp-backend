// src/llm.ts
export const LLM_BASE =
  process.env.LLM_BASE || "https://openrouter.ai/api/v1";

// Modelo primario (ajústalo si prefieres otro)
export const LLM_MODEL =
  process.env.LLM_MODEL || "deepseek/deepseek-v3.1";

// Fallbacks separados por coma en .env, o usamos unos razonables por defecto
const FALLBACK_ENV = process.env.LLM_FALLBACK || [
  "openai/gpt-4o-mini",
  "meta-llama/llama-3.1-8b-instruct",
  "qwen/qwen-2.5-7b-instruct",
].join(",");

export const LLM_FALLBACK = FALLBACK_ENV
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

export function llmHeaders() {
  const key = process.env.OPENROUTER_API_KEY || process.env.LLM_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY no está definido");

  return {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    // Recomendado por OpenRouter para identificar tu app
    "HTTP-Referer": process.env.APP_PUBLIC_URL || "http://localhost:5173",
    "X-Title": process.env.APP_TITLE || "RFP Studio (local)",
  } as Record<string, string>;
}

/**
 * Llama al /chat/completions con fallback en caso de 5xx.
 */
export async function chat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  opts: Partial<{ model: string; temperature: number; max_tokens: number }> = {}
): Promise<string> {
  const models = [opts.model || LLM_MODEL, ...LLM_FALLBACK];
  let lastErr: { status?: number; text?: string } | undefined;

  for (const m of models) {
    const r = await fetch(`${LLM_BASE}/chat/completions`, {
      method: "POST",
      headers: llmHeaders(),
      body: JSON.stringify({
        model: m,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.max_tokens ?? 800,
      }),
    });

    if (r.ok) {
      const json = await r.json();
      return json?.choices?.[0]?.message?.content ?? "";
    }

    const text = await r.text();
    lastErr = { status: r.status, text };
    console.error(`[LLM] ${m} -> ${r.status} ${text}`);

    // Si es 4xx, no tiene sentido seguir probando (error de input)
    if (r.status >= 400 && r.status < 500) break;
  }

  throw new Error(`LLM failed: ${lastErr?.status} ${lastErr?.text}`);
}

/** Quita fences ```json ... ``` si la IA los devuelve */
export function stripFences(s: string) {
  if (!s) return s;
  const trimmed = s.trim();
  if (trimmed.startsWith("```")) {
    const m = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (m) return m[1].trim();
  }
  return trimmed;
}
