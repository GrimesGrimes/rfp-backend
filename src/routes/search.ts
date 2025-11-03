import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { embedText } from "../lib/embedding";
import { requireAuth } from "../middleware/auth";
import { Prisma } from "@prisma/client";

const router = Router();

const SearchQuery = z.object({
  q: z.string().min(2),
  rfpId: z.string().optional(),                 // permite filtrar por RFP
  limit: z.coerce.number().int().min(1).max(50).optional(),
  scope: z.enum(["mine", "all"]).optional(),    // en dev usaremos default 'all'
});

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const parsed = SearchQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { q, rfpId, limit = 8, scope = "all" } = parsed.data;
  const userId = (req as any).user?.id as string | undefined;

  // Construimos condiciones WHERE parametrizadas
  const whereParts: Prisma.Sql[] = [Prisma.sql`1=1`];
  if (scope === "mine" && userId) {
    // filtra por owner del RFP
    whereParts.push(Prisma.sql`r."ownerId" = ${userId}`);
  }
  if (rfpId) {
    whereParts.push(Prisma.sql`r."id" = ${rfpId}`);
  }
  const WHERE = Prisma.sql`${Prisma.join(whereParts, ' AND ')}`;

  const results: any[] = [];

  // 1) Vector search (si embeddings están disponibles y la query puede embeddearse)
  try {
    const emb = await embedText(q);
    const vec = emb.vectors[0] || [];
    const vecText = `[${vec.join(",")}]`;

    const vectorRows = await prisma.$queryRaw<
      { embedding_id: string; section_id: string; chunk_index: number; content: string; rfp_id: string; title: string; l2_distance: number; similarity: number }[]
    >`
      WITH q AS (SELECT ${vecText}::vector AS v)
      SELECT
        e.id                      AS embedding_id,
        s.id                      AS section_id,
        s."index"                 AS chunk_index,
        s.content,
        r.id                      AS rfp_id,
        r.title,
        (e.vector <-> (SELECT v FROM q))                                 AS l2_distance,
        ROUND((1 - POWER((e.vector <-> (SELECT v FROM q)), 2) / 2)::numeric, 6) AS similarity
      FROM "RfpEmbedding" e
      JOIN "RfpSection"  s ON s.id = e."sectionId"
      JOIN "Rfp"         r ON r.id = s."rfpId"
      WHERE ${WHERE}
      ORDER BY e.vector <-> (SELECT v FROM q) ASC
      LIMIT ${limit};
    `;

    for (const r of vectorRows) {
      results.push({
        source: "section",
        rfpId: r.rfp_id,
        sectionId: r.section_id,
        snippet: (r.content || "").slice(0, 240),
        l2: Number(r.l2_distance),
        similarity: Number(r.similarity),
      });
    }
  } catch {
    // si falla embeddings o no hay, seguimos con fallback textual
  }

  // 2) Fallback textual sobre Requirement (title/body)
  const like = `%${q}%`;
  const reqRows = await prisma.$queryRaw<
    { id: string; title: string; body: string | null; rfpId: string }[]
  >`
    SELECT req."id", req."title", req."body", req."rfpId"
    FROM "Requirement" req
    JOIN "Rfp" r ON r.id = req."rfpId"
    WHERE ${WHERE}
      AND (LOWER(req."title") LIKE LOWER(${like}) OR LOWER(req."body") LIKE LOWER(${like}))
    ORDER BY req."createdAt" DESC
    LIMIT ${limit};
  `;

  for (const r of reqRows) {
    results.push({
      source: "requirement",
      rfpId: r.rfpId,
      id: r.id,
      title: r.title,
      snippet: String(r.body || "").slice(0, 240),
    });
  }

  return res.json({ q, rfpId: rfpId || null, count: results.length, results });
});

export default router;
