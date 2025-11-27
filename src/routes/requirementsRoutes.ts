import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { isMoscow } from "../lib/moscow";
import { suggestRequirements } from "../services/ai";
import { requireAuth } from "../middleware/auth";
import { Prisma } from "@prisma/client";
import { cosineSimilarity, embedText } from "../lib/embedding";

// ===== Helpers de texto para detectar duplicados =====
const STOPWORDS_ES = new Set([
  "de","del","la","el","los","las","y","en","con","para","por","un","una","al","lo",
  "sus","su","se","es","que","como","cuando","antes","despues","mas","menos"
]);

const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // quita tildes
    .replace(/[^a-z0-9]+/g, " ")       // deja solo letras/números y espacios
    .trim();

/**
 * Convierte un texto en tokens "raíz" muy simples:
 * - minúsculas
 * - sin tildes ni signos
 * - sin stopwords
 * - recorta plurales simples ("vencimiento(s)", "alerta(s)")
 */
const textToTokens = (s: string) =>
  normalizeText(s)
    .split(/\s+/)
    .filter((t) => {
      if (t.length <= 2) return false;
      if (STOPWORDS_ES.has(t)) return false;
      return true;
    })
    .map((t) => {
      // stemming ultra sencillo para plurales
      if (t.endsWith("es") && t.length > 4) {
        return t.slice(0, -2); // almacenes → almacen
      }
      if (t.endsWith("s") && t.length > 3) {
        return t.slice(0, -1); // vencimientos → vencimiento; alertas → alerta
      }
      return t;
    });

function jaccardSimilarity(aTokens: string[], bTokens: string[]): number {
  const setA = new Set(aTokens);
  const setB = new Set(bTokens);
  if (setA.size === 0 && setB.size === 0) return 1;
  let inter = 0;
  for (const t of setA) {
    if (setB.has(t)) inter++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}


// Configuración de LLM
// constantes y helpers para llamar a OpenRouter:
const LLM_BASE = process.env.OPENROUTER_BASE || "https://openrouter.ai/api/v1";
const LLM_KEY = process.env.OPENROUTER_API_KEY;
const LLM_MODEL =process.env.LLM_MODEL || "deepseek/deepseek-chat-v3.1:free";



function cleanJsonContent(raw: string): string {
  let s = (raw || "").trim();

  // Quitar ```json ... ``` o ``` ... ```
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-zA-Z]*\s*/m, ""); // quita ```json o ``` al inicio
    s = s.replace(/```$/m, "");           // quita ``` al final
  }

  return s.trim();
}


function llmHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${LLM_KEY}`,
    "Content-Type": "application/json",
  };

  if (process.env.APP_PUBLIC_URL) {
    h["HTTP-Referer"] = process.env.APP_PUBLIC_URL!;
  }
  if (process.env.APP_TITLE) {
    h["X-Title"] = process.env.APP_TITLE!;
  }

  return h;
}

// POST /requirements/ai-suggest
// schema Zod y tipos:
const AiSuggestBody = z.object({
  rfpId: z.string(),
  language: z.enum(["es", "en"]).optional(),
  modules: z
    .array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .min(1),
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

type Moscow = "wont" | "would" | "could" | "should";

function normalizeCategory(value: unknown): Moscow {
  const raw = String(value || "").toLowerCase().trim();

  const map: Record<string, Moscow> = {
    wont: "wont",
    "won't": "wont",
    would: "would",
    could: "could",
    should: "should",
    must: "should",
    obligatorio: "should",
    deseable: "could",
    opcional: "would",
  };

  const mapped = map[raw];
  if (mapped) return mapped;

  // fallback seguro
  if (raw === "wont" || raw === "would" || raw === "could" || raw === "should") {
    return raw;
  }
  return "should";
}


/* Helpers de mapeo entre prioridad texto (UI) y enum Moscow */
function priorityToMoscow(priority?: string): Moscow {
  const v = (priority || "would").toLowerCase();
  if (v.startsWith("should")) return "should";
  if (v.startsWith("could")) return "could";
  if (v.startsWith("wont")) return "wont";
  return "would";
}

function moscowToPriority(cat?: Moscow | null): string {
  if (!cat) return "Must";
  switch (cat.toLowerCase()) {
    case "should":
      return "Should";
    case "could":
      return "Could";
    case "wont":
      return "Wont";
    case "must":
    default:
      return "Must";
  }
}

const router = Router();

/**
 * GET /requirements?rfpId=cmhs5f0ty0001i9jwmfcdim0g
 * Devuelve todos los requisitos de ese RFP.
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const { rfpId } = req.query;

    if (!rfpId || typeof rfpId !== "string") {
      return res.status(400).json({ error: "rfpId es requerido" });
    }

    const rows = await prisma.requirement.findMany({
      where: { rfpId, status: "active" },
      include: { module: true },
      orderBy: [{ moduleId: "asc" }, { title: "asc" }],
    });

    const payload = rows.map((r) => ({
      id: r.id,
      moduleKey: r.module?.key ?? "",      // RfpEditPage usa moduleKey || module
      module: r.module?.name ?? "",
      code: null,                          // por si en el futuro agregas código
      title: r.title,
      body: r.body ?? "",
      priority: moscowToPriority(r.category),
    }));

    res.json(payload);
  } catch (err) {
    console.error("GET /requirements error", err);
    res.status(500).json({ error: "Error al obtener requisitos" });
  }
});

// GET /requirements/checklist?rfpId=...
// Devuelve items agrupados por MoSCoW: wont/would/could/should
router.get("/checklist", requireAuth, async (req, res) => {
  try {
    const rfpId = String(req.query.rfpId || "").trim();
    if (!rfpId) return res.status(400).json({ error: "rfpId es requerido" });

    const items = await prisma.requirement.findMany({
      where: { rfpId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        body: true,
        type: true,      // "functional" | "nonfunctional"
        status: true,    // si tienes estatus (e.g., "active" | "archived")
        category: true,  // "wont" | "would" | "could" | "should"
      },
    });

    const groups: Record<"wont"|"would"|"could"|"should", any[]> = {
      wont: [], would: [], could: [], should: []
    };

    for (const it of items) {
      const k = (it.category as "wont"|"would"|"could"|"should") || "should";
      groups[k].push({
        id: it.id,
        title: it.title,
        type: it.type,
        status: it.status,
        snippet: (it.body || "").slice(0, 240),
      });
    }

    res.json({
      rfpId,
      counts: {
        wont: groups.wont.length,
        would: groups.would.length,
        could: groups.could.length,
        should: groups.should.length,
      },
      groups,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "checklist_failed" });
  }
});

// New: bulk upsert with idempotencyKey (ensures replays don't duplicate)
const BulkUpsert = z.object({
  idempotencyKey: z.string().min(16),
  items: z.array(
    z.object({
      rfpId: z.string(),
      moduleKey: z.string().optional(),              // 👈 aquí ya está moduleKey
      title: z.string().min(3),
      body: z.string().min(3),
      type: z.enum(["functional", "nonfunctional"]),
      category: z.enum(["wont", "would", "could", "should"]).default("should"),
    })
  ).min(1).max(200),
});


const CreateReq = z.object({
  rfpId: z.string(),
  moduleId: z.string().optional(),
  title: z.string().min(3),
  body: z.string().min(3),
  type: z.enum(["functional","nonfunctional"]),
  category: z.enum(["wont","would","could","should"]).default("should"),
});


// GET /requirements/list?rfpId=...&status=active|archived
// GET /requirements/list?rfpId=...&status=active|archived&moduleId=...
router.get("/list", requireAuth, async (req, res) => {
  const rfpId   = String(req.query.rfpId || "").trim();
  const status  = String(req.query.status || "").trim();   // opcional
  const moduleId = String(req.query.moduleId || "").trim(); // opcional

  if (!rfpId) {
    return res.status(400).json({ error: "rfpId es requerido" });
  }

  const where: Prisma.RequirementWhereInput = { rfpId };

  if (status) {
    where.status = status as any; // "active" | "archived"
  }

  if (moduleId) {
    where.moduleId = moduleId;
  }

  const items = await prisma.requirement.findMany({
    where,
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      type: true,
      category: true,
      status: true,
      moduleId: true,
    },
  });

  res.json({
    rfpId,
    moduleId: moduleId || null,
    count: items.length,
    items,
  });
});


// PATCH /requirements/:id
// body: { category?: "wont"|"would"|"could"|"should", status?: "active"|"archived", title?: string, body?: string, type?: "functional"|"nonfunctional", moduleId?: string|null }
const PatchRequirement = z.object({
  title: z.string().min(3).optional(),
  body: z.string().min(1).optional(),
  type: z.enum(["functional","nonfunctional"]).optional(),
  category: z.enum(["wont","would","could","should"]).optional(),
  status: z.enum(["active","archived"]).optional(),
  moduleId: z.string().nullable().optional(),
});

router.patch("/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "id requerido" });

  const parsed = PatchRequirement.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = parsed.data;
  if (Object.keys(data).length === 0) return res.status(400).json({ error: "sin cambios" });

  const updated = await prisma.requirement.update({ where: { id }, data });
  res.json({ ok: true, updated });
});

// GET /requirements/:rfpId
router.get("/:rfpId", async (req: Request, res: Response) => {
  const { rfpId } = req.params;
  const { category, status } = req.query as any;

  const where: any = { rfpId };
  if (category && isMoscow(String(category))) where.category = category;
  if (status) where.status = status;

  const items = await prisma.requirement.findMany({ where, orderBy: { createdAt: "desc" }});
  res.json(items);
});

// POST /requirements
/**
 * POST /requirements
 * Body: { rfpId, items: [{ moduleKey, title, body, type?, priority? }] }
 * Crea (o actualiza) requisitos sencillos desde RfpEditPage.
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const { rfpId, items } = req.body as {
      rfpId?: string;
      items?: {
        id?: string;          // si en el futuro decides mandar id
        moduleKey?: string;
        title?: string;
        body?: string;
        priority?: string;    // "Must" | "Should" | ...
      }[];
    };

    if (!rfpId || !Array.isArray(items)) {
      return res.status(400).json({ error: "rfpId e items son requeridos" });
    }

    // Normalizamos y filtramos vacíos
    const cleaned = items
      .filter((i) => i?.title && i?.body)
      .map((i) => ({
        id: i.id,
        moduleKey: i.moduleKey ?? "",
        title: i.title!.trim(),
        body: i.body!.trim(),
        category: priorityToMoscow(i.priority),
      }));

    if (!cleaned.length) {
      return res.json({ ok: true });
    }

    // Resolvemos moduleId a partir de moduleKey
    const moduleKeys = Array.from(
      new Set(cleaned.map((i) => i.moduleKey).filter(Boolean))
    );

    const modules = await prisma.module.findMany({
      where: { rfpId, key: { in: moduleKeys } },
      select: { id: true, key: true },
    });

    const moduleMap = new Map(modules.map((m) => [m.key, m.id]));
    const userId = (req as any).user?.id ?? null;

    // Creamos (o actualizamos si en el futuro mandas id)
    const ops = cleaned.map((i) => {
      const baseData = {
        rfpId,
        moduleId: moduleMap.get(i.moduleKey) ?? null,
        title: i.title,
        body: i.body,
        type: "functional" as string, // por defecto
        category: i.category,
        status: "active" as string,
        createdById: userId as string | null,
      };

      if (i.id) {
        // Update por id (por si más adelante quieres editar existentes)
        return prisma.requirement.update({
          where: { id: i.id },
          data: {
            ...baseData,
            createdById: undefined, // no tocamos el creador en updates
          },
        });
      }

      // Create con protección por la unique (rfpId, title, type)
      return prisma.requirement.upsert({
        where: {
          rfpId_title_type: {
            rfpId,
            title: i.title,
            type: "functional", // mismo que arriba
          },
        },
        update: {
          body: i.body,
          moduleId: moduleMap.get(i.moduleKey) ?? null,
          category: i.category,
          status: "active",
        },
        create: baseData,
      });
    });

    await prisma.$transaction(ops);

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /requirements error", err);
    res.status(500).json({ error: "Error al guardar requisitos" });
  }
});

// PATCH /requirements/:id
router.patch("/:id", async (req: Request, res: Response) => {
  const patch = UpdateReq.parse(req.body);
  const item = await prisma.requirement.update({ where: { id: req.params.id }, data: patch });
  res.json(item);
});

/**
 * DELETE /requirements/:id
 * Elimina un requisito concreto.
 */
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.requirement.delete({
      where: { id },
    });

    res.status(204).end();
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Requisito no encontrado" });
    }
    console.error("DELETE /requirements/:id error", err);
    res.status(500).json({ error: "Error al eliminar requisito" });
  }
});

router.post("/bulk-upsert", async (req: Request, res: Response) => {
  const parse = BulkUpsert.safeParse(req.body);
  if (!parse.success) return res.status(400).json(parse.error);
  const { idempotencyKey, items } = parse.data;

  // Make sure we don't process the same batch twice
  const found = await prisma.aiCache.findUnique({ where: { key: `bulk:${idempotencyKey}`  } });
  if (found) {
    return res.json({ ok: true, replay: true });
  }

  // map moduleKey -> moduleId for each RFP involved
  const byRfp = new Map<string, Map<string,string>>();
  const rfps = new Set(items.map(i => i.rfpId));
  for (const rfpId of rfps) {
    const mods = await prisma.module.findMany({ where: { rfpId }, select: { id: true, key: true } });
    const m = new Map<string,string>();
    mods.forEach(mm => m.set(mm.key, mm.id));
    byRfp.set(rfpId, m);
  }

  // Upsert semantics: uniqueness by (rfpId, title, type)
  const ops = items.map((it) => {
    const moduleId = it.moduleKey ? byRfp.get(it.rfpId)?.get(it.moduleKey) ?? null : null;
    return prisma.requirement.upsert({
      where: { rfpId_title_type: { rfpId: it.rfpId, title: it.title, type: it.type } },
      update: { body: it.body, category: it.category, moduleId },
      create: {
        rfpId: it.rfpId,
        title: it.title,
        body: it.body,
        type: it.type,
        category: it.category,
        moduleId,
      },
    });
  });

  await prisma.$transaction(ops);
  // mark idempotencyKey as consumed (reuse cache table for simplicity)
  await prisma.aiCache.upsert({
    where: { key: `bulk:${idempotencyKey}`  },
    update: { value: "ok", expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) },
    create: { key: `bulk:${idempotencyKey}`, value: "ok", expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) },
  });

  res.json({ ok: true });
});

// POST /requirements/:rfpId/suggest
// Funciones de apoyo
router.post("/:rfpId/suggest", requireAuth, async (req, res) => {
  const { rfpId } = req.params;
  const { moduleKey, moduleName } = req.body;
  console.log("[DEDUP REQS] hit /requirements/:rfpId/suggest", { rfpId, moduleKey });

  const rfp = await prisma.rfp.findUnique({ where: { id: rfpId }});
  if (!rfp) return res.status(404).json({ error: "RFP not found" });

  const d: any = rfp.dataJson || {};
  const ctx = {
    moduleKey,
    moduleName,
    objetivos: d.objetivos || "",
    dolores: d.dolores || "",
    integraciones: d.integraciones || "",
    volumen: d.volumen || "",
  };

  // 1) IA (puede fallar o devolver vacío)
  let ai = { functional: [] as any[], nonfunctional: [] as any[] };
  try { ai = await suggestRequirements(ctx); } catch (e) { console.warn("[suggest] IA caída:", e); }

  // 2) Fallback de librería por relación (¡OJO! tu schema NO tiene moduleKey aquí)
  const lib = await prisma.libraryRequirement.findMany({
    where: { module: { key: moduleKey } },   // ✔ filtramos por la relación
    take: 20,
    orderBy: { createdAt: "desc" },          // ✔ LibraryRequirement no tiene updatedAt
    include: { module: true },
  });

  // 3) Normalización a la forma que espera tu Requirement (usa 'body', no 'description')
  const asItem = (r: any, type: "functional" | "nonfunctional", fromLib = false) => ({
    title: String(r.title || r.name || "Requisito"),
    body:  String(r.body || r.description || r.desc || ""),
    type,
    // En tu modelo Requirement 'category' es MoSCoW (enum). Damos por defecto "should".
    category: "should",
    moduleKey,
    moduleName,
    _source: fromLib ? "library" : "ai",
  });

  const fromAI = [
    ...ai.functional.map((r: any) => asItem(r, "functional")),
    ...ai.nonfunctional.map((r: any) => asItem(r, "nonfunctional")),
  ];

  const fromLib = lib.map((r: any) =>
    asItem(
      { title: r.title, body: r.body },
      (r.type === "nonfunctional" ? "nonfunctional" : "functional"),
      true
    )
  );

  const mixed = (fromAI.length ? [...fromAI, ...fromLib] : fromLib).slice(0, 40);

  // ---------- Detección de redundancia semántica + flags ----------
  let enriched = mixed.map((r) => ({ ...r }));

  try {
    // Requisitos ya existentes para este RFP y módulo
    const existingReqs = await prisma.requirement.findMany({
      where: {
        rfpId,
        module: { key: moduleKey }, // si quieres contra todo el RFP, quita esta línea
        status: "active",
      },
      select: { id: true, title: true, body: true, type: true, category: true },
    });

    const hasSuggestions = enriched.length > 0;
    const hasExisting = existingReqs.length > 0;

    if (hasSuggestions && hasExisting) {
      // 1) Preparamos tokens de existentes
      const existingTokens = existingReqs.map((r) =>
        textToTokens(`${r.title} ${r.body ?? ""}`)
      );

      // 🔹 NUEVO: tokens solo del título
      const existingTitleTokens = existingReqs.map((r) =>
        textToTokens(r.title)
      );

      // Mapeo sugerencia -> índice de requisito existente; null si ninguno
      const dupExistingIdx: (number | null)[] = Array(enriched.length).fill(null);
      const toDrop = new Set<number>();

      // Umbrales
      const TITLE_JACCARD = 0.5;   // para títulos muy parecidos
      const JACCARD_EXISTING = 0.30; // para título+body (más laxo)

      for (let i = 0; i < enriched.length; i++) {
        const r = enriched[i];

        // Tokens solo del título y de título+body de la SUGERENCIA
        const suggTitleTokens = textToTokens(r.title);
        const suggAllTokens = textToTokens(`${r.title} ${r.body ?? ""}`);

        let bestIdx: number | null = null;
        let bestTitleJac = 0;
        let bestFullJac = 0;

        for (let j = 0; j < existingReqs.length; j++) {
          // 🔹 similitud SOLO de títulos
          const jacTitle = jaccardSimilarity(
            suggTitleTokens,
            existingTitleTokens[j]
          );

          // 🔹 similitud de título+body
          const jacFull = jaccardSimilarity(
            suggAllTokens,
            existingTokens[j]
          );

          if (jacTitle > bestTitleJac) {
            bestTitleJac = jacTitle;
            bestIdx = j;
          }
          if (jacFull > bestFullJac) {
            bestFullJac = jacFull;
            bestIdx = j;
          }
        }

        // Se considera duplicado si:
        // - títulos muy parecidos (≥ 0.5), o
        // - texto completo bastante parecido (≥ 0.30)
        if (
          bestIdx !== null &&
          (bestTitleJac >= TITLE_JACCARD || bestFullJac >= JACCARD_EXISTING)
        ) {
          dupExistingIdx[i] = bestIdx;
          toDrop.add(i);
        }
      }

      // 3) Embeddings solo para sugerencias que sobrevivieron al filtro léxico
      const indicesForEmbedding = enriched
        .map((_, idx) => idx)
        .filter((idx) => !toDrop.has(idx));

      if (indicesForEmbedding.length > 0) {
        const textsToEmbed: string[] = [
          // sugerencias supervivientes
          ...indicesForEmbedding.map((idx) => {
            const r = enriched[idx];
            return `${r.title}: ${r.body || ""}`;
          }),
          // requisitos existentes
          ...existingReqs.map((r) => `${r.title}: ${r.body || ""}`),
        ];

        const { vectors } = await embedText(textsToEmbed);

        if (Array.isArray(vectors) && vectors.length === textsToEmbed.length) {
          const suggestionVectors = vectors.slice(0, indicesForEmbedding.length);
          const existingVectors = vectors.slice(indicesForEmbedding.length);

          const TH_EXISTING = 0.78; // más bajo para atrapar parafraseos

          indicesForEmbedding.forEach((origIdx, pos) => {
            const vS = suggestionVectors[pos];
            let bestIdx: number | null = null;
            let bestSim = 0;

            for (let j = 0; j < existingReqs.length; j++) {
              const sim = cosineSimilarity(vS, existingVectors[j]);
              if (sim > bestSim) {
                bestSim = sim;
                bestIdx = j;
              }
            }

            if (bestIdx !== null && bestSim >= TH_EXISTING) {
              dupExistingIdx[origIdx] = bestIdx;
              toDrop.add(origIdx);
            }
          });
        }
      }

      // 4) Aplicar filtro y añadir flags
      const withIndex = enriched.map((r, idx) => ({ r, idx }));
      const filteredWithIndex =
        toDrop.size > 0
          ? withIndex.filter(({ idx }) => !toDrop.has(idx))
          : withIndex;

      const base =
        filteredWithIndex.length > 0 ? filteredWithIndex : withIndex;

      enriched = base.map(({ r, idx }) => {
        const dupIdx = dupExistingIdx[idx];
        const dupReq = dupIdx != null ? existingReqs[dupIdx] : null;

        return {
          ...r,
          isDuplicateOfExisting: !!dupReq,
          duplicateOfExistingId: dupReq?.id ?? null,
          duplicateOfExistingTitle: dupReq?.title ?? null,
        };
      });
    }
  } catch (e) {
    console.warn(
      "[requirements/:rfpId/suggest] detección de redundancia emb/jaccard falló:",
      e
    );
    // si falla, devolvemos mixed tal cual
    enriched = mixed;
  }

  return res.json(enriched);
});

// ====== ✔️ VALIDADORES ======
const UpdateReq = z.object({
  title: z.string().min(3).optional(),
  body: z.string().min(3).optional(),
  type: z.enum(["functional", "nonfunctional"]).optional(),
  category: z.enum(["wont", "would", "could", "should"]).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const BulkReq = z.object({
  ids: z.array(z.string().min(8)).min(1),
  action: z.enum(["setCategory", "archive", "unarchive"]),
  category: z
    .string()
    .refine((v) => isMoscow(String(v || "").toLowerCase()))
    .optional(),
});

// ====== 📄 LISTAR (evitamos colisión usando /list/:rfpId) ======
router.get("/list/:rfpId", async (req: Request, res: Response) => {
  const { rfpId } = req.params;
  const { status, moduleId } = req.query as any;

  const where: any = { rfpId };
  if (status) where.status = String(status);
  if (moduleId) where.moduleId = String(moduleId);

  const rows = await prisma.requirement.findMany({
    where,
    orderBy: [{ createdAt: "asc" }],
  });
  res.json(rows);
});

// ====== ✏️ UPDATE PARCIAL ======
router.patch("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = UpdateReq.parse(req.body);

  // Normalizamos moscow si vino
  if (data.category) {
    data.category = String(data.category).toLowerCase() as any;
  }

  const updated = await prisma.requirement.update({
    where: { id },
    data,
  });
  res.json(updated);
});

// ====== 🗂️ ARCHIVAR / DESARCHIVAR ======
router.post("/:id/archive", async (req: Request, res: Response) => {
  const { id } = req.params;
  const updated = await prisma.requirement.update({
    where: { id },
    data: { status: "archived" },
  });
  res.json(updated);
});

router.post("/:id/unarchive", async (req: Request, res: Response) => {
  const { id } = req.params;
  const updated = await prisma.requirement.update({
    where: { id },
    data: { status: "active" },
  });
  res.json(updated);
});

// ====== 📦 BULK ACTIONS (MoSCoW / archive) ======
router.post("/bulk", async (req: Request, res: Response) => {
  const { ids, action, category } = BulkReq.parse(req.body);

  if (action === "setCategory") {
    const cat = String(category).toLowerCase() as any;
    const r = await prisma.requirement.updateMany({
      where: { id: { in: ids } },
      data: { category: cat },
    });
    return res.json({ updated: r.count, category: cat });
  }

  if (action === "archive") {
    const r = await prisma.requirement.updateMany({
      where: { id: { in: ids } },
      data: { status: "archived" },
    });
    return res.json({ archived: r.count });
  }

  if (action === "unarchive") {
    const r = await prisma.requirement.updateMany({
      where: { id: { in: ids } },
      data: { status: "active" },
    });
    return res.json({ unarchived: r.count });
  }

  return res.status(400).json({ error: "unknown action" });
});

// ====== ☑️ CHECKLIST (agrupa por MoSCoW para plantilla) ======
router.get("/checklist/:rfpId", async (req: Request, res: Response) => {
  const { rfpId } = req.params;
  const status = (req.query.status as string) || "active";

  const items = await prisma.requirement.findMany({
    where: { rfpId, status },
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
  });

  const out: Record<"wont"|"would"|"could"|"should", any[]> = {
    wont: [], would: [], could: [], should: [],
  };

  for (const r of items) {
    const cat = (String(r.category || "should").toLowerCase() as keyof typeof out);
    if (!out[cat]) out["should"].push(r);
    else out[cat].push(r);
  }

  const counts = Object.fromEntries(
    Object.entries(out).map(([k, v]) => [k, (v as any[]).length])
  );

  res.json({ counts, items: out });
});


const CreateItem = z.object({
  title: z.string().min(3),
  body: z.string().min(3),
  type: z.enum(["functional", "nonfunctional"]),
  category: z.string().optional(),   // wont|would|could|should
  moduleKey: z.string().optional(),  // para asociar con un módulo del RFP (si existe)
});

router.post("/bulk-create", async (req: Request, res: Response) => {
  const { rfpId, items } = z.object({
    rfpId: z.string(),
    items: z.array(CreateItem).min(1),
  }).parse(req.body);

  // Normaliza MoSCoW: default = "should"
  const norm = (v?: string) =>
    (isMoscow(String(v || "").toLowerCase()) ? String(v).toLowerCase() : "should") as any;

  // Resuelve moduleKey -> moduleId (módulos elegidos para este RFP)
  const modules = await prisma.module.findMany({ where: { rfpId } });
  const byKey = new Map(modules.map((m) => [m.key, m.id]));

  const data = items.map((it) => ({
    rfpId,
    title: it.title,
    body: it.body,
    type: it.type,
    category: norm(it.category),
    moduleId: it.moduleKey ? byKey.get(it.moduleKey) ?? null : null,
  }));

  const created = await prisma.$transaction(
    data.map((d) => prisma.requirement.create({ data: d }))
  );

  res.status(201).json(created);
});

router.post(
  "/ai-suggest",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      if (!LLM_KEY) {
        return res.status(500).json({
          error: "OPENROUTER_API_KEY no está configurada",
        });
      }

      const parsed = AiSuggestBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const { rfpId, modules, context, language } = parsed.data;
      const lang = language || "es";

      const user = (req as any).user;
      const userId = user?.id as string | undefined;

      const rfp = await prisma.rfp.findUnique({
        where: { id: rfpId },
        select: { id: true, title: true, ownerId: true },
      });

      if (!rfp) {
        return res.status(404).json({ error: "RFP no encontrada" });
      }

      if (rfp.ownerId && userId && rfp.ownerId !== userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // 🔑 mapas para forzar key coherente con los módulos de entrada
      const moduleKeyByName = new Map(
        modules.map((m) => [m.name.toLowerCase(), m.key])
      );
      const moduleNameByKey = new Map(
        modules.map((m) => [m.key, m.name])
      );

      const ctxLines: string[] = [];
      if (context?.companyName)
        ctxLines.push(`Empresa: ${context.companyName}`);
      if (context?.industry)
        ctxLines.push(`Industria: ${context.industry}`);
      if (context?.objectives)
        ctxLines.push(`Objetivos: ${context.objectives}`);
      if (context?.pains)
        ctxLines.push(`Dolores: ${context.pains}`);
      if (context?.integrations)
        ctxLines.push(`Integraciones: ${context.integrations}`);
      if (context?.volume)
        ctxLines.push(`Volumen esperado: ${context.volume}`);
      if (context?.otherNotes)
        ctxLines.push(`Notas adicionales: ${context.otherNotes}`);

      const modulesText = modules
        .map(
          (m) =>
            `- key: "${m.key}", nombre: "${m.name}"` +
            (m.description ? `, descripción: ${m.description}` : "")
        )
        .join("\n");

      const allowedKeys = modules.map((m) => `"${m.key}"`).join(", ");

      const userPrompt = `
