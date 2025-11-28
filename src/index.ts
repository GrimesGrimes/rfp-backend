
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
import { prisma } from "./lib/prisma"; // 👈 importa tu singleton
import { requireAuth } from "./middleware/auth";
import aiRouter from "./routes/ai";
import modulesRouter from "./routes/modules";
import requirementsRouter from "./routes/requirements";
import aiStreamRouter from "./routes/ai.stream";
import requirementsRoutes from "./routes/requirementsRoutes";


const app = express();
const env = getEnv();

app.set("trust proxy", 1); // Confía en el proxy de Railway para IPs


app.use(helmet());
app.use(compression());
app.use(pino());
app.use(rateLimit({ windowMs: 60_000, max: 120 }));
const allowedOrigins = [
  // Lo que venga del .env (puede ser una lista separada por comas)
  ...env.CORS_ORIGIN.split(",").map((s) => s.trim()),

  // Aseguramos explícitamente tu frontend en Railway
  "https://rfp-frontend-production.up.railway.app",

  // Y orígenes de desarrollo
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

app.use(
  cors({
    origin(origin, callback) {
      // origin puede ser undefined en algunos clientes (curl, Postman...)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn("[CORS] Origin no permitido:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true, // por si en el futuro usas cookies o auth con credenciales
  })
);

app.use(express.json({ limit: "10mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/rfp", rfpRouter);
app.use("/search", requireAuth, searchRouter);
app.use("/ai", requireAuth, aiRouter);
app.use("/modules", requireAuth, modulesRouter);
app.use("/requirements", requireAuth, requirementsRouter);
app.use("/ai/stream", requireAuth, aiStreamRouter);
app.use("/requirements", requireAuth, requirementsRoutes);
// error handler (last)
app.use(errorMiddleware);

const port = Number(process.env.PORT || 3001);

async function boot() {
  try {
    await ensurePgVectorIndex(prisma); // 👈 pásale el cliente

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
