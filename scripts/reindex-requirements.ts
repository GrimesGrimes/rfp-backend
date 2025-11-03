// scripts/reindex-requirements.ts
import cuid from "cuid";
import { prisma } from "../src/lib/prisma";
import { embedText } from "../src/lib/embedding";

async function main() {
  const reqs = await prisma.requirement.findMany({
    where: { status: "active", embeddings: { none: {} } },
    select: { id: true, title: true, body: true },
    orderBy: { createdAt: "asc" },
  });

  if (!reqs.length) {
    console.log("No hay requisitos pendientes de indexar.");
    return;
  }

  console.log(`Indexando ${reqs.length} requisitos...`);
  for (const r of reqs) {
    const text = [r.title, r.body?.trim() || ""].filter(Boolean).join("\n\n");
    const emb = await embedText(text);
    const vec = emb.vectors[0] || [];
    const vecText = `[${vec.join(",")}]`;
    const model = emb.model || process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";
    const dim = vec.length;

    await prisma.$executeRaw`
      INSERT INTO "RequirementEmbedding"
      ("id","reqId","model","dim","vector","createdAt")
      VALUES (${cuid()}, ${r.id}, ${model}, ${dim}, ${vecText}::vector, NOW())
    `;

    console.log(` ✓ ${r.id} (dim=${dim})`);
    await new Promise(r => setTimeout(r, 40)); // pequeña pausa anti rate-limit
  }

  console.log("Reindex de requisitos listo ✅");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
