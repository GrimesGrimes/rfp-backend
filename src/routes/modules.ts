import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { suggestModules } from "../services/ai";


const router = Router();

const AddModules = z.object({
  rfpId: z.string(),
  selected: z.array(z.object({
    key: z.string().min(2),
    name: z.string().min(2),
    description: z.string().optional(),
  })),
});

// GET /modules/:rfpId
router.get("/:rfpId", async (req: Request, res: Response) => {
  const { rfpId } = req.params;
  const list = await prisma.module.findMany({ where: { rfpId } });
  res.json(list);
});

// POST /modules
router.post("/", async (req: Request, res: Response) => {
  const body = AddModules.parse(req.body);
  const created = await prisma.$transaction(
    body.selected.map(m =>
      prisma.module.create({ data: { rfpId: body.rfpId, key: m.key, name: m.name, description: m.description }})
    )
  );
  res.status(201).json(created);
});

// DELETE /modules/:moduleId
router.delete("/:moduleId", async (req: Request, res: Response) => {
  await prisma.module.delete({ where: { id: req.params.moduleId } });
  res.json({ ok: true });
});

// POST /modules/:rfpId/suggest
router.post("/:rfpId/suggest", async (req: Request, res: Response) => {
  const { rfpId } = req.params;

  const rfp = await prisma.rfp.findUnique({ where: { id: rfpId }});
  if (!rfp) return res.status(404).json({ error: "RFP not found" });

  const d: any = rfp.dataJson || {};
  const ctx = {
    objetivos: (d.objetivos || "").toString(),
    dolores: (d.dolores || "").toString(),
    integraciones: (d.integraciones || "").toString(),
    volumen: (d.volumen || "").toString(),
  };

  // 1) Traemos TODO lo que haya en la librería (si está vacía, seguimos igual con catálogo curado)
  const libMods = await prisma.libraryModule.findMany({
    orderBy: { createdAt: "asc" },
  });

  // 2) Intento IA (opcional) — le damos un boost si coincide
  let fromAI: Array<{ key: string; name: string; description?: string }> = [];
  try {
    const s = await suggestModules(ctx);
    if (Array.isArray(s)) {
      fromAI = s.map((m: any) => ({
        key: String(m.key || m.name || "")
          .toLowerCase()
          .replace(/\s+/g, "-")
          .slice(0, 32),
        name: String(m.name || m.key || "Módulo"),
        description: m.description || "",
      })).filter(x => x.key);
    }
  } catch (e) {
    console.warn("[modules.suggest] IA caída:", e);
  }
  const aiKeys = new Set(fromAI.map(m => m.key));

  // 3) Catálogo base de sinónimos por módulo (puedes ampliar cuando quieras)
  const SYN: Record<string, string[]> = {
    auth: [
      "usuario","usuarios","login","inicio-sesion","sesion","oauth","sso","mfa","roles","permisos","autenticacion","seguridad","acceso","onboarding"
    ],
    integraciones: [
      "integracion","integraciones","api","apis","webhook","erp","crm","sap","hubspot","zapier","conector","etl"
    ],
    workflows: [
      "workflow","workflows","flujo","flujos","proceso","procesos","automatizacion","bpmn","aprobaciones","orquestacion","onboarding"
    ],
    reporting: [
      "reporte","reportes","reporting","kpi","indicador","indicadores","dashboard","bi","analitica","excel","pdf","exportar"
    ],
    comms: [
      "comunicacion","comunicaciones","correo","email","e-mail","sms","push","whatsapp","notificacion","notificaciones"
    ],
    monitoring: [
      "monitoreo","monitoring","observabilidad","logs","metricas","alertas","rendimiento","latencia","escalabilidad"
    ],
    security: [
      "seguridad","auditoria","auditoría","compliance","cumplimiento","gdpr","iso","hardening","roles","permisos"
    ],
    billing: [
      "billing","facturacion","facturación","pago","pagos","pasarela","stripe","suscripcion","suscripciones","impuesto","boleta","factura"
    ],
  };

  // 4) Tokenizador simple (minúsculas, sin acentos, solo letras/números)
  const normalize = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const tokenize = (s: string) =>
    Array.from(new Set(normalize(s).split(/[^a-z0-9]+/).filter(Boolean)));

  // 5) Construimos “necesidades” con pesos (dolores > objetivos > integraciones > volumen)
  const bagDol = tokenize(ctx.dolores);
  const bagObj = tokenize(ctx.objetivos);
  const bagInt = tokenize(ctx.integraciones);
  const bagVol = tokenize(ctx.volumen);

  const WEIGHTS: Record<"dolores"|"objetivos"|"integraciones"|"volumen", number> =
    { dolores: 3, objetivos: 2, integraciones: 2, volumen: 1 };

  // 6) Catálogo “curado” por si tu tabla LibraryModule está vacía
  const curated = [
    { key: "auth", name: "Autenticación y Usuarios", description: "Gestión de usuarios, roles, permisos, SSO/MFA" },
    { key: "integraciones", name: "Integraciones Externas", description: "Conectores, APIs y webhooks" },
    { key: "workflows", name: "Automatización de Procesos", description: "Reglas, orquestación y BPMN" },
    { key: "reporting", name: "Reportes y Analítica", description: "KPIs, dashboards, exportaciones" },
    { key: "comms", name: "Comunicaciones", description: "Email/SMS/Push/WhatsApp" },
    { key: "monitoring", name: "Monitoreo y Observabilidad", description: "Logs, métricas, alertas" },
    { key: "security", name: "Seguridad y Auditoría", description: "Hardening, auditoría y compliance" },
    { key: "billing", name: "Facturación y Pagos", description: "Planes, pasarelas e impuestos" },
  ];

  // 7) Construimos el universo de módulos a puntuar (lib + curated)
  const universeMap = new Map<string, { key: string; name: string; description?: string }>();
  const pushU = (m: { key: string; name: string; description?: string }) => {
    if (!m?.key) return;
    universeMap.set(m.key, { key: m.key, name: m.name, description: m.description || "" });
  };

  if (libMods.length) {
    for (const m of libMods) pushU({ key: m.key, name: m.name, description: m.description || "" });
  } else {
    for (const m of curated) pushU(m);
  }

  // 8) Scoring por concordancia
  type Scored = { key: string; name: string; description?: string; score: number; matched: string[] };

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

    // Boost si la IA sugirió explícitamente ese módulo
    if (aiKeys.has(m.key)) {
      score += 5;
      matched.add("ai");
    }

    scored.push({ ...m, score, matched: Array.from(matched) });
  }

  // 9) Ordenamos por score desc, devolvemos solo los relevantes (umbral configurable)
  const THRESHOLD = 2;      // mínimo para considerarlo “relevante”
  const MAX_MODULES = 12;   // por si quieres recortar en frontend

  const relevant = scored
    .filter(m => m.score >= THRESHOLD || aiKeys.has(m.key))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MODULES);

  // Si no hay ninguno relevante, devolvemos IA o catálogo base como último recurso
  if (relevant.length === 0) {
    const fallback = fromAI.length ? fromAI : Array.from(universeMap.values());
    return res.json(fallback);
  }

  // Salida principal — incluye score y matched (útil para UI/Debug)
  return res.json(relevant);
});
  
export default router;
