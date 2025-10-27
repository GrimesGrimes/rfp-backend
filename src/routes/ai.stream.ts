import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { initSSE } from "../middleware/sse";
import { suggestRequirements } from "../services/ai";
import { z } from "zod";

const router = Router();

const Q = z.object({
  rfpId: z.string(),
  moduleKey: z.string(),
});

router.get("/requirements", async (req: Request, res: Response) => {
  const parse = Q.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json(parse.error);
    return;
  }
  const { rfpId, moduleKey } = parse.data;

  const rfp = await prisma.rfp.findUnique({ where: { id: rfpId }, include: { modules: true } });
  if (!rfp) {
    res.status(404).json({ error: "RFP not found" });
    return;
  }
  const mod = rfp.modules.find((m) => m.key === moduleKey);
  if (!mod) {
    res.status(404).json({ error: "Module not found on RFP" });
    return;
  }

  const d: any = rfp.dataJson || {};
  const ctx = {
    objetivos: (d.objetivos || "").toString(),
    dolores: (d.dolores || "").toString(),
    integraciones: (d.integraciones || "").toString(),
    volumen: (d.volumen || "").toString(),
  };

  const sse = initSSE(res);
  sse.write("start", { moduleKey, moduleName: mod.name });

  try {
    // In a future iteration, you can surface token-level streaming here.
    const out = await suggestRequirements({
      moduleKey,
      moduleName: mod.name,
      ...ctx,
    });

    sse.write("result", out);
    sse.write("done", "ok");
    sse.end();
  } catch (err: any) {
    sse.write("error", { message: err?.message || "AI error" });
    sse.end();
  }
});

export default router;
