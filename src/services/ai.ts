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
  
  try {
    const resp = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const t = await resp.text();
      if (resp.status === 429) {
        throw new Error("RATE_LIMIT: El modelo de IA alcanzó su límite de uso. Intenta nuevamente en unos minutos.");
      }
      throw new Error(`LLM error: ${resp.status} ${t}`);
    }
    
    const json = await resp.json();
    const out = (json?.choices?.[0]?.message?.content ?? "").trim();
    
    // Store in cache
    await setCached(cacheKey, out);
    return out;
  } catch (err: any) {
    if (err?.message?.includes("RATE_LIMIT")) {
      throw err;
    }
    throw err;
  }
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
  existing?: Array<{ title: string; body?: string | null }>; // 👈 NUEVO
}): Promise<{ functional: any[]; nonfunctional: any[] }> {
  const existingText =
    input.existing && input.existing.length
      ? `
Requisitos que YA existen en este módulo (NO los repitas ni los reformules, y evita proponer requisitos que cubran exactamente el mismo objetivo):

${input.existing
        .slice(0, 25) // límite de 25 para no inflar demasiado el prompt
        .map(
          (r, idx) =>
            `- R${idx + 1}: "${r.title}"${
              r.body ? ` — ${String(r.body).slice(0, 160)}` : ""
            }`
        )
        .join("\n")}
`
      : `
Si el módulo ya tiene requisitos definidos en el RFP, NO los repitas ni propongas requisitos que cubran exactamente el mismo objetivo.
`;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Eres un analista de RFP. Devuelves SOLO un objeto JSON válido (sin comentarios, sin texto extra).",
    },
    {
      role: "user",
      content: `
Genera requisitos para el módulo "${input.moduleName}" (key: ${input.moduleKey}).

Contexto:
- Objetivos: ${input.objetivos}
- Dolores: ${input.dolores}
- Integraciones: ${input.integraciones}
- Volumen: ${input.volumen}
${existingText}

REGLAS OBLIGATORIAS:
- NO repitas ni reformules los requisitos listados arriba.
- Evita proponer requisitos que cubran exactamente el mismo objetivo, aunque cambie la redacción.
- Propón solo requisitos NUEVOS y complementarios a los existentes.

Devuelve JSON ESTRICTO:
{
  "functional": [{"title":"...","body":"...","moscow":"wont|would|could|should"}],
  "nonfunctional": [{"title":"...","body":"...","moscow":"wont|would|could|should"}]
}
`.trim(),
    },
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

// === Redacción de secciones del RFP (introducción, objetivos, etc.) ===

export type RfpSectionKey =
  | "intro"
  | "objectives"
  | "situation"
  | "elements"
  | "needs"
  | "general"
  | "calendar";

export type RfpAiInput = {
  companyName?: string;
  name?: string;
  title?: string;
  nombre?: string;
  objectives?: string;
  objetivos?: string;
  painPoints?: string;
  dolores?: string;
  scope?: string;
  descripcion?: string;
  description?: string;
  notes?: string;
  notas?: string;
  modules?: Array<{ name?: string; description?: string }>;
  fechaBase?: string; // ISO "YYYY-MM-DD"
};

function sectionTitle(key: RfpSectionKey): string {
  switch (key) {
    case "intro":       return "Introducción";
    case "objectives":  return "Objetivos del proceso de contratación";
    case "situation":   return "Descripción de la situación actual y futura";
    case "elements":    return "Elementos previos a tener en cuenta";
    case "needs":       return "Necesidades cuantificadas";
    case "general":     return "Aspectos generales";
    case "calendar":    return "Calendario previsto";
  }
}

/**
 * Genera texto para una sección del documento de RFP.
 */
