import type { Request, Response } from "express";

export function initSSE(res: Response, headers: Record<string,string> = {}) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    ...headers,
  });
  const write = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
  };
  const ping = () => write("ping", "🔄");
  const end = () => res.end();
  return { write, end, ping };
}
