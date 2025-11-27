import { PrismaClient } from "@prisma/client";

async function main() {
  const main = new PrismaClient();
  const shadow = new PrismaClient({
    datasources: { db: { url: process.env.SHADOW_DATABASE_URL! } },
  });

  for (const [label, client] of [["main", main], ["shadow", shadow]] as const) {
    try {
      await client.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector;`);
      console.log(`[${label}] vector OK`);
    } catch (e) {
      console.error(`[${label}] error creando extension vector:`, e);
    } finally {
      await client.$disconnect();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