Genera requisitos de un RFP en formato JSON para el RFP "${rfp.title}".

Contexto del cliente:
${ctxLines.join("\n") || "(sin información adicional)"}

Módulos seleccionados:
${modulesText}

Para cada módulo, propone entre 3 y 8 requisitos. Cada requisito debe tener:
- title: resumen corto
- body: descripción clara, orientada a negocio
- type: "functional" o "nonfunctional"
- category: uno de "wont","would","could","should" (MoSCoW)

FORMATO DE RESPUESTA (MUY IMPORTANTE):
- Responde SOLO con JSON, SIN \`\`\` ni texto adicional.
- La propiedad "modules" debe ser un array.
- Para cada módulo, la propiedad "key" DEBE ser EXACTAMENTE uno de estos valores: ${allowedKeys}
- No traduzcas ni cambies los valores de "key". Usa siempre el mismo "key" que recibiste de entrada.

Ejemplo de estructura:

{
  "modules": [
    {
      "key": "pagos",
      "name": "Pagos y conciliación",
      "requirements": [
        {
          "title": "El sistema debe registrar pagos",
          "body": "Descripción...",
          "type": "functional",
          "category": "should"
        }
      ]
    }
  ]
}

Idioma de title y body: ${lang === "es" ? "español" : "inglés"}.
`;

      const body = {
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Eres un analista de negocio senior experto en redacción de requisitos de RFP. Sigues estrictamente el formato JSON solicitado.",
          },
          { role: "user", content: userPrompt },
        ],
      };

      const resp = await fetch(`${LLM_BASE}/chat/completions`, {
        method: "POST",
        headers: llmHeaders(),
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        return res.status(502).json({
          error: "Error al llamar a la IA",
          detail: text,
        });
      }

            const json = await resp.json();
      let content = json?.choices?.[0]?.message?.content;

      if (!content || typeof content !== "string") {
        return res.status(502).json({ error: "Respuesta IA vacía" });
      }

      content = content.trim();

      // 1) limpiar fences ```json ... ``` si vienen
      const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenceMatch && fenceMatch[1]) {
        content = fenceMatch[1].trim();
      }

      let parsedJson: any;
      try {
        // intento directo
        parsedJson = JSON.parse(content);
      } catch {
        // 2) fallback: recortar desde el primer '{' hasta el último '}'
        const first = content.indexOf("{");
        const last  = content.lastIndexOf("}");

        if (first === -1 || last === -1 || last <= first) {
          return res.status(502).json({
            error: "La IA no devolvió JSON válido",
            raw: content,
          });
        }

        const slice = content.slice(first, last + 1);
        try {
          parsedJson = JSON.parse(slice);
          content = slice;
        } catch {
          return res.status(502).json({
            error: "La IA no devolvió JSON válido",
            raw: content,
            cleaned: slice,
          });
        }
      }


      // 👇 módulos tal como los devolvió la IA
      const outModules = Array.isArray(parsedJson.modules)
        ? parsedJson.modules
        : [];

      // 1) Normalizamos la salida de la IA → estructura interna
      const suggestions = outModules
        .map((m: any, idx: number) => {
          const original = modules[idx]; // módulo original del body

          const key = original?.key || String(m.key || "");
          const name = original?.name || String(m.name || "");

          const reqs = Array.isArray(m.requirements) ? m.requirements : [];

          return {
            key,
            name,
            requirements: reqs.map((r: any) => ({
              title: String(r.title || "").slice(0, 200),
              body: String(r.body || "").slice(0, 2000),
              type: r.type === "nonfunctional" ? "nonfunctional" : "functional",
              category: normalizeCategory(r.category),
            })),
          };
        })
        .filter((m: any) => m.key && m.name);

      // 2) 🔍 DEDUP GLOBAL: contra TODO el RFP y dentro del mismo batch
      try {
        // 2.1 Cargamos TODOS los requisitos activos del RFP
        const existingReqs = await prisma.requirement.findMany({
          where: { rfpId, status: "active" },
          select: { id: true, title: true, body: true },
        });

        // Tokens título + body (más laxo)
        const existingTokens = existingReqs.map((r) =>
          textToTokens(`${r.title} ${r.body ?? ""}`)
        );

        // Tokens SOLO de título (para no diluir la similitud)
        const existingTitleTokens = existingReqs.map((r) =>
          textToTokens(r.title)
        );

        // Títulos normalizados para match exacto
        const existingTitleNorm = new Set(
          existingReqs.map((r) => normalizeText(r.title))
        );

        // Umbrales (más agresivos)
        const TITLE_JACCARD   = 0.5;  // títulos muy parecidos
        const JACCARD_EXISTING = 0.28; // texto completo bastante parecido
        const JACCARD_WITHIN   = 0.65; // dentro del mismo batch

        // 2.2 Limpiamos cada módulo sugerido
        for (const mod of suggestions) {
          const keep: typeof mod.requirements = [];
          const keepTokens: string[][] = [];
          const keepTitleTokens: string[][] = [];
          const keepTitleNorm: string[] = [];

          for (const req of mod.requirements) {
            const rawTitle = req.title || "";
            const rawBody  = req.body  || "";

            const titleNorm   = normalizeText(rawTitle);
            const titleTokens = textToTokens(rawTitle);
            const allTokens   = textToTokens(`${rawTitle} ${rawBody}`);

            // (a) título exactamente igual a uno ya guardado
            if (titleNorm && existingTitleNorm.has(titleNorm)) {
              continue;
            }

            // (b) ¿muy parecido a ALGÚN requisito ya guardado en el RFP?
            let isDupExisting = false;
            for (let j = 0; j < existingReqs.length; j++) {
              const jacTitle = jaccardSimilarity(
                titleTokens,
                existingTitleTokens[j]
              );
              const jacFull = jaccardSimilarity(
                allTokens,
                existingTokens[j]
              );

              if (jacTitle >= TITLE_JACCARD || jacFull >= JACCARD_EXISTING) {
                isDupExisting = true;
                break;
              }
            }
            if (isDupExisting) continue;

            // (c) ¿duplicado respecto a OTRA sugerencia ya aceptada en este batch?
            let isDupWithin = false;
            for (let j = 0; j < keep.length; j++) {
              // título igual
              if (titleNorm && keepTitleNorm[j] === titleNorm) {
                isDupWithin = true;
                break;
              }

              const jacTitle = jaccardSimilarity(
                titleTokens,
                keepTitleTokens[j]
              );
              const jacFull = jaccardSimilarity(
                allTokens,
                keepTokens[j]
              );

              if (jacTitle >= TITLE_JACCARD || jacFull >= JACCARD_WITHIN) {
                isDupWithin = true;
                break;
              }
            }
            if (isDupWithin) continue;

            // (d) Si pasó todos los filtros, lo mantenemos
            keep.push(req);
            keepTokens.push(allTokens);
            keepTitleTokens.push(titleTokens);
            keepTitleNorm.push(titleNorm);
          }

          mod.requirements = keep;
        }
      } catch (e) {
        console.warn("[requirements/ai-suggest] deduplicación global falló:", e);
        // si algo peta, seguimos devolviendo las sugerencias sin filtrar
      }

      const total = suggestions.reduce(
        (acc: number, m: any) => acc + m.requirements.length,
        0
      );

      return res.json({
        ok: true,
        rfpId,
        model: LLM_MODEL,
        count: total,
        modules: suggestions,
      });
    } catch (err) {
      console.error("ai-suggest error", err);
      return res.status(500).json({ error: "ERR_AI_SUGGEST" });
    }
  }
);



