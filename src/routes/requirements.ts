import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { isMoscow } from "../lib/moscow";
import { suggestRequirements } from "../services/ai";
import { requireAuth } from "../middleware/auth";

const router = Router();

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
  items: z.array(z.object({
    rfpId: z.string(),
    moduleKey: z.string().optional(),
    title: z.string().min(3),
    body: z.string().min(3),
    type: z.enum(["functional","nonfunctional"]),
    category: z.enum(["wont","would","could","should"]).default("should"),
  })).min(1).max(200),
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
router.get("/list", requireAuth, async (req, res) => {
  const rfpId = String(req.query.rfpId || "").trim();
  const status = String(req.query.status || "").trim(); // opcional
  if (!rfpId) return res.status(400).json({ error: "rfpId es requerido" });

  const where: any = { rfpId };
  if (status) where.status = status;

  const items = await prisma.requirement.findMany({
    where,
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, title: true, type: true, category: true, status: true, moduleId: true },
  });

  res.json({ rfpId, count: items.length, items });
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
router.post("/", async (req: Request, res: Response) => {
  const body = CreateReq.parse(req.body);
  const item = await prisma.requirement.create({ data: body });
  res.status(201).json(item);
});

// PATCH /requirements/:id
router.patch("/:id", async (req: Request, res: Response) => {
  const patch = UpdateReq.parse(req.body);
  const item = await prisma.requirement.update({ where: { id: req.params.id }, data: patch });
  res.json(item);
});

// DELETE /requirements/:id  (archiva)
router.delete("/:id", async (req: Request, res: Response) => {
  await prisma.requirement.update({ where: { id: req.params.id }, data: { status: "archived" }});
  res.json({ ok: true });
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
      where: { unique_per_rfp: { rfpId: it.rfpId, title: it.title, type: it.type } },
      update: { body: it.body, category: it.category, moduleId },
      create: { rfpId: it.rfpId, title: it.title, body: it.body, type: it.type, category: it.category, moduleId },
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
router.post("/:rfpId/suggest", async (req: Request, res: Response) => {
  const { rfpId } = req.params;
  const { moduleKey, moduleName } = z.object({
    moduleKey: z.string(),
    moduleName: z.string(),
  }).parse(req.body);

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
  return res.json(mixed);
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

// GET /requirements/list?rfpId=...&status=active|archived
router.get("/list", requireAuth, async (req, res) => {
  const rfpId = String(req.query.rfpId || "").trim();
  const status = String(req.query.status || "").trim(); // opcional
  if (!rfpId) return res.status(400).json({ error: "rfpId es requerido" });

  const where: any = { rfpId };
  if (status) where.status = status;

  const rows = await prisma.requirement.findMany({
    where,
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, title: true, category: true, status: true, type: true }
  });
  res.json({ rfpId, count: rows.length, items: rows });
});


export default router;
