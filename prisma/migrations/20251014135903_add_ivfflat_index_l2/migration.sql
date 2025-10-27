CREATE INDEX IF NOT EXISTS rfp_embedding_vector_idx
ON "RfpEmbedding" USING ivfflat (vector vector_l2_ops)
WITH (lists = 100);

ANALYZE "RfpEmbedding";