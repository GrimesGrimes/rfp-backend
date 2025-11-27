import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { embedText } from "../lib/embedding";
import { randomUUID } from "crypto";
import { requireAuth } from "../middleware/auth";
import {
  chat,
  ChatMessage,
  generateRfpSection,
  RfpSectionKey,
  RfpAiInput,
} from "../services/ai";

const router = Router();



/** ==== Schemas ==== */
const CreateRfp = z.object({
  title: z.string().min(3),
  companyName: z.string().optional(),
  introFormal: z.string().optional(),
  objetivos: z.string().optional(),
  dolores: z.string().optional(),
  integraciones: z.string().optional(),
  volumen: z.string().optional(),
  content: z.string().optional(),
  elementosPrevios: z.string().optional(),
  necesidadesCuantificadas: z.string().optional(),
  aspectosGenerales: z.string().optional(),
  calendarioPrevisto: z.string().optional(),
  dataJson: z.any().optional(), // legacy / compat
});


const UpdateRfp = z.object({
  title: z.string().min(3).optional(),
  dataJson: z.any().optional(),
});

const ListQuery = z.object({
  scope: z.enum(["mine", "all"]).optional(),
});

/** ==== Helpers ==== */
function ensureAuth(req: Request, res: Response): string | undefined {
  const u: any = (req as any).user;
  const userId = u?.sub ?? u?.id;
  if (!userId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  return String(userId);
}

/** ==== Crear RFP ==== */
// POST /rfp
/** ==== Crear RFP ==== */
// POST /rfp
router.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.sub as string | undefined;
    if (!userId) return;

    const {
      title,
      companyName,
      introFormal,
      objetivos,
      dolores,
      integraciones,
      volumen,
      content,
      elementosPrevios,
      necesidadesCuantificadas,
      aspectosGenerales,
      calendarioPrevisto,
      dataJson,
    } = CreateRfp.parse(req.body);

    const baseJson: any = dataJson ?? {};

    const rfp = await prisma.rfp.create({
      data: {
        title,
        ownerId: userId,

        // columnas "planas" — usan lo que venga directo o lo que venga dentro de dataJson
        companyName: companyName ?? baseJson.companyName ?? null,
        introFormal: introFormal ?? baseJson.introFormal ?? null,
        objetivos: objetivos ?? baseJson.objetivos ?? null,
        dolores: dolores ?? baseJson.dolores ?? null,
        integraciones: integraciones ?? baseJson.integraciones ?? null,
        volumen: volumen ?? baseJson.volumen ?? null,
        content: content ?? baseJson.content ?? null,
        elementosPrevios:
          elementosPrevios ?? baseJson.elementosPrevios ?? null,
        necesidadesCuantificadas:
          necesidadesCuantificadas ??
          baseJson.necesidadesCuantificadas ??
          null,
        aspectosGenerales:
          aspectosGenerales ?? baseJson.aspectosGenerales ?? null,
        calendarioPrevisto:
          calendarioPrevisto ?? baseJson.calendarioPrevisto ?? null,

        // seguimos guardando TODO el JSON por compatibilidad
        dataJson: baseJson,
      },
    });

    // Construimos contenido inicial de sección a partir del brief para poder indexar algo
    const d: any = {
      ...baseJson,
      objetivos: objetivos ?? baseJson.objetivos,
      dolores: dolores ?? baseJson.dolores,
      integraciones: integraciones ?? baseJson.integraciones,
      volumen: volumen ?? baseJson.volumen,
      content: content ?? baseJson.content,
    };

    const contentParts: string[] = [];
    if (d.objetivos) contentParts.push(`Objetivos: ${d.objetivos}`);
    if (d.dolores) contentParts.push(`Dolores: ${d.dolores}`);
    if (d.integraciones)
      contentParts.push(`Integraciones: ${d.integraciones}`);
    if (d.volumen) contentParts.push(`Volumen: ${d.volumen}`);
    if (d.content) contentParts.push(`Contenido: ${d.content}`);

    const sectionContent = contentParts.join("\n") || JSON.stringify(d);

    // Creamos la primera sección (index 0)
    const section = await prisma.rfpSection.create({
      data: { rfpId: rfp.id, index: 0, content: sectionContent },
    });

    // Embedding de esa sección (opcional)
    try {
      const { vectors, model, dim } = await embedText(sectionContent);
      const vec = vectors[0] ?? [];
      if (vec.length) {
        const vectorString = `[${vec.join(",")}]`;
        await prisma.$executeRaw`
          INSERT INTO "RfpEmbedding" ("id","sectionId","model","dim","chunkIndex","vector")
          VALUES (${randomUUID()}, ${section.id}, ${model}, ${dim}, ${0}, ${vectorString}::vector)
        `;
      }
    } catch (e) {
      console.error("embedding error:", e);
    }

    return res.status(201).json(rfp);
  } catch (e: any) {
    return res.status(400).json({ error: String(e?.message || e) });
  }
});


