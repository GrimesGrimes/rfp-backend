import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { getEnv } from "../config/env";

const memory = new Map<string, { expiresAt: number; value: string }>();

export function keyFrom(payload: unknown): string {
  const h = crypto.createHash("sha256");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

export async function getCached(key: string): Promise<string | null> {
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  const row = await prisma.aiCache.findUnique({ where: { key } });
  if (!row) return null;
  if (row.expiresAt.getTime() <= now) return null;
  // hydrate memory to speed up
  memory.set(key, { value: row.value, expiresAt: row.expiresAt.getTime() });
  return row.value;
}

export async function setCached(key: string, value: string): Promise<void> {
  const ttl = getEnv().AI_CACHE_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  memory.set(key, { value, expiresAt: expiresAt.getTime() });
  await prisma.aiCache.upsert({
    where: { key },
    update: { value, expiresAt },
    create: { key, value, expiresAt },
  });
}
