
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pino from "pino-http";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
dotenv.config();
import { getEnv } from "./config/env";
import { errorMiddleware } from "./middleware/error";

import authRouter from "./routes/auth";
import rfpRouter from "./routes/rfp";
import searchRouter from "./routes/search"; 
import { ensurePgVectorIndex } from "./db/init";
import { requireAuth } from "./middleware/auth";
import aiRouter from "./routes/ai";
import modulesRouter from "./routes/modules";
import requirementsRouter from "./routes/requirements";
import aiStreamRouter from "./routes/ai.stream";

const app = express();
const env = getEnv();

app.use(helmet());
app.use(compression());
app.use(pino());
app.use(rateLimit({ windowMs: 60_000, max: 120 }));
app.use(cors({
  origin: env.CORS_ORIGIN.split(",").map(s => s.trim()),
  credentials: false
}));

app.use(express.json({ limit: "10mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/rfp", requireAuth, rfpRouter);
app.use("/search", requireAuth, searchRouter);
app.use("/ai", requireAuth, aiRouter);
app.use("/modules", requireAuth, modulesRouter);
app.use("/requirements", requireAuth, requirementsRouter);
app.use("/ai/stream", requireAuth, aiStreamRouter);

// error handler (last)
app.use(errorMiddleware);

const port = Number(process.env.PORT || 3001);

async function boot() {
  try {
    await ensurePgVectorIndex();
    // cualquier otro warmup que quieras

  } catch (e) {
    console.error("Error al iniciar:", e);
    process.exit(1);
  }
}

boot();

app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});
