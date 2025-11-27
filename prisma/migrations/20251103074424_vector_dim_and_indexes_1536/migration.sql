-- Asegura extensión (idempotente)
CREATE EXTENSION IF NOT EXISTS vector;

-- Ajusta columnas a vector(1536)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='RfpEmbedding' AND column_name='vector') THEN
    ALTER TABLE "RfpEmbedding" ALTER COLUMN "vector" TYPE vector(1536);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='RequirementEmbedding' AND column_name='vector') THEN
    ALTER TABLE "RequirementEmbedding" ALTER COLUMN "vector" TYPE vector(1536);
  END IF;
END
$$;

-- Crea índices ivfflat SOLO si la columna tiene dimensión (typmod > 0)
DO $$
DECLARE
  has_dim_rfpe boolean := false;
  has_dim_reqe boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid='public."RfpEmbedding"'::regclass
      AND attname='vector'
      AND atttypmod > 0
  ) INTO has_dim_rfpe;

  IF has_dim_rfpe AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname='rfp_embedding_vector_l2_idx' AND n.nspname='public'
  ) THEN
    CREATE INDEX rfp_embedding_vector_l2_idx
    ON "RfpEmbedding" USING ivfflat ("vector" vector_l2_ops) WITH (lists = 100);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid='public."RequirementEmbedding"'::regclass
      AND attname='vector'
      AND atttypmod > 0
  ) INTO has_dim_reqe;

  IF has_dim_reqe AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname='req_embedding_vector_l2_idx' AND n.nspname='public'
  ) THEN
    CREATE INDEX req_embedding_vector_l2_idx
    ON "RequirementEmbedding" USING ivfflat ("vector" vector_l2_ops) WITH (lists = 100);
  END IF;
END
$$;
