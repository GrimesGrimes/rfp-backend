// prisma/seed.ts — seed directo a BD con Prisma (sin HTTP)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { ensurePgVectorIndex } from "../src/db/init";      // reutilizamos tu inicializador
import { embedText } from "../src/lib/embedding";          // usa Ollama/OpenAI según tu .env
import cuid from "cuid";

const prisma = new PrismaClient();

async function upsertUser(email: string, passwordHash: string) {
  // como no pasamos por /auth/register, usa un hash fijo de prueba o genera uno
  // si ya tienes bcrypt en el proyecto:
  const bcrypt = await import("bcrypt");
  const hash = await bcrypt.hash(passwordHash, 10);

  const u = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { id: cuid(), email, hash },
  });
  return u;
}

async function createAndPublishRfp(ownerId: string, title: string, content: string) {
  // 1) RFP
  const rfp = await prisma.rfp.create({
    data: { id: cuid(), ownerId, title, dataJson: { content }, isPublished: false },
  });

  // 2) Sección única (puedes trocear si quieres)
  const section = await prisma.rfpSection.create({
    data: { id: cuid(), rfpId: rfp.id, index: 0, content },
  });

  // 3) Embedding (usa tu pipeline actual)
  const emb: any = await embedText(content);
// Accept shapes: number[] OR { vectors:number[][], dim?:number }
const vector: number[] = Array.isArray(emb)
  ? emb as number[]
  : Array.isArray(emb?.vectors) && Array.isArray(emb.vectors[0])
    ? emb.vectors[0] as number[]
    : [];
const dim = typeof emb?.dim === "number" ? emb.dim : (Array.isArray(vector) ? vector.length : 0);
const vecLiteral = `[${vector.join(",")}]`;
  await prisma.$executeRaw`
    INSERT INTO "RfpEmbedding" 
    ("id", "sectionId", "model", "dim", "chunkIndex", "vector", "createdAt")
    VALUES (
      ${cuid()},
      ${section.id},
      ${process.env.OLLAMA_EMBED_MODEL || process.env.OPENAI_EMBED_MODEL || "unknown"},
      ${dim},
      0,
      ${vecLiteral}::vector,
      NOW()
    )
  `;

  // 4) Publicado
  await prisma.rfp.update({
    where: { id: rfp.id },
    data: { isPublished: true },
  });

  return rfp.id;
}

async function main() {
  await ensurePgVectorIndex();  // garantiza extensión e índice

  const user = await upsertUser("demo@rfp.com", "secret123");

  const rfps = [
    { title: "RFP Sistema Educativo", content: "Alcance: seguridad, pagos, SIAGIE, escalabilidad, SLA." },
    { title: "RFP Salud", content: "HL7, interoperabilidad, seguridad clínica, auditoría, SLA, trazabilidad." },
    { title: "RFP Finanzas", content: "PCI-DSS, antifraude, continuidad del negocio, resiliencia, conciliaciones." },
  ];

  for (const r of rfps) {
    const id = await createAndPublishRfp(user.id, r.title, r.content);
    console.log(`Seed: creado y publicado -> ${r.title} (id=${id})`);
  }

  console.log("Seed listo ✅");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