// PUT /rfp/:id
router.put("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = ensureAuth(req, res);
    if (!userId) return;

    const { id } = req.params;

    const {
      companyName,
      introFormal,
      objetivos,
      dolores,
      integraciones,
      volumen,
      content,
      elementosPrevios,
      necesidadesCuantificadas,
      aspectosGenerales,
      calendarioPrevisto,
      dataJson,
    } = req.body || {};

    const rfp = await prisma.rfp.findUnique({
  where: { id },
  select: {
    id: true,
    ownerId: true,
    title: true,
    dataJson: true,
    companyName: true,
    introFormal: true,
    objetivos: true,
    dolores: true,
    integraciones: true,
    volumen: true,
    content: true,
    elementosPrevios: true,
    necesidadesCuantificadas: true,
    aspectosGenerales: true,
    calendarioPrevisto: true,
  },
});

    if (!rfp) {
      return res.status(404).json({ error: "RFP not found" });
    }

    if (rfp.ownerId && rfp.ownerId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const mergedDataJson = {
      ...((rfp.dataJson || {}) as Record<string, any>),
      ...(dataJson || {}),
    };

    const updated = await prisma.rfp.update({
      where: { id },
      data: {
        ...(companyName !== undefined && { companyName }),
        ...(introFormal !== undefined && { introFormal }),
        ...(objetivos !== undefined && { objetivos }),
        ...(dolores !== undefined && { dolores }),
        ...(integraciones !== undefined && { integraciones }),
        ...(volumen !== undefined && { volumen }),
        ...(content !== undefined && { content }),
        ...(elementosPrevios !== undefined && { elementosPrevios }),
        ...(necesidadesCuantificadas !== undefined && {
          necesidadesCuantificadas,
        }),
        ...(aspectosGenerales !== undefined && { aspectosGenerales }),
        ...(calendarioPrevisto !== undefined && { calendarioPrevisto }),
        dataJson: mergedDataJson,
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error("PUT /rfp/:id error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});


// Listar RFPs del usuario autenticado
router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.sub; // Obtener el ID del usuario del token

    if (!userId) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    const rfps = await prisma.rfp.findMany({
      where: {
        ownerId: userId // Filtrar por el ID del usuario autenticado
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return res.json(rfps);
  } catch (error) {
    console.error("Error al listar RFPs:", error);
    return res.status(500).json({ error: "Error al listar RFPs" });
  }
});

/** ==== genera el Markdown con secciones + módulos + checklist MoSCoW ==== */
// GET /rfp/:id/export
router.get("/:id/export", requireAuth, async (req: Request, res: Response) => {
  const userId = ensureAuth(req, res);
  if (!userId) return;

  const { id } = req.params;

  // 1) Traer el RFP con secciones y módulos
  const rfp = await prisma.rfp.findFirst({
    where: {
      id,
      ownerId: userId,
    },
    include: {
      sections: {
        orderBy: { index: "asc" },
      },
      modules: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!rfp) {
    return res.status(404).json({ error: "RFP not found" });
  }

  // 2) Traer requisitos activos con módulo
  const requirements = await prisma.requirement.findMany({
    where: {
      rfpId: id,
      status: "active",
    },
    orderBy: [
      { category: "asc" },
      { createdAt: "asc" },
    ],
    select: {
      id: true,
      title: true,
      type: true,       // "functional" | "nonfunctional"
      category: true,   // "wont" | "would" | "could" | "should"
      body: true,
      moduleId: true,
    },
  });

  // 3) Mapa móduloId -> nombre
  const moduleById: Record<string, string> = {};
  for (const m of rfp.modules) {
    moduleById[m.id] = m.name || m.key || "";
  }

  // 4) Agrupar por MoSCoW
  const buckets: Record<"should" | "could" | "would" | "wont", typeof requirements> = {
    should: [],
    could: [],
    would: [],
    wont: [],
  };

  for (const r of requirements) {
    const cat = (r.category ?? "should") as "should" | "could" | "would" | "wont";
    buckets[cat].push(r);
  }

  // Helper para formatear contenido de secciones
  const formatSectionContent = (raw?: string | null): string => {
    const txt = String(raw || "").trim();
    if (!txt) return "(sin contenido)";

    // Si parece JSON de dataJson, intentamos mejorarlo
    if (txt.startsWith("{") && txt.endsWith("}")) {
      try {
        const obj = JSON.parse(txt);
        if (typeof obj.content === "string") {
          return obj.content;
        }
        const parts: string[] = [];
        if (obj.objetivos) parts.push(`Objetivos: ${obj.objetivos}`);
        if (obj.dolores) parts.push(`Dolores: ${obj.dolores}`);
        if (obj.integraciones) parts.push(`Integraciones: ${obj.integraciones}`);
        if (obj.volumen) parts.push(`Volumen: ${obj.volumen}`);
        if (parts.length) return parts.join("\n");
        return txt;
      } catch {
        return txt;
      }
    }

    return txt;
  };

  // 5) Construir Markdown
  const lines: string[] = [];

  lines.push(`# ${rfp.title}`);
  lines.push("");
  lines.push(`**Publicado:** ${rfp.isPublished ? "Sí" : "No"}  `);
  lines.push("");

  // Secciones
  lines.push("## Secciones");

  if (!rfp.sections.length) {
    lines.push("");
    lines.push("### Sección 0");
    lines.push("(sin contenido)");
  } else {
    for (const section of rfp.sections) {
      lines.push("");
      lines.push(`### Sección ${section.index}`);
      lines.push(formatSectionContent(section.content));
    }
  }

  // Checklist MoSCoW
  lines.push("");
  lines.push("## Checklist (MoSCoW)");

  const labels: Record<"should" | "could" | "would" | "wont", string> = {
    should: "SHOULD",
    could: "COULD",
    would: "WOULD",
    wont: "WONT",
  };

  (["should", "could", "would", "wont"] as const).forEach((cat) => {
    lines.push("");
    lines.push(`### ${labels[cat]}`);

    const items = buckets[cat];
    if (!items.length) {
      lines.push("");
      lines.push("_(sin requisitos en esta categoría)_");
    } else {
      for (const reqItem of items) {
        const kind = reqItem.type === "nonfunctional" ? "NF" : "F";
        const moduleName = reqItem.moduleId ? moduleById[reqItem.moduleId] : null;
        const modulePrefix = moduleName ? `[${moduleName}] ` : "";

        lines.push(`- [ ] (${kind}) ${modulePrefix}${reqItem.title}`);
        if (reqItem.body) {
          lines.push(`  - ${reqItem.body}`);
        }
      }
    }
  });

  const markdown = lines.join("\n");
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  return res.send(markdown);
});



/** ==== Obtener un RFP por id ==== */
// GET /rfp/:id
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = ensureAuth(req, res);
  if (!userId) return;
  
  const { id } = req.params;

  const rfp = await prisma.rfp.findUnique({
    where: { id },
  select: { id: true, ownerId: true, dataJson: true, title: true },
});

  if (!rfp) return res.status(404).json({ error: "RFP not found" });

  // si quieres restringir lectura a owner:
  // if (rfp.ownerId !== userId) return res.status(403).json({ error: "Forbidden" });

  res.json(rfp);
});

// ====== IA: SECCIONES DE RFP (INTRO, OBJETIVOS, SITUACIÓN, ETC.) ======

const AiSectionEnum = z.enum([
  "intro",       // Introducción formal
  "objectives",  // Objetivos del proceso de contratación
  "situation",   // Situación actual y futura
  "elements",    // 3.1 Elementos previos
  "needs",       // 3.2 Necesidades cuantificadas
  "aspects",     // 4.x Aspectos generales
  "schedule",    // 6 Calendario previsto
]);

type AiSection = z.infer<typeof AiSectionEnum>;

const AiSectionReq = z.object({
  rfpId: z.string().min(1),
  section: AiSectionEnum,
  draft: z.string().max(6000).optional(),          // texto escrito por el usuario (para mejorar)
  language: z.enum(["es", "en"]).optional(),
});

type RfpContext = {
  title: string;
  company: string;
  content: string;
  objetivos: string;
  dolores: string;
  volumen: string;
  integraciones: string;
};

async function getRfpContext(rfpId: string): Promise<RfpContext> {
  const rfp = await prisma.rfp.findUnique({ where: { id: rfpId } });
  if (!rfp) throw new Error("RFP no encontrado");

  const data: any = (rfp as any).dataJson || {};

  return {
    title: rfp.title,
    company:
      (rfp as any).companyName ??
      data.companyName ??
      "",
    content: (rfp as any).content ?? data.content ?? "",
    objetivos: (rfp as any).objetivos ?? data.objetivos ?? "",
    dolores: (rfp as any).dolores ?? data.dolores ?? "",
    volumen: (rfp as any).volumen ?? data.volumen ?? "",
    integraciones:
      (rfp as any).integraciones ?? data.integraciones ?? "",
  };
}



function looseJsonObject(raw: string): any | null {
  if (!raw) return null;
  let t = raw.trim();
  if (t.startsWith("```")) {
    const match = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) t = match[1].trim();
  }
  try {
    const obj = JSON.parse(t);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function buildSectionPrompt(
  section: AiSection,
  ctx: RfpContext,
  draft: string | undefined,
  lang: "es" | "en",
): string {
  const idioma = lang === "en" ? "inglés" : "español";

  const baseContext = `
Datos del RFP:
- Empresa: ${ctx.company || "N/D"}
- Título del RFP: ${ctx.title}
- Contexto general: ${ctx.content}
- Problemas / dolores: ${ctx.dolores}
- Objetivos: ${ctx.objetivos}
- Volumen / escala: ${ctx.volumen}
- Integraciones: ${ctx.integraciones}
`;

  switch (section) {
    case "intro":
      return `
Redacta una INTRODUCCIÓN formal para un documento de Request for Proposal (RFP).
Debe ser breve (1–3 párrafos), profesional y directa.

${baseContext}

Devuelve SOLO JSON:
{
  "content": "texto completo de la introducción"
}

Idioma: ${idioma}.
`;
    case "objectives":
      return `
Redacta el apartado "Objetivos del proceso de contratación" de un RFP.
Usa tono formal y orientado a negocio. Estructura en 2–3 párrafos claros.

${baseContext}

Devuelve SOLO JSON:
{
  "content": "texto completo del apartado de objetivos"
}

Idioma: ${idioma}.
`;
    case "situation":
      return `
Redacta el apartado "Descripción de la situación actual y futura" de un RFP.
Combina la situación actual, los problemas y los objetivos deseados.
Incluye tanto retos presentes como visión futura.

${baseContext}

Devuelve SOLO JSON:
{
  "content": "texto completo del apartado de situación actual y futura"
}

Idioma: ${idioma}.
`;
    case "elements":
      return `
Sugiere elementos previos a tener en cuenta (apartado 3.1 de un RFP).
Piensa en peculiaridades de la empresa, dependencias, restricciones y riesgos.

${baseContext}

Devuelve SOLO JSON:
{
  "bullets": [
    "primer elemento...",
    "segundo elemento..."
  ]
}

Devuelve entre 5 y 8 bullets. Idioma: ${idioma}.
`;
    case "needs":
      return `
Sugiere necesidades cuantificadas (apartado 3.2 de un RFP).
Describe servicios o capacidades y su evolución en los próximos 2–3 años.

${baseContext}

Devuelve SOLO JSON:
{
  "rows": [
    {
      "service": "nombre del servicio",
      "specs": "especificaciones breves",
      "year1": "cantidad aproximada año 1",
      "year2": "cantidad aproximada año 2",
      "year3": "cantidad aproximada año 3"
    }
  ]
}

Incluye 3 a 6 filas. Idioma: ${idioma}.
`;
    case "aspects":
      if (draft && draft.trim()) {
        return `
Mejora la redacción del apartado "Aspectos generales" de un RFP.
Mantén el significado pero hazlo más claro, formal y estructurado.

Texto original:
${draft}

${baseContext}

Devuelve SOLO JSON:
{
  "content": "versión mejorada del texto"
}

Idioma: ${idioma}.
`;
      }
      return `
Redacta un borrador para el apartado "Aspectos generales" de un RFP.
Incluye 3 bloques: regulación del proceso de cambio de proveedor, proceso de portabilidad (si aplica) y servicios asociados a la explotación.

${baseContext}

Devuelve SOLO JSON:
{
  "content": "texto completo del apartado de aspectos generales"
}

Idioma: ${idioma}.
`;
    case "schedule":
      return `
Propón un calendario previsto para el proceso de un RFP de software.

${baseContext}

Define hitos como:
- Firma de NDA
- Confirmación de recepción de pliegos
- Preguntas y respuestas
- Presentación de propuestas
- Ronda de aclaraciones / segunda propuesta
- Decisión final
- Firma de contrato
- Inicio de servicio

Devuelve SOLO JSON:
{
  "milestones": [
    {
      "name": "nombre del hito",
      "description": "breve explicación",
      "daysFromStart": 0,
      "responsible": "rol responsable dentro de la empresa"
    }
  ]
}

daysFromStart es un entero (0 para el inicio, 7, 14, 30, etc.).
Incluye entre 6 y 12 hitos. Idioma: ${idioma}.
`;
    default:
      return "";
  }
}

// Endpoint para generación de secciones de RFP v2
router.post(
  "/:rfpId/ai-:section",
  requireAuth,
  async (req, res, next) => {
    try {
      const { rfpId, section } = req.params as {
        rfpId: string;
        section: RfpSectionKey;
      };

      // Validar sección
      const allowed: RfpSectionKey[] = [
        "intro",
        "objectives",
        "situation",
        "elements",
        "needs",
        "general",
        "calendar",
      ];
      if (!allowed.includes(section)) {
        return res.status(400).json({ error: "Sección de IA no soportada" });
      }

      // Cargar RFP con módulos / requisitos
      const rfp = await prisma.rfp.findUnique({
        where: { id: rfpId },
        include: {
          modules: {
            include: { requirements: true },
          },
        },
      });

      if (!rfp) {
        return res.status(404).json({ error: "RFP no encontrada" });
      }

      // Transform database result to match AI service interface
      const rfpAiInput: RfpAiInput = {
        companyName: rfp.companyName || undefined,
        name: rfp.title,
        title: rfp.title,
        objectives: rfp.objetivos || undefined,
        dolores: rfp.dolores || undefined,
        description: rfp.content || undefined,
        scope: rfp.volumen || undefined,
        modules: rfp.modules.map(module => ({
          name: module.name || undefined,
          description: module.description || undefined,
          fechaBase: rfp.createdAt.toISOString().slice(0, 10), // "YYYY-MM-DD"
        })),
      };

      const text = await generateRfpSection(section, rfpAiInput);
      res.json({ text });
    } catch (err) {
      next(err);
    }
  }
);

// Endpoint legacy para compatibilidad
router.post("/rfp/ai-section", requireAuth, async (req, res) => {
  try {
    const parsed = AiSectionReq.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { rfpId, section, draft, language } = parsed.data;
    const lang: "es" | "en" = language || "es";

    const ctx = await getRfpContext(rfpId);

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "Eres un consultor experto en redacción de RFP de software. Siempre respondes con JSON válido y nada más.",
      },
      { role: "user", content: buildSectionPrompt(section, ctx, draft, lang) },
    ];

    const raw = await chat(messages, 0.1);
    const obj = looseJsonObject(raw);

    if (!obj) {
      return res
        .status(502)
        .json({ error: "La IA no devolvió JSON válido", raw });
    }

    return res.json(obj);
  } catch (err) {
    console.error("rfp/ai-section error", err);
    return res.status(500).json({ error: "ERR_RFP_AI_SECTION" });
  }
});

// ===== Vista previa (datos normalizados para UI y export) =====
// GET /rfp/:id/preview-data
// ===== Vista previa RFP (datos para preview / export) =====
router.get(
  "/:id/preview-data",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const userId = ensureAuth(req, res);
      if (!userId) return;

      const { id } = req.params;

      const rfp = await prisma.rfp.findFirst({
        where: { id, ownerId: userId },
        include: {
          modules: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!rfp) {
        return res.status(404).json({ error: "RFP not found" });
      }

      const data: any = (rfp as any).dataJson || {};

      const companyName =
        (rfp as any).companyName ??
        data.companyName ??
        rfp.title;

      const objetivos =
        (rfp as any).objetivos ??
        data.objetivos ??
        "";

      const context =
        (rfp as any).content ??
        data.content ??
        "";

      const integraciones =
        (rfp as any).integraciones ??
        data.integraciones ??
        "";

      const calendarioPrevisto =
        (rfp as any).calendarioPrevisto ??
        data.calendarioPrevisto ??
        "";

      const requirements = await prisma.requirement.findMany({
        where: { rfpId: id, status: "active" },
        orderBy: [{ type: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          body: true,
          type: true,
          category: true,
          moduleId: true,
        },
      });

      const moduleById: Record<string, string> = {};
      for (const m of rfp.modules) {
        moduleById[m.id] = m.name || m.key || "";
      }

      const toPriority = (cat: string | null) => {
        const c = String(cat || "").toLowerCase();
        if (c === "should") return "Must";
        if (c === "could") return "Could";
        if (c === "would") return "Would";
        if (c === "wont") return "Wont";
        return "";
      };

      const functionals = requirements
        .filter((r) => r.type === "functional")
        .map((r, idx) => ({
          code: `RF-${String(idx + 1).padStart(3, "0")}`,
          module: r.moduleId ? moduleById[r.moduleId] || "" : "",
          title: r.title,
          priority: toPriority(r.category as any),
          body: r.body,
        }));

      const nonFunctionals = requirements
        .filter((r) => r.type === "nonfunctional")
        .map((r) =>
          
          r.body ? `${r.title}: ${r.body}` : r.title
        );

      const scheduleLines = String(calendarioPrevisto || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      return res.json({
        header: {
          title: rfp.title,
          companyName,
        },
        sections: {
          scope: objetivos,
          context,
          functionals,
          nonFunctionals,
          integrations: integraciones,
          deliverables: [
            "Plan de proyecto",
            "Prototipo o demo",
            "Documento RFP final",
          ],
          schedule: scheduleLines,
        },
      });
    } catch (err) {
      console.error("GET /rfp/:id/preview-data error", err);
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
