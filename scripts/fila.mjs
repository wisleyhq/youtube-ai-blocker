// Fala com a fila de contribuições (Cloudflare Worker) em nome do robô.
//
//   node scripts/fila.mjs buscar  ARQUIVO [LIMITE]  → grava os IDs da fila no ARQUIVO
//   node scripts/fila.mjs remover ARQUIVO           → tira da fila os IDs do ARQUIVO
//
// Precisa de AIB_WORKER_URL e AIB_WORKER_TOKEN no ambiente (segredos do GitHub).

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const [cmd, arquivo, limite = "2000"] = process.argv.slice(2);
const base = (process.env.AIB_WORKER_URL || "").replace(/\/+$/, "");
const token = process.env.AIB_WORKER_TOKEN || "";
if (!base || !token || !arquivo || !["buscar", "remover"].includes(cmd)) {
  console.error("uso: AIB_WORKER_URL=... AIB_WORKER_TOKEN=... node scripts/fila.mjs buscar|remover ARQUIVO [LIMITE]");
  process.exit(1);
}
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

if (cmd === "buscar") {
  const res = await fetch(`${base}/pendentes?limite=${encodeURIComponent(limite)}`, { headers });
  if (!res.ok) throw new Error(`fila respondeu HTTP ${res.status}`);
  const { ids = [], naFila = 0 } = await res.json();
  const validos = ids.filter((id) => ID_RE.test(id));
  writeFileSync(arquivo, validos.join("\n") + (validos.length ? "\n" : ""));
  console.log(`${validos.length} vídeo(s) lidos da fila (${naFila} na fila no total).`);
  output("count", validos.length);
} else {
  const ids = readFileSync(arquivo, "utf8").split(/\s+/).filter((id) => ID_RE.test(id));
  for (let i = 0; i < ids.length; i += 500) {
    const res = await fetch(`${base}/pendentes/remover`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ids: ids.slice(i, i + 500) })
    });
    if (!res.ok) throw new Error(`fila respondeu HTTP ${res.status}`);
  }
  console.log(`${ids.length} vídeo(s) tirados da fila.`);
}
