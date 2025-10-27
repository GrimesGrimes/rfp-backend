-- Asegura pgvector antes de crear tablas con columnas 'vector'
CREATE EXTENSION IF NOT EXISTS vector;
-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfp" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dataJson" JSONB NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rfp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfpSection" (
    "id" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "heading" TEXT,
    "content" TEXT NOT NULL,

    CONSTRAINT "RfpSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfpEmbedding" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dim" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "vector" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RfpEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "RfpEmbedding_model_idx" ON "RfpEmbedding"("model");

-- CreateIndex
CREATE INDEX "RfpEmbedding_sectionId_idx" ON "RfpEmbedding"("sectionId");

-- AddForeignKey
ALTER TABLE "Rfp" ADD CONSTRAINT "Rfp_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfpSection" ADD CONSTRAINT "RfpSection_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfpEmbedding" ADD CONSTRAINT "RfpEmbedding_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "RfpSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Índice aproximado para búsquedas rápidas (ajusta lists según volumen)
CREATE INDEX IF NOT EXISTS rfp_embedding_vector_idx
ON "RfpEmbedding" USING ivfflat (vector vector_cosine_ops)
WITH (lists = 100);