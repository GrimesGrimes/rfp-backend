//rfp-backend\src\services\ai.ts
// src/services/ai.ts — OpenRouter (DeepSeek v3.1:free) + robustez JSON y fallback
// Requires environment variables to be set in .env or through the environment

type Role = "system" | "user" | "assistant";
export type ChatMessage = { role: Role; content: string };

import { getEnv } from "../config/env";
import { keyFrom, getCached, setCached } from "./ai-cache";
const { OPENROUTER_BASE: BASE, OPENROUTER_API_KEY: KEY, LLM_MODEL: MODEL } = getEnv();

function headers() {
  const h: Record<string, string> = {
    "Authorization": `Bearer ${KEY}`,
    "Content-Type": "application/json",
  };
  if (process.env.APP_PUBLIC_URL) h["HTTP-Referer"] = process.env.APP_PUBLIC_URL!;
  if (process.env.APP_TITLE) h["X-Title"] = process.env.APP_TITLE!;
  return h;
}

export async function chat(messages: ChatMessage[], temperature = 0.0): Promise<string> {
  if (!KEY) throw new Error("Missing OPENROUTER_API_KEY");
  
  // Simple cache layer keyed by model+messages
  const cacheKey = keyFrom({ MODEL, temperature, messages });
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const body = { model: MODEL, messages, temperature };
  const resp = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`LLM error: ${resp.status} ${t}`);
  }
  
  const json = await resp.json();
  const out = (json?.choices?.[0]?.message?.content ?? "").trim();
  
  // Store in cache
  await setCached(cacheKey, out);
  return out;
}

/** === Parsers tolerantes a texto con ruido === */
function parseJsonArray(out: string): any[] {
  try {
    const p = JSON.parse(out);
    return Array.isArray(p) ? p : [];
  } catch {}
  const i = out.indexOf("[");
  const j = out.lastIndexOf("]");
  if (i >= 0 && j > i) {
    try {
      const p = JSON.parse(out.slice(i, j + 1));
      return Array.isArray(p) ? p : [];
    } catch {}
  }
  return [];
}

function parseJsonObject(out: string): any {
  try {
    const p = JSON.parse(out);
    return p && typeof p === "object" ? p : null;
  } catch {}
  const i = out.indexOf("{");
  const j = out.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try {
      const p = JSON.parse(out.slice(i, j + 1));
      return p && typeof p === "object" ? p : null;
    } catch {}
  }
  return null;
}

/** === Fallback local si la IA no devuelve JSON parseable === */
function fallbackModules(input: {
  objetivos: string;
  dolores: string;
  integraciones: string;
  volumen: string;
}) {
  const ints = (input.integraciones || "").toLowerCase();
  const hasHubspot = ints.includes("hubspot");
  const hasSap = ints.includes("sap");

  const base = [
    { key: "auth", name: "Autenticación y Usuarios", why: "SSO/MFA, roles/permisos, onboarding rápido." },
    { key: "integraciones", name: "Integraciones Externas", why: "Conexión con APIs de terceros (ERP/CRM)." },
    { key: "reporting", name: "Reporting y Analítica", why: "KPIs, dashboards, exportaciones." },
    { key: "workflow", name: "Orquestación de Flujos", why: "Automatización de procesos y aprobaciones." },
    { key: "catalogo", name: "Catálogo/Configuración", why: "Parametrización sin código, plantillas." },
    { key: "seguridad", name: "Seguridad & Cumplimiento", why: "Logs, auditoría, políticas, RGPD/ISO." },
  ];

  if (hasHubspot) base.unshift({ key: "crm_hubspot", name: "CRM (HubSpot)", why: "Sincronización contactos, deals y actividad." });
  if (hasSap) base.unshift({ key: "erp_sap", name: "ERP (SAP)", why: "Maestros, pedidos, facturación." });

  // Devuelve máximo 8, sin duplicados de key
  const seen = new Set<string>();
  const out: any[] = [];
  for (const m of base) {
    if (!seen.has(m.key)) { seen.add(m.key); out.push(m); }
    if (out.length >= 8) break;
  }
  return out;
}

/** === Módulos sugeridos por IA con robustez === */
export async function suggestModules(input: {
  objetivos: string;
  dolores: string;
  integraciones: string;
  volumen: string;
}): Promise<Array<{ key: string; name: string; why?: string }>> {
  const messages: ChatMessage[] = [
    { role: "system", content: "Eres un analista de RFP. Devuelve SOLO un array JSON válido (sin comentarios, sin texto extra)." },
    { role: "user", content:
`Cliente:
Objetivos: ${input.objetivos}
Dolores: ${input.dolores}
Integraciones: ${input.integraciones}
Volumen: ${input.volumen}

Devuelve 6-10 módulos en JSON ESTRICTO:
[
  {"key":"auth","name":"Autenticación y Usuarios","why":"..."},
  {"key":"integraciones","name":"Integraciones Externas","why":"..."}
]` }
  ];

  // Intento 1
  let out = await chat(messages, 0.0);
  let parsed = parseJsonArray(out);

  // Intento 2 (retry) si viene vacío o no parsea
  if (!parsed.length) {
    const retry: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: out },
      { role: "user", content: "Repite la respuesta devolviendo SOLO el array JSON, sin ningún texto adicional." }
    ];
    out = await chat(retry, 0.0);
    parsed = parseJsonArray(out);
  }

  if (parsed.length) return parsed;

  // Fallback local
  console.warn("[suggestModules] usando fallback local por salida no-JSON del modelo");
  return fallbackModules(input);
}

/** === Requisitos sugeridos por IA con robustez === */
export async function suggestRequirements(input: {
  moduleKey: string;
  moduleName: string;
  objetivos: string;
  dolores: string;
  integraciones: string;
  volumen: string;
}): Promise<{ functional: any[]; nonfunctional: any[] }> {
  const messages: ChatMessage[] = [
    { role: "system", content: "Eres un analista de RFP. Devuelve SOLO un objeto JSON válido (sin comentarios, sin texto extra)." },
    { role: "user", content:
`Genera requisitos para el módulo "${input.moduleName}" (key: ${input.moduleKey})
Contexto:
- Objetivos: ${input.objetivos}
- Dolores: ${input.dolores}
- Integraciones: ${input.integraciones}
- Volumen: ${input.volumen}

Devuelve JSON ESTRICTO:
{
  "functional": [{"title":"...","body":"...","moscow":"wont|would|could|should"}],
  "nonfunctional": [{"title":"...","body":"...","moscow":"wont|would|could|should"}]
}` }
  ];

  // Intento 1
  let out = await chat(messages, 0.0);
  let parsed: any = parseJsonObject(out);

  // Intento 2 (retry)
  if (!parsed || !parsed.functional || !parsed.nonfunctional) {
    const retry: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: out },
      { role: "user", content: "Repite la respuesta devolviendo SOLO el objeto JSON válido, sin texto adicional." }
    ];
    out = await chat(retry, 0.0);
    parsed = parseJsonObject(out);
  }

  if (parsed && parsed.functional && parsed.nonfunctional) {
    return {
      functional: Array.isArray(parsed.functional) ? parsed.functional : [],
      nonfunctional: Array.isArray(parsed.nonfunctional) ? parsed.nonfunctional : [],
    };
  }

  console.warn("[suggestRequirements] salida no-JSON del modelo, devolviendo vacío");
  return { functional: [], nonfunctional: [] };
}