// ====== IA: REESCRIBIR UN REQUISITO ======
const RephraseReq = z.object({
  title: z.string().min(3),
  body: z.string().min(10),
  language: z.enum(["es", "en"]).optional(),
});

router.post("/ai-rephrase", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!LLM_KEY) {
      return res.status(500).json({ error: "OPENROUTER_API_KEY no está configurada" });
    }

    const parsed = RephraseReq.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { title, body, language } = parsed.data;
    const lang = language || "es";

    const userPrompt = `
Mejora la redacción de este requisito manteniendo el mismo significado.

Devuelve SOLO JSON:

{
  "title": "nuevo título",
  "body": "nueva descripción mejorada"
}

Requisito original:
Título: ${title}
Descripción: ${body}

Idioma: ${lang === "es" ? "español" : "inglés"}.
    `;

    const resp = await fetch(`${LLM_BASE}/chat/completions`, {
      method: "POST",
      headers: llmHeaders(),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Eres un analista de negocio experto en redacción clara de requisitos de RFP. Respondes solo con JSON válido.",
          },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(502).json({ error: "Error al llamar a la IA", detail: text });
    }

    const json = await resp.json();
    let content = json?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return res.status(502).json({ error: "Respuesta IA vacía" });
    }

    content = content.trim();
    if (content.startsWith("```")) {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (match) content = match[1].trim();
    }

    let out: any;
    try {
      out = JSON.parse(content);
    } catch {
      return res.status(502).json({ error: "La IA no devolvió JSON válido", raw: content });
    }

    return res.json({
      title: String(out.title || title),
      body: String(out.body || body),
    });
  } catch (err) {
    console.error("ai-rephrase error", err);
    return res.status(500).json({ error: "ERR_AI_REPHRASE" });
  }
});

export default router;
