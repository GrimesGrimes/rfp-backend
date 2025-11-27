-- Habilitar pgvector para esta BD (también vale en la shadow DB)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "Moscow" AS ENUM ('wont', 'would', 'could', 'should');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "hash" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfp" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dataJson" JSONB,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rfp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfpSection" (
    "id" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RfpSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfpEmbedding" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dim" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "vector" vector NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rfpId" TEXT,

    CONSTRAINT "RfpEmbedding_pkey" PRIMARY KEY ("id")
);

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
    "body" TEXT,
    "type" TEXT NOT NULL,
    "category" "Moscow" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementEmbedding" (
    "id" TEXT NOT NULL,
    "reqId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dim" INTEGER NOT NULL,
    "vector" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementEmbedding_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Rfp_ownerId_idx" ON "Rfp"("ownerId");

-- CreateIndex
CREATE INDEX "RfpSection_rfpId_idx" ON "RfpSection"("rfpId");

-- CreateIndex
CREATE INDEX "RfpSection_index_idx" ON "RfpSection"("index");

-- CreateIndex
CREATE INDEX "RfpEmbedding_model_idx" ON "RfpEmbedding"("model");

-- CreateIndex
CREATE INDEX "RfpEmbedding_sectionId_idx" ON "RfpEmbedding"("sectionId");

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
CREATE INDEX "RequirementEmbedding_reqId_idx" ON "RequirementEmbedding"("reqId");

-- CreateIndex
CREATE INDEX "RequirementEmbedding_model_idx" ON "RequirementEmbedding"("model");

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

-- AddForeignKey
ALTER TABLE "Rfp" ADD CONSTRAINT "Rfp_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfpSection" ADD CONSTRAINT "RfpSection_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfpEmbedding" ADD CONSTRAINT "RfpEmbedding_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "RfpSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfpEmbedding" ADD CONSTRAINT "RfpEmbedding_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementEmbedding" ADD CONSTRAINT "RequirementEmbedding_reqId_fkey" FOREIGN KEY ("reqId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRequirement" ADD CONSTRAINT "LibraryRequirement_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "LibraryModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRequirementEmbedding" ADD CONSTRAINT "LibraryRequirementEmbedding_reqId_fkey" FOREIGN KEY ("reqId") REFERENCES "LibraryRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
