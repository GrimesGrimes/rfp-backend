import type { Request, Response, NextFunction } from "express";

export function errorMiddleware(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = typeof err?.status === "number" ? err.status : 500;
  const code = (err?.code as string) || "ERR_INTERNAL";
  const message = (err?.message as string) || "Unexpected error";
  if (process.env.NODE_ENV !== "production") {
    console.error("[error]", err);
  }
  res.status(status).json({ error: code, message });
}
