import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { embedText } from "../lib/embedding";
import { requireAuth } from "../middleware/auth";

const router = Router();

const SearchQuery = z.object({
  q: z.string().min(2),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  scope: z.enum(["mine", "all"]).optional(),
});

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const parse = SearchQuery.safeParse({
    q: req.query.q,
    limit: req.query.limit,
    scope: req.query.scope,
  });
  if (!parse.success) return res.status(400).json(parse.error);

  const { q, limit = 10, scope = "mine" } = parse.data;

  // embedText ahora devuelve { vectors:number[][], model:string, dim:number }
  const { vectors } = await embedText(q);
  const vec = vectors[0] ?? [];
  if (vec.length === 0) {
    return res.status(500).json({ error: "No se pudo generar embedding para la consulta." });
  }

  // pgvector espera string '[v1,v2,...]' y luego casteo ::vector
  const vectorString = `[${vec.join(",")}]`;

  const userId = (req as any).user?.sub as string | undefined;
  const whereOwner =
    scope === "mine" && userId ? `AND r."ownerId" = '${userId}'` : ``;

  // Respeta el nombre real de columnas: "sectionId", "rfpId", "ownerId", "index"
  const sql = `
    WITH q AS (
      SELECT '${vectorString}'::vector AS v
    )
    SELECT
      e.id                      AS embedding_id,
      s.id                      AS section_id,
      s."index"                 AS chunk_index,
      s.content,
      r.id                      AS rfp_id,
      r.title,
      -- Distancia L2 entre vectores (menor es mejor)
      (e.vector <-> (SELECT v FROM q)) AS l2_distance,
      -- Para vectores normalizados: cos_sim aprox = 1 - (l2^2)/2
      ROUND( (1 - POWER((e.vector <-> (SELECT v FROM q)), 2) / 2)::numeric, 6 ) AS similarity
    FROM "RfpEmbedding" e
    JOIN "RfpSection"  s ON s.id = e."sectionId"
    JOIN "Rfp"         r ON r.id = s."rfpId"
    WHERE 1=1
      ${whereOwner}
    ORDER BY e.vector <-> (SELECT v FROM q) ASC
    LIMIT ${limit};
  `;

  const rows = await prisma.$queryRawUnsafe<any[]>(sql);
  res.json(rows);
});

export default router;
