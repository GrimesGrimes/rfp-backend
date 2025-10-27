import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  DATABASE_URL: z.string().url().describe("PostgreSQL connection string"),
  SHADOW_DATABASE_URL: z.string().url().optional(),

  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // Auth
  JWT_SECRET: z.string().min(32).describe("HS256 secret (consider migrating to JOSE/RS256 later)"),

  // LLM & Embeddings (OpenRouter by default)
  OPENROUTER_API_KEY: z.string().min(10),
  OPENROUTER_BASE: z.string().url().default("https://openrouter.ai/api/v1"),
  LLM_MODEL: z.string().default("deepseek/deepseek-chat-v3.1:free"),
  EMBEDDING_MODEL: z.string().default("nomic-ai/nomic-embed-text-v1.5"),

  // Optional cosmetics for OpenRouter headers
  APP_PUBLIC_URL: z.string().optional(),
  APP_TITLE: z.string().optional(),

  // Caching
  AI_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).default(86400),
});

type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;
export function getEnv(): Env {
  if (_env) return _env;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Print a readable error and exit
    console.error("\n[ENV] Invalid environment variables:\n", parsed.error.format(), "\n");
    process.exit(1);
  }
  _env = parsed.data;
  return _env;
}
