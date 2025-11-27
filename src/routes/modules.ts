import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { suggestModules, chat as aiChat } from "../services/ai";
import { requireAuth } from "../middleware/auth";
import { embedText, cosineSimilarity } from "../lib/embedding";

type AiModuleJson = {
  key?: string;
  name?: string;
  title?: string;
  description?: string;
  desc?: string;
};

// Zod para la petición de IA de módulos
const AiModulesBody = z.object({
  rfpId: z.string(),
  language: z.enum(["es", "en"]).optional(),
  context: z
    .object({
      companyName: z.string().optional(),
      industry: z.string().optional(),
      objectives: z.string().optional(),
      pains: z.string().optional(),
      integrations: z.string().optional(),
      volume: z.string().optional(),
      otherNotes: z.string().optional(),
    })
    .partial()
    .optional(),
});

// helper para generar key tipo slug
function slugifyKey(input: string, fallbackIndex?: number): string {
  const base = (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  if (base) return base;
  return `mod-${fallbackIndex ?? Math.random().toString(36).slice(2, 8)}`;
}

// Quita ``` y ```json de la respuesta del modelo
function stripFences(text: string): string {
  if (!text) return "";
  let t = text.trim();

  // si viene envuelto en ```json ... ```
  if (/^```/m.test(t)) {
    t = t.replace(/^```(?:json)?/i, "");
    t = t.replace(/```$/i, "");
  }

  return t.trim();
}

// Parser tolerante: intenta JSON.parse y, si falla,
// recorta desde la primera '{' hasta la última '}'.
function parseModulesJson(
  raw: string
): { modules?: AiModuleJson[] } | null {
  if (!raw) return null;

  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    const i = raw.indexOf("{");
    const j = raw.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        obj = JSON.parse(raw.slice(i, j + 1));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  if (!obj || typeof obj !== "object") return null;
  return obj as { modules?: AiModuleJson[] };
}

const router = Router();

const AddModules = z.object({
  rfpId: z.string(),
  selected: z.array(
    z.object({
      key: z.string().min(2),
      name: z.string().min(2),
      description: z.string().optional(),
    })
  ),
});

// POST /modules/ai-suggest
router.post("/ai-suggest", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = AiModulesBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const { rfpId, language, context } = parsed.data;

      const user = (req as any).user;
      const userId = user?.id as string | undefined;

      const rfp = await prisma.rfp.findUnique({
        where: { id: rfpId },
        select: { id: true, title: true, ownerId: true, dataJson: true },
      });

      if (!rfp) {
        return res.status(404).json({ error: "RFP no encontrada" });
      }
      if (rfp.ownerId && userId && rfp.ownerId !== userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const lang = language || "es";

      const ctxLines: string[] = [];
      const d: any = rfp.dataJson || {};
      if (d.content) ctxLines.push(`Descripción del RFP: ${d.content}`);

      if (context?.companyName)
        ctxLines.push(`Empresa: ${context.companyName}`);
      if (context?.industry) ctxLines.push(`Industria: ${context.industry}`);
      if (context?.objectives)
        ctxLines.push(`Objetivos: ${context.objectives}`);
      if (context?.pains) ctxLines.push(`Dolores: ${context.pains}`);
      if (context?.integrations)
        ctxLines.push(`Integraciones: ${context.integrations}`);
      if (context?.volume)
        ctxLines.push(`Volumen esperado: ${context.volume}`);
      if (context?.otherNotes)
        ctxLines.push(`Notas adicionales: ${context.otherNotes}`);

      const userPrompt = `
Sugiere módulos funcionales para un RFP llamado "${rfp.title}".

Contexto del RFP:
${ctxLines.join("\n") || "(sin información adicional)"}

Devuelve SOLO JSON con el siguiente formato EXACTO:

{
  "modules": [
    {
      "key": "payments",
      "name": "Pagos y conciliación",
      "description": "Descripción corta orientada a negocio"
    }
  ]
}

Requisitos:
- "key" debe ser un slug corto (minúsculas, sin espacios, solo letras, números y guiones).
- "name" y "description" en idioma ${
        lang === "es" ? "español" : "inglés"
      }.
- Propón entre 3 y 8 módulos máximo.
`;

      const messages = [
        {
          role: "system" as const,
          content:
            "Eres un analista de negocio experto en estructurar módulos funcionales para RFP. Respondes únicamente con JSON válido.",
        },
        { role: "user" as const, content: userPrompt },
      ];

      try {
        // usamos el nuevo chat() de services/ai.ts
        const content = await aiChat(messages, 0.1);
        const clean = stripFences(content);

        const parsedJson = parseModulesJson(clean);
        if (!parsedJson) {
          return res.status(502).json({
            error: "La IA no devolvió JSON válido",
            raw: clean,
          });
        }

        const parsedResponse = parsedJson as {
          modules?: AiModuleJson[];
        };

        const rawMods = Array.isArray(parsedResponse.modules)
          ? parsedResponse.modules
          : [];

        const suggestions = rawMods.map((m, idx) => {
          const name = String(
            m.name || m.title || `Módulo ${idx + 1}`
          ).slice(0, 120);
          const descr = String(m.description || m.desc || "").slice(
            0,
            2000
          );
          const providedKey = m.key ? String(m.key) : "";
          const key = providedKey
            ? slugifyKey(providedKey)
            : slugifyKey(name, idx + 1);

          return { key, name, description: descr };
        });

        // deduplicar por key
        const unique: {
          key: string;
          name: string;
          description?: string;
        }[] = [];
        const seen = new Set<string>();
        for (const m of suggestions) {
          if (m.key && !seen.has(m.key)) {
            seen.add(m.key);
            unique.push(m);
          }
        }

        // ---------- Detección de redundancia semántica ----------
        let finalModules = unique;

        try {
          // 1) Módulos ya existentes en este RFP
          const existingMods = await prisma.module.findMany({
            where: { rfpId },
            select: { id: true, key: true, name: true, description: true },
          });

          const hasSuggestions = unique.length > 0;
          const hasExisting = existingMods.length > 0;

          // Si no hay nada con qué comparar, salimos tal cual
          if (hasSuggestions && (hasExisting || unique.length > 1)) {
            const textsToEmbed: string[] = [
              // primero sugerencias
              ...unique.map(
                (m) => `${m.name || m.key}: ${m.description || ""}` 
              ),
              // luego módulos existentes (si hay)
              ...existingMods.map(
                (m) => `${m.name || m.key}: ${m.description || ""}` 
              ),
            ];

            const { vectors } = await embedText(textsToEmbed as string[]);

            // Seguridad: si no coincide la longitud, no aplicar filtro
            if (
              Array.isArray(vectors) &&
              vectors.length === textsToEmbed.length
            ) {
              const suggestionVectors = vectors.slice(0, unique.length);
              const existingVectors = vectors.slice(unique.length);

              const toDrop = new Set<number>();

              const TH_EXISTING = 0.9; // sugerencia ~ módulo existente
              const TH_SUGGEST = 0.9; // sugerencia ~ otra sugerencia

              // 2) Comparar sugerencias vs módulos existentes
              if (hasExisting) {
                for (let i = 0; i < unique.length; i++) {
                  const vSugg = suggestionVectors[i];
                  let maxSim = 0;

                  for (let j = 0; j < existingMods.length; j++) {
                    const vExist = existingVectors[j];
                    const sim = cosineSimilarity(vSugg, vExist);
                    if (sim > maxSim) maxSim = sim;
                  }

                  if (maxSim >= TH_EXISTING) {
                    // ya existe algo muy parecido en este RFP
                    toDrop.add(i);
                  }
                }
              }

              // 3) Comparar sugerencias entre sí (solo las que no ya fueron marcadas)
              for (let i = 0; i < unique.length; i++) {
                if (toDrop.has(i)) continue;
                const vI = suggestionVectors[i];

                for (let k = i + 1; k < unique.length; k++) {
                  if (toDrop.has(k)) continue;
                  const vK = suggestionVectors[k];
                  const sim = cosineSimilarity(vI, vK);

                  if (sim >= TH_SUGGEST) {
                    // k es redundante con i, nos quedamos con la primera
                    toDrop.add(k);
                  }
                }
              }

              const filtered = unique.filter((_, idx) => !toDrop.has(idx));

              // Si el filtro dejó todo vacío, devolvemos la lista original
              if (filtered.length > 0) {
                finalModules = filtered;
              }
            }
          }
        } catch (e) {
          console.warn(
            "[modules.ai-suggest] detección de redundancia falló:",
            e
          );
          // Si algo falla, simplemente devolvemos unique sin filtrar
        }

        return res.json({
          ok: true,
          rfpId,
          model: "llm-model", // el modelo lo maneja el helper chat()
          count: finalModules.length,
          modules: finalModules,
        });
      } catch (err: any) {
        console.error("modules/ai-suggest error", err);
        return res.status(502).json({
          error: "Error al llamar a la IA",
          detail: String(err?.message || err),
        });
      }
    } catch (error) {
      console.error("Error in /ai-suggest route:", error);
      return res.status(500).json({
        error: "Internal server error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

// GET /modules/:rfpId
router.get("/:rfpId", requireAuth, async (req, res) => {
  const { rfpId } = req.params;
  const list = await prisma.module.findMany({ where: { rfpId } });
  res.json(list);
});

// POST /modules
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const body = AddModules.parse(req.body);
  const created = await prisma.$transaction(
    body.selected.map((m) =>
      prisma.module.create({
        data: {
          rfpId: body.rfpId,
          key: m.key,
          name: m.name,
          description: m.description,
        },
      })
    )
  );
  res.status(201).json(created);
});

// DELETE /modules/:moduleId
router.delete(
  "/:moduleId",
  requireAuth,
  async (req: Request, res: Response) => {
    await prisma.module.delete({ where: { id: req.params.moduleId } });
    res.json({ ok: true });
  }
);

// POST /modules/:rfpId/suggest  (SIN CAMBIOS)
router.post(
  "/:rfpId/suggest",
  requireAuth,
  async (req: Request, res: Response) => {
    const { rfpId } = req.params;

    const rfp = await prisma.rfp.findUnique({ where: { id: rfpId } });
    if (!rfp) return res.status(404).json({ error: "RFP not found" });

    const d: any = rfp.dataJson || {};
    const ctx = {
      objetivos: (d.objetivos || "").toString(),
      dolores: (d.dolores || "").toString(),
      integraciones: (d.integraciones || "").toString(),
      volumen: (d.volumen || "").toString(),
    };

    const libMods = await prisma.libraryModule.findMany({
      orderBy: { createdAt: "asc" },
    });

    let fromAI: Array<{ key: string; name: string; description?: string }> =
      [];
    try {
      const s = await suggestModules(ctx);
      if (Array.isArray(s)) {
        fromAI = s
          .map((m: any) => ({
            key: String(m.key || m.name || "")
              .toLowerCase()
              .replace(/\s+/g, "-")
              .slice(0, 32),
            name: String(m.name || m.key || "Módulo"),
            description: m.description || "",
          }))
          .filter((x) => x.key);
      }
    } catch (e) {
      console.warn("[modules.suggest] IA caída:", e);
    }
    const aiKeys = new Set(fromAI.map((m) => m.key));

    const SYN: Record<string, string[]> = {
      auth: [
        "usuario",
        "usuarios",
        "login",
        "inicio-sesion",
        "sesion",
        "oauth",
        "sso",
        "mfa",
        "roles",
        "permisos",
        "autenticacion",
        "seguridad",
        "acceso",
        "onboarding",
      ],
      integraciones: [
        "integracion",
        "integraciones",
        "api",
        "apis",
        "webhook",
        "erp",
        "crm",
        "sap",
        "hubspot",
        "zapier",
        "conector",
        "etl",
      ],
      workflows: [
        "workflow",
        "workflows",
        "flujo",
        "flujos",
        "proceso",
        "procesos",
        "automatizacion",
        "bpmn",
        "aprobaciones",
        "orquestacion",
        "onboarding",
      ],
      reporting: [
        "reporte",
        "reportes",
        "reporting",
        "kpi",
        "indicador",
        "indicadores",
        "dashboard",
        "bi",
        "analitica",
        "excel",
        "pdf",
        "exportar",
      ],
      comms: [
        "comunicacion",
        "comunicaciones",
        "correo",
        "email",
        "e-mail",
        "sms",
        "push",
        "whatsapp",
        "notificacion",
        "notificaciones",
      ],
      monitoring: [
        "monitoreo",
        "monitoring",
        "observabilidad",
        "logs",
        "metricas",
        "alertas",
        "rendimiento",
        "latencia",
        "escalabilidad",
      ],
      security: [
        "seguridad",
        "auditoria",
        "auditoría",
        "compliance",
        "cumplimiento",
        "gdpr",
        "iso",
        "hardening",
        "roles",
        "permisos",
      ],
      billing: [
        "billing",
        "facturacion",
        "facturación",
        "pago",
        "pagos",
        "pasarela",
        "stripe",
        "suscripcion",
        "suscripciones",
        "impuesto",
        "boleta",
        "factura",
      ],
    };

    const normalize = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const tokenize = (s: string) =>
      Array.from(
        new Set(normalize(s).split(/[^a-z0-9]+/).filter(Boolean))
      );

    const bagDol = tokenize(ctx.dolores);
    const bagObj = tokenize(ctx.objetivos);
    const bagInt = tokenize(ctx.integraciones);
    const bagVol = tokenize(ctx.volumen);

    const WEIGHTS: Record<
      "dolores" | "objetivos" | "integraciones" | "volumen",
      number
    > = { dolores: 3, objetivos: 2, integraciones: 2, volumen: 1 };

    const curated = [
      {
        key: "auth",
        name: "Autenticación y Usuarios",
        description: "Gestión de usuarios, roles, permisos, SSO/MFA",
      },
      {
        key: "integraciones",
        name: "Integraciones Externas",
        description: "Conectores, APIs y webhooks",
      },
      {
        key: "workflows",
        name: "Automatización de Procesos",
        description: "Reglas, orquestación y BPMN",
      },
      {
        key: "reporting",
        name: "Reportes y Analítica",
        description: "KPIs, dashboards, exportaciones",
      },
      {
        key: "comms",
        name: "Comunicaciones",
        description: "Email/SMS/Push/WhatsApp",
      },
      {
        key: "monitoring",
        name: "Monitoreo y Observabilidad",
        description: "Logs, métricas, alertas",
      },
      {
        key: "security",
        name: "Seguridad y Auditoría",
        description: "Hardening, auditoría y compliance",
      },
      {
        key: "billing",
        name: "Facturación y Pagos",
        description: "Planes, pasarelas e impuestos",
      },
    ];

    const universeMap = new Map<
      string,
      { key: string; name: string; description?: string }
    >();
    const pushU = (m: {
      key: string;
      name: string;
      description?: string;
    }) => {
      if (!m?.key) return;
      universeMap.set(m.key, {
        key: m.key,
        name: m.name,
        description: m.description || "",
      });
    };

    if (libMods.length) {
      for (const m of libMods)
        pushU({ key: m.key, name: m.name, description: m.description || "" });
    } else {
      for (const m of curated) pushU(m);
    }

    type Scored = {
      key: string;
      name: string;
      description?: string;
      score: number;
      matched: string[];
    };

    const scored: Scored[] = [];
    for (const m of universeMap.values()) {
      const syn = new Set<string>(SYN[m.key] || []);
      const modTokens = new Set([
        ...tokenize(m.key),
        ...tokenize(m.name || ""),
        ...tokenize(m.description || ""),
        ...syn,
      ]);

      let score = 0;
      const matched = new Set<string>();

      const bump = (bag: string[], w: number) => {
        for (const t of bag) {
          if (modTokens.has(t)) {
            score += w;
            matched.add(t);
          }
        }
      };

      bump(bagDol, WEIGHTS.dolores);
      bump(bagObj, WEIGHTS.objetivos);
      bump(bagInt, WEIGHTS.integraciones);
      bump(bagVol, WEIGHTS.volumen);

      if (aiKeys.has(m.key)) {
        score += 5;
        matched.add("ai");
      }

      scored.push({ ...m, score, matched: Array.from(matched) });
    }

        const THRESHOLD = 2;
    const MAX_MODULES = 12;

    const relevant = scored
      .filter((m) => m.score >= THRESHOLD || aiKeys.has(m.key))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_MODULES);

    // Si no hay módulos relevantes, devolvemos fallback simple (sin flags)
    if (relevant.length === 0) {
      const fallback = fromAI.length
        ? fromAI
        : Array.from(universeMap.values());
      return res.json(fallback);
    }

    // A partir de aquí: detección de redundancia semántica + flags
    let enriched = relevant.map((m) => ({ ...m }));

    try {
      const existingMods = await prisma.module.findMany({
        where: { rfpId },
        select: { id: true, key: true, name: true, description: true },
      });

      const hasSuggestions = enriched.length > 0;
      const hasExisting = existingMods.length > 0;

      if (hasSuggestions && (hasExisting || enriched.length > 1)) {
        const textsToEmbed: string[] = [
          // primero sugerencias (relevant)
          ...enriched.map(
            (m) => `${m.name || m.key}: ${m.description || ""}`
          ),
          // luego módulos ya guardados del mismo RFP
          ...existingMods.map(
            (m) => `${m.name || m.key}: ${m.description || ""}`
          ),
        ];

        const { vectors } = await embedText(textsToEmbed);

if (
  Array.isArray(vectors) &&
  vectors.length === textsToEmbed.length
) {
  const suggestionVectors = vectors.slice(0, enriched.length);
  const existingVectors = vectors.slice(enriched.length);

  const TH_EXISTING = 0.9; // sugerencia ~ módulo existente
  const TH_SUGGEST = 0.9;  // sugerencia ~ otra sugerencia

  // Para saber de qué módulo existente es "casi igual"
  const dupExistingIdx: (number | null)[] = Array(enriched.length).fill(null);

  // Grupo semántico (para el futuro en UI)
  const groupId: (number | null)[] = Array(enriched.length).fill(null);
  let nextGroupId = 1;

  // Índices de sugerencias a eliminar (redundantes)
  const toDrop = new Set<number>();

  // --- 1) Sugerencias vs módulos existentes ---
  if (hasExisting && existingVectors.length === existingMods.length) {
    for (let i = 0; i < enriched.length; i++) {
      const vS = suggestionVectors[i];
      let bestIdx: number | null = null;
      let bestSim = 0;

      for (let j = 0; j < existingMods.length; j++) {
        const vE = existingVectors[j];
        const sim = cosineSimilarity(vS, vE);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = j;
        }
      }

      if (bestIdx !== null && bestSim >= TH_EXISTING) {
        dupExistingIdx[i] = bestIdx;
        // esta sugerencia es casi igual a un módulo que ya existe → la marcamos para eliminar
        toDrop.add(i);
      }
    }
  }

  // --- 2) Sugerencias entre sí (solo las que aún no están marcadas) ---
  for (let i = 0; i < enriched.length; i++) {
    if (toDrop.has(i)) continue;
    const vI = suggestionVectors[i];

    for (let k = i + 1; k < enriched.length; k++) {
      if (toDrop.has(k)) continue;
      const vK = suggestionVectors[k];
      const sim = cosineSimilarity(vI, vK);

      if (sim >= TH_SUGGEST) {
        const gi = groupId[i];
        const gk = groupId[k];

        if (gi == null && gk == null) {
          groupId[i] = groupId[k] = nextGroupId++;
        } else if (gi != null && gk == null) {
          groupId[k] = gi;
        } else if (gi == null && gk != null) {
          groupId[i] = gk;
        }
        // k es redundante con i → nos quedamos con el primero
        toDrop.add(k);
      }
    }
  }

  // --- 3) Aplicar filtro + añadir flags ---
  const withIndex = enriched.map((m, idx) => ({ m, idx }));

  // si hay duplicados, los sacamos; si por algún motivo queda vacío, usamos la lista original
  const filteredWithIndex =
    toDrop.size > 0
      ? withIndex.filter(({ idx }) => !toDrop.has(idx))
      : withIndex;

  const base =
    filteredWithIndex.length > 0 ? filteredWithIndex : withIndex;

  enriched = base.map(({ m, idx }) => {
    const dupIdx = dupExistingIdx[idx];
    const dupExisting = dupIdx != null ? existingMods[dupIdx] : null;

    return {
      ...m,
      isDuplicateOfExisting: !!dupExisting,
      duplicateOfExistingKey: dupExisting?.key ?? null,
      duplicateOfExistingName: dupExisting?.name ?? null,
      groupId: groupId[idx],
    };
  });
}

      }
    } catch (e) {
      console.warn(
        "[modules/:rfpId/suggest] detección de redundancia embeddings falló:",
        e
      );
      // si algo falla, devolvemos 'relevant' sin flags extra
    }

    return res.json(enriched);
  }
);


export default router;
