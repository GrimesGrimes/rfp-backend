import { PrismaClient } from "@prisma/client";

export async function ensurePgVectorIndex(prisma: PrismaClient) {
  // 1) Crea extensión (una sola sentencia)
  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  } catch (e) {
    console.warn("[pgvector] Aviso: no se pudo crear la extensión:", (e as Error).message);
  }

  // 2) DO $$ único con detección de nombres y creación de índices si hay dimensión fija
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      DECLARE
        rfpe regclass;
        reqe regclass;
        has_dim_rfpe boolean := false;
        has_dim_reqe boolean := false;
      BEGIN
        -- Detecta la tabla real de RfpEmbedding por orden de preferencia
        rfpe := coalesce(
          to_regclass('public."RfpEmbedding"'),
          to_regclass('public.rfpembedding'),
          to_regclass('public.rfp_embedding')
        );

        IF rfpe IS NOT NULL THEN
          -- ¿la columna vector tiene dimensión? (typmod > 0)
          PERFORM 1
          FROM pg_attribute
          WHERE attrelid = rfpe
            AND attname  = 'vector'
            AND atttypmod > 0;
          has_dim_rfpe := FOUND;

          IF has_dim_rfpe THEN
            -- crea índice si no existe
            IF NOT EXISTS (
              SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE c.relname='rfp_embedding_vector_l2_idx' AND n.nspname='public'
            ) THEN
              EXECUTE format('CREATE INDEX rfp_embedding_vector_l2_idx ON %s USING ivfflat (vector vector_l2_ops) WITH (lists = 100);', rfpe::text);
            END IF;
          END IF;
        END IF;

        -- Detecta la tabla real de RequirementEmbedding
        reqe := coalesce(
          to_regclass('public."RequirementEmbedding"'),
          to_regclass('public.requirementembedding'),
          to_regclass('public.requirement_embedding')
        );

        IF reqe IS NOT NULL THEN
          PERFORM 1
          FROM pg_attribute
          WHERE attrelid = reqe
            AND attname  = 'vector'
            AND atttypmod > 0;
          has_dim_reqe := FOUND;

          IF has_dim_reqe THEN
            IF NOT EXISTS (
              SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE c.relname='req_embedding_vector_l2_idx' AND n.nspname='public'
            ) THEN
              EXECUTE format('CREATE INDEX req_embedding_vector_l2_idx ON %s USING ivfflat (vector vector_l2_ops) WITH (lists = 100);', reqe::text);
            END IF;
          END IF;
        END IF;
      END
      $$;
    `);
  } catch (e) {
    console.warn("[pgvector] Aviso: no se pudieron crear índices ivfflat:", (e as Error).message);
  }
}
