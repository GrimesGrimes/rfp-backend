// src/db/init.ts
import { prisma } from "../lib/prisma";

export async function ensurePgVectorIndex() {
  // Crea extensión y el índice IVFFLAT si no existen (compatible con L2)
  // OJO: usar $executeRawUnsafe sólo para SQL fijo, sin interpolación de usuario.
  await prisma.$executeRawUnsafe(`
    CREATE EXTENSION IF NOT EXISTS vector;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS rfp_embedding_vector_idx
    ON "RfpEmbedding" USING ivfflat (vector vector_l2_ops)
    WITH (lists = 100);
  `);

  await prisma.$executeRawUnsafe(`ANALYZE "RfpEmbedding";`);
}
