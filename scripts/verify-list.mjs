// Confere no YouTube os vídeos enviados para a lista compartilhada e adiciona
// à lists/ai-list.json (branch "lista") só os que têm o selo oficial "Criado com IA".
//
// Uso:
//   ISSUE_BODY="..." node scripts/verify-list.mjs     (GitHub Actions)
//   node scripts/verify-list.mjs ID1 ID2 ...          (manual)
//   AIB_IDS_FILE=ids.txt node scripts/verify-list.mjs  (fila automática)
//
// Grava o resumo em resultado.md e, no GitHub Actions, as saídas
// "added", "checked" e "failed" em $GITHUB_OUTPUT.
// Não usa dependências: só Node 20+.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// No GitHub Actions a lista vem da branch "lista" (AIB_LIST_FILE aponta para ela)
const LIST_FILE = process.env.AIB_LIST_FILE || join(ROOT, "lists", "ai-list.json");
const MAX_IDS = parseInt(process.env.AIB_MAX_IDS || "500", 10);
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Mesmas regras de detecção da extensão (src/defaults.js)
const defs = vm.runInNewContext(
  `${readFileSync(join(ROOT, "src", "defaults.js"), "utf8")}\n({ AIB_LABEL_HELP_IDS, AIB_LABEL_PHRASES })`
);

function sectionHasAiLabel(text) {
  if (defs.AIB_LABEL_HELP_IDS.some((id) => text.includes(`answer/${id}`))) return true;
  const low = text.toLowerCase();
  return defs.AIB_LABEL_PHRASES.some((p) => low.includes(p));
}

function handleFromPath(path) {
  const parts = (path || "").split("/").filter(Boolean);
  if (!parts.length) return "";
  if (parts[0].startsWith("@")) return decodeURIComponent(parts[0]);
  if (["channel", "c", "user"].includes(parts[0])) return decodeURIComponent(parts[1] || "");
  return "";
}

// Lê os IDs só do bloco ```aib-ids ... ``` (ou dos argumentos)
function readIds() {
  let raw = process.argv.slice(2).join(" ");
  if (!raw && process.env.AIB_IDS_FILE) raw = readFileSync(process.env.AIB_IDS_FILE, "utf8");
  if (!raw) {
    const body = process.env.ISSUE_BODY || "";
    const m = body.match(/```aib-ids\s*([\s\S]*?)```/);
    raw = m ? m[1] : "";
  }
  return [...new Set(raw.split(/[\s,]+/).filter((s) => ID_RE.test(s)))].slice(0, MAX_IDS);
}

async function checkVideo(id) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/next?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20261101.00.00", hl: "pt", gl: "BR" } },
      videoId: id
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const sections = [];
  let owner = null;
  const stack = [data];
  while (stack.length) {
    const o = stack.pop();
    if (!o || typeof o !== "object") continue;
    for (const k in o) {
      if (k === "howThisWasMadeSectionViewModel") sections.push(o[k]);
      else if (k === "videoOwnerRenderer" && !owner) owner = o[k];
      if (o[k] && typeof o[k] === "object") stack.push(o[k]);
    }
  }
  if (!owner) throw new Error("vídeo indisponível ou resposta inesperada");
  const run = owner.title?.runs?.[0];
  const base = run?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ||
               owner.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || "";
  return {
    ai: sections.some((s) => sectionHasAiLabel(JSON.stringify(s))),
    handle: handleFromPath(base),
    name: (owner.title?.runs || []).map((r) => r.text).join("").trim()
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadList() {
  mkdirSync(dirname(LIST_FILE), { recursive: true });
  if (!existsSync(LIST_FILE)) return { version: 1, updated: null, channels: {} };
  return JSON.parse(readFileSync(LIST_FILE, "utf8"));
}

function saveList(list) {
  // Ordena para os diffs no GitHub ficarem legíveis
  const channels = {};
  Object.keys(list.channels).sort((a, b) => a.localeCompare(b)).forEach((k) => {
    const c = list.channels[k];
    channels[k] = { name: c.name, videos: [...new Set(c.videos)].sort() };
  });
  const out = { version: 1, updated: new Date().toISOString(), channels };
  writeFileSync(LIST_FILE, `${JSON.stringify(out, null, 2)}\n`);
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

const ids = readIds();
const list = loadList();
const known = new Set(Object.values(list.channels).flatMap((c) => c.videos));
const todo = ids.filter((id) => !known.has(id));

let added = 0;
let notAi = 0;
const failed = [];
const newChannels = new Set();

for (const id of todo) {
  try {
    const v = await checkVideo(id);
    if (!v.ai) { notAi++; continue; }
    const key = v.handle || v.name;
    if (!key) { failed.push(id); continue; }
    // mesmo canal já salvo com outra grafia do @handle
    const existing = Object.keys(list.channels).find((k) => k.toLowerCase() === key.toLowerCase());
    const k = existing || key;
    if (!existing) newChannels.add(k);
    const c = list.channels[k] || (list.channels[k] = { name: v.name, videos: [] });
    c.name = c.name || v.name;
    c.videos.push(id);
    added++;
  } catch {
    failed.push(id);
  }
  await sleep(300);
}

if (added) saveList(list);

const summary = [
  `Conferi ${todo.length} vídeo(s) no YouTube (${ids.length - todo.length} já estavam na lista).`,
  "",
  `- **${added}** com o selo "Criado com IA": adicionados à lista`,
  `- **${notAi}** sem o selo: ignorados`,
  `- **${failed.length}** não puderam ser conferidos${failed.length ? " (vídeo removido, privado ou erro de rede)" : ""}`,
  newChannels.size ? `- **${newChannels.size}** canal(is) novo(s) na lista` : null,
  "",
  ids.length === 0 ? "Não encontrei IDs de vídeo no bloco `aib-ids`. Envie pela extensão (página \"Vídeos e canais bloqueados\" → aba Compartilhar)." : null,
  "Obrigado por contribuir!"
].filter((l) => l !== null).join("\n");

writeFileSync(join(ROOT, "resultado.md"), `${summary}\n`);
console.log(summary);
output("added", added);
output("checked", todo.length);
output("failed", failed.length);

// Se quase tudo falhou, provavelmente o YouTube recusou as consultas
if (todo.length >= 5 && failed.length / todo.length > 0.5) {
  console.error("Mais da metade das consultas falhou: o YouTube pode ter recusado as requisições.");
  process.exitCode = 2;
}
