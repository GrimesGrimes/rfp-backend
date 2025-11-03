/*
  Warnings:

  - You are about to drop the column `heading` on the `RfpSection` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `RfpSection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Moscow" AS ENUM ('wont', 'would', 'could', 'should');

-- AlterTable
ALTER TABLE "Rfp" ALTER COLUMN "dataJson" DROP NOT NULL,
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RfpEmbedding" ADD COLUMN     "rfpId" TEXT;

-- AlterTable
ALTER TABLE "RfpSection" DROP COLUMN "heading",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "hash" SET DEFAULT '';

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "moduleId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" "Moscow" NOT NULL DEFAULT 'should',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryModule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryRequirement" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryRequirementEmbedding" (
    "id" TEXT NOT NULL,
    "reqId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dim" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "vector" vector NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryRequirementEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCache" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Module_rfpId_idx" ON "Module"("rfpId");

-- CreateIndex
CREATE UNIQUE INDEX "Module_rfpId_key_key" ON "Module"("rfpId", "key");

-- CreateIndex
CREATE INDEX "Requirement_rfpId_idx" ON "Requirement"("rfpId");

-- CreateIndex
CREATE INDEX "Requirement_moduleId_idx" ON "Requirement"("moduleId");

-- CreateIndex
CREATE INDEX "Requirement_category_idx" ON "Requirement"("category");

-- CreateIndex
CREATE INDEX "Requirement_status_idx" ON "Requirement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_rfpId_title_type_key" ON "Requirement"("rfpId", "title", "type");

-- CreateIndex
CREATE INDEX "ChecklistItem_rfpId_idx" ON "ChecklistItem"("rfpId");

-- CreateIndex
CREATE INDEX "ChecklistItem_section_idx" ON "ChecklistItem"("section");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryModule_key_key" ON "LibraryModule"("key");

-- CreateIndex
CREATE INDEX "LibraryModule_key_idx" ON "LibraryModule"("key");

-- CreateIndex
CREATE INDEX "LibraryRequirementEmbedding_model_idx" ON "LibraryRequirementEmbedding"("model");

-- CreateIndex
CREATE INDEX "LibraryRequirementEmbedding_reqId_idx" ON "LibraryRequirementEmbedding"("reqId");

-- CreateIndex
CREATE INDEX "Rfp_ownerId_idx" ON "Rfp"("ownerId");

-- CreateIndex
CREATE INDEX "RfpSection_rfpId_idx" ON "RfpSection"("rfpId");

-- CreateIndex
CREATE INDEX "RfpSection_index_idx" ON "RfpSection"("index");

-- AddForeignKey
ALTER TABLE "RfpEmbedding" ADD CONSTRAINT "RfpEmbedding_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRequirement" ADD CONSTRAINT "LibraryRequirement_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "LibraryModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRequirementEmbedding" ADD CONSTRAINT "LibraryRequirementEmbedding_reqId_fkey" FOREIGN KEY ("reqId") REFERENCES "LibraryRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extensión pgvector (idempotente)
CREATE EXTENSION IF NOT EXISTS vector;

-- Si tu columna vector NO quedó creada con dimensión fija,
-- puedes forzarla: (comenta si ya está en vector(1536))
-- ALTER TABLE "RequirementEmbedding" ALTER COLUMN "vector" TYPE vector(1536);

-- Índices auxiliares RequirementEmbedding
CREATE INDEX IF NOT EXISTS "RequirementEmbedding_req_idx" ON "RequirementEmbedding" ("reqId");
CREATE INDEX IF NOT EXISTS "RequirementEmbedding_model_idx" ON "RequirementEmbedding" ("model");

-- Índice ivfflat para RequirementEmbedding (L2)
CREATE INDEX IF NOT EXISTS "req_embedding_vector_l2_idx"
ON "RequirementEmbedding" USING ivfflat (vector vector_l2_ops) WITH (lists = 100);

-- Índice ivfflat para RfpEmbedding (L2) — el que causaba el drift
CREATE INDEX IF NOT EXISTS "rfp_embedding_vector_l2_idx"
ON "RfpEmbedding" USING ivfflat (vector vector_l2_ops) WITH (lists = 100);