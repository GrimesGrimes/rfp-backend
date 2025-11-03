// scripts/smoke.ts
import "dotenv/config";
// Si tu Node es 18+ puedes usar fetch global y NO necesitas node-fetch.
// Si te marcara error de tipos con fetch, descomenta la siguiente línea y haz `npm i node-fetch @types/node-fetch`:
// import fetch from "node-fetch";
import { randomUUID } from "node:crypto";

type LoginResponse = { token: string };

const BASE = process.env.API_BASE || "http://localhost:3001";
const email = "admin@demo.com";
const password = "Admin#123456";
const testRfpId = process.env.TEST_RFP_ID || "coloca_aqui_tu_rfpId_real"; // o pásalo por env

async function main() {
  // --- LOGIN ---
  let r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`Login failed HTTP ${r.status}`);
  const loginResp = (await r.json()) as LoginResponse;
  if (!loginResp?.token) throw new Error("Login failed: missing token");

  const headers = {
    authorization: `Bearer ${loginResp.token}`,
    "content-type": "application/json",
  };

  const rfpId = testRfpId;
  if (!rfpId) throw new Error("Define TEST_RFP_ID en tu .env o edita scripts/smoke.ts con un rfpId válido");

  // --- BULK UPSERT ---
  const idem = randomUUID();
  r = await fetch(`${BASE}/requirements/bulk-upsert`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      idempotencyKey: idem,
      items: [
        {
          rfpId,
          title: "Logging de auditoría",
          body: "Registrar acciones críticas y accesos.",
          type: "nonfunctional",
          category: "should",
        },
      ],
    }),
  });
  const bulk = await r.json();
  console.log("bulk-upsert:", bulk);

  // --- SEARCH ---
  const q = "auditoría";
  r = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&rfpId=${encodeURIComponent(rfpId)}&scope=all`, {
    headers,
  });
  const search = await r.json();
  console.log("search:", search);

  // --- CHECKLIST ---
  r = await fetch(`${BASE}/requirements/checklist?rfpId=${encodeURIComponent(rfpId)}`, { headers });
  const checklist = await r.json();
  console.log("checklist:", checklist);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