export async function generateRfpSection(
  section: RfpSectionKey,
  rfp: RfpAiInput
): Promise<string> {
  const r: any = rfp || {};

  const modulesText = (r.modules || [])
    .map((m: any) => `- ${m.name ?? ""}: ${m.description ?? ""}`)
    .join("\n");

  const ctx = `
Empresa: ${rfp.companyName ?? ""}
Nombre del proyecto / RFP: ${rfp.name ?? rfp.title ?? rfp.nombre ?? ""}
Objetivos declarados: ${rfp.objectives ?? rfp.objetivos ?? ""}
Dolores / problemas actuales: ${rfp.painPoints ?? rfp.dolores ?? ""}
Alcance o descripción: ${rfp.scope ?? rfp.descripcion ?? rfp.description ?? ""}
Notas adicionales: ${rfp.notes ?? rfp.notas ?? ""}
Fecha base: ${rfp.fechaBase ?? ""}

Módulos / bloques funcionales:
${modulesText || "- (sin módulos definidos todavía)"}
`.trim();

  const titulo = sectionTitle(section);

  let instrucciones = "";

  switch (section) {
    case "intro":
      instrucciones = `
Redacta la sección "Introducción" de un documento de Solicitud de Propuesta (RFP).
Tono: formal, claro y directo, en español neutro.
No repitas títulos, solo escribe el texto en uno o dos párrafos.`.trim();
      break;

    case "objectives":
      instrucciones = `
Redacta la sección "Objetivos del proceso de contratación".
Explica qué busca conseguir la empresa (mejora tecnológica, optimización de costes, etc.).
Usa 2-3 párrafos, tono formal.`.trim();
      break;

    case "situation":
      instrucciones = `
Redacta la "Descripción de la situación actual y futura".
Describe brevemente la situación actual, los problemas y la visión futura deseada.
Usa 2-4 párrafos, en español formal.`.trim();
      break;

    case "elements":
      instrucciones = `
Redacta la sección "Elementos previos a tener en cuenta".
Enumera en viñetas las particularidades relevantes para el proveedor (políticas internas, restricciones, etc.).`.trim();
      break;

    case "needs":
      instrucciones = `
Redacta la sección "Necesidades cuantificadas".
Resume de forma estructurada los servicios a contratar y su posible evolución.
Devuélvelo como lista de viñetas o texto estructurado (no hace falta tabla real).`.trim();
      break;

    case "general":
      instrucciones = `
Redacta la sección "Aspectos generales".
Incluye consideraciones sobre cambio de proveedor, portabilidad, servicios asociados, etc., si aplica al contexto.
Usa tono formal y orientado a proveedor.`.trim();
      break;

                case "calendar":
      instrucciones = `
Redacta la sección "Calendario previsto" de un RFP en español.

Condiciones OBLIGATORIAS:
- NO inventes nombres propios de personas, correos electrónicos ni nombres de proyectos.
- Usa solo cargos genéricos: "Responsable de Compras", "Responsable de TI", "Comité Evaluador", "Gerencia General", etc.
- No inventes el nombre de la empresa ni del proyecto salvo que venga explícitamente en el input.
- Si en el input hay un campo "fechaBase" (formato "YYYY-MM-DD"):
  - Todas las fechas concretas deben ser posteriores a esa fecha.
  - Usa plazos razonables entre fases (recepción de propuestas, aclaraciones, demos, segunda propuesta, decisión final, firma e inicio del servicio).
- Si NO hay "fechaBase":
  - NO uses fechas de calendario tipo "15 de noviembre de 2024".
  - Usa SOLO plazos relativos: "dentro de 10 días", "en las 2 semanas siguientes", "en un plazo máximo de 5 días hábiles", etc.

Formato ESTRICTO de salida:
- Devuelve ÚNICAMENTE una lista de viñetas Markdown.
- Cada viñeta debe ser UNA FASE en una sola línea, con este formato:

  - **Nombre de la fase**: descripción breve con plazos y responsables.

  Ejemplos de nombres de fase: "Recepción de propuestas", "Rondas de preguntas y aclaraciones", "Demostraciones técnicas", "Segunda propuesta ajustada", "Decisión final y notificación", "Firma del contrato e inicio del servicio".

- NO incluyas encabezados como "Calendario previsto".
- NO uses "Hito 1", "Hito 2" ni numeraciones; solo nombres descriptivos de las fases.
- NO añadas texto antes ni después de la lista de viñetas.
`.trim();
      break;
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Eres un consultor experto en redacción de RFP B2B. Escribes en español formal y claro. Respondes SOLO con el texto solicitado (o tabla Markdown), sin explicaciones adicionales."
    },
    {
      role: "user",
      content: `
Datos del cliente y del proyecto:
${ctx}

Sección a redactar: "${titulo}".

Instrucciones específicas:
${instrucciones}
`.trim(),
    },
  ];

  const out = await chat(messages, 0.4);
  return out.trim();
}
