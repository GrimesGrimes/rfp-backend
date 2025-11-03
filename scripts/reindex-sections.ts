// scripts/reindex-sections.ts
import cuid from "cuid";
import { prisma } from "../src/lib/prisma";
import { embedText } from "../src/lib/embedding";

async function main() {
  const sections = await prisma.rfpSection.findMany({
    where: { embeddings: { none: {} } }, // solo las que no tienen embeddings
    orderBy: { createdAt: "asc" },
    select: { id: true, rfpId: true, content: true },
  });

  if (!sections.length) {
    console.log("No hay secciones pendientes de indexar.");
    return;
  }

  console.log(`Indexando ${sections.length} secciones...`);
  for (const s of sections) {
    const res = await embedText(s.content || "");
    const vec = res.vectors[0] || [];
    const vecText = `[${vec.join(",")}]`; // lo pasamos como parámetro
    const model = process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";
    const dim = vec.length;

    // Usa $executeRaw con template literal para parametrizar y castear en SQL
    await prisma.$executeRaw`
      INSERT INTO "RfpEmbedding"
      ("id","rfpId","sectionId","model","dim","chunkIndex","vector","createdAt")
      VALUES (${cuid()}, ${s.rfpId}, ${s.id}, ${model}, ${dim}, ${0}, ${vecText}::vector, NOW())
    `;

    console.log(` ✓ ${s.id} (dim=${dim})`);
  }

  console.log("Reindex listo ✅");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
