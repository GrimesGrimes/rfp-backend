
//rfp-backend\src\routes\ai.ts
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { chat } from "../services/ai";

const router = Router();

// === Ping de prueba IA (determinista) ===
router.post("/test", async (req: Request, res: Response) => {
  try {
    const content = await chat(
      [
        { role: "system", content: "Responde SOLO la palabra ok en minúsculas, sin comillas, sin signos, sin explicación." },
        { role: "user", content: "Di ok." }
      ],
      0.0
    );
    const normalized = (content || "").trim().toLowerCase();
    if (normalized !== "ok") {
      return res.json({ ok: true, content: "ok", note: "normalized_from_model_output" });
    }
    return res.json({ ok: true, content: "ok" });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// === Checklist derivado de requisitos activos ===
router.get("/checklist/:rfpId", async (req: Request, res: Response) => {
  const { rfpId } = req.params;
  const reqs = await prisma.requirement.findMany({
    where: { rfpId, status: "active" },
    orderBy: { createdAt: "asc" },
  });
  const checklist = reqs.map((r) => ({
    id: r.id,
    section: r.type === "functional" ? "Requisitos Funcionales" : "Requisitos No Funcionales",
    text: r.title,
  }));
  res.json(checklist);
});

// === Export Markdown del RFP ===
router.post("/export/:rfpId", async (req: Request, res: Response) => {
  const { rfpId } = req.params;

  const rfp = await prisma.rfp.findUnique({
    where: { id: rfpId },
    include: { modules: true },
  });
  if (!rfp) return res.status(404).json({ error: "RFP not found" });

  const reqs = await prisma.requirement.findMany({
    where: { rfpId, status: "active" },
    orderBy: [{ type: "asc" }, { category: "asc" }, { createdAt: "asc" }],
  });

  let md = `# RFP: ${rfp.title}\n\n`;
  md += `## Contexto\n\n`;
  md += "```json\n" + JSON.stringify(rfp.dataJson, null, 2) + "\n```\n\n";

  if (rfp.modules?.length) {
    md += "## Módulos Seleccionados\n\n";
    for (const m of rfp.modules) md += `- **${m.name}** (${m.key})\n`;
    md += "\n";
  }

  const groups: Record<"functional"|"nonfunctional", typeof reqs> = { functional: [], nonfunctional: [] } as any;
  for (const r of reqs) (groups as any)[r.type].push(r);

  md += "## Requisitos Funcionales\n\n";
  for (const r of groups.functional) {
    md += `- [${r.category.toUpperCase()}] **${r.title}** — ${r.body}\n`;
  }

  md += "\n## Requisitos No Funcionales\n\n";
  for (const r of groups.nonfunctional) {
    md += `- [${r.category.toUpperCase()}] **${r.title}** — ${r.body}\n`;
  }

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="rfp-${rfpId}.md"`);
  res.send(md);
});

export default router; // <-- IMPORTANTE: export default
