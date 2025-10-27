import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { embedText } from "../lib/embedding";
import { randomUUID } from "crypto";

const router = Router();

/** ==== Schemas ==== */
const CreateRfp = z.object({
  title: z.string().min(3),
  dataJson: z.any().optional(), // { objetivos, dolores, integraciones, volumen, ... }
});

const ListQuery = z.object({
  scope: z.enum(["mine", "all"]).optional(),
});

/** ==== Helpers ==== */
function ensureAuth(req: Request, res: Response): string | undefined {
  const userId = (req as any).user?.sub as string | undefined;
  if (!userId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  return userId;
}

/** ==== Crear RFP ==== */
// POST /rfp
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = ensureAuth(req, res);
    if (!userId) return;

    const { title, dataJson } = CreateRfp.parse(req.body);

    const rfp = await prisma.rfp.create({
      data: { title, ownerId: userId, dataJson: dataJson ?? {} },
    });

    // Construimos contenido inicial de sección a partir del brief para poder indexar algo
    const d: any = dataJson ?? {};
    const contentParts: string[] = [];
    if (d.objetivos) contentParts.push(`Objetivos: ${d.objetivos}`);
    if (d.dolores) contentParts.push(`Dolores: ${d.dolores}`);
    if (d.integraciones) contentParts.push(`Integraciones: ${d.integraciones}`);
    if (d.volumen) contentParts.push(`Volumen: ${d.volumen}`);
    const content = contentParts.join("\n") || JSON.stringify(d);

    // Creamos la primera sección (index 0)
    const section = await prisma.rfpSection.create({
      data: { rfpId: rfp.id, index: 0, content },
    });

    // Embedding de esa sección (mejor para /search)
    try {
      const { vectors, model, dim } = await embedText(content);
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
      // No rompemos la creación del RFP por un fallo de embeddings
    }

    return res.status(201).json(rfp);
  } catch (e: any) {
    return res.status(400).json({ error: String(e?.message || e) });
  }
});

/** ==== Listar RFPs ==== */
// GET /rfp?scope=mine|all (por defecto: mine)
router.get("/", async (req: Request, res: Response) => {
  const userId = ensureAuth(req, res);
  if (!userId) return;

  const { scope = "mine" } = ListQuery.parse(req.query);
  const where = scope === "mine" ? { ownerId: userId } : {};
  const rfps = await prisma.rfp.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  res.json(rfps);
});

/** ==== Obtener un RFP por id ==== */
// GET /rfp/:id
router.get("/:id", async (req: Request, res: Response) => {
  const userId = ensureAuth(req, res);
  if (!userId) return;

  const rfp = await prisma.rfp.findUnique({
    where: { id: req.params.id },
    include: { modules: true, requirements: true },
  });
  if (!rfp) return res.status(404).json({ error: "RFP not found" });

  // si quieres restringir lectura a owner:
  // if (rfp.ownerId !== userId) return res.status(403).json({ error: "Forbidden" });

  res.json(rfp);
});

export default router;
