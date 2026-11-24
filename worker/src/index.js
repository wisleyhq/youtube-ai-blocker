// Fila de contribuições da lista compartilhada (Cloudflare Worker + D1).
//
// POST /enviar               {ids: [...]}  → público e anônimo: a extensão manda
//                                            IDs de vídeos com o selo de IA
// GET  /pendentes?limite=N                 → robô (com token): lê a fila
// POST /pendentes/remover    {ids: [...]}  → robô (com token): tira da fila o
//                                            que já conferiu
//
// Nada aqui é confiado: o robô do GitHub confere cada vídeo no YouTube antes
// de pôr na lista. A fila só guarda IDs (11 caracteres) e a hora em que
// chegaram. O IP de quem envia não é guardado: só um resumo (hash) dele, por
// um dia, para limitar envios.

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_IDS_POR_ENVIO = 500;
const MAX_ENVIOS_POR_DIA = 20; // por pessoa (IP)
const MAX_FILA = 200000; // proteção contra abuso
const MAX_CORPO = 20000; // bytes

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400"
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });

async function lerIds(req) {
  const texto = await req.text();
  if (texto.length > MAX_CORPO) throw new Error("corpo grande demais");
  const dados = JSON.parse(texto);
  const ids = Array.isArray(dados?.ids) ? dados.ids : [];
  return [...new Set(ids.filter((v) => typeof v === "string" && ID_RE.test(v)))];
}

async function sha256(texto) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function autorizado(req, env) {
  const esperado = `Bearer ${env.ROBO_TOKEN || ""}`;
  const recebido = req.headers.get("authorization") || "";
  if (!env.ROBO_TOKEN || recebido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

async function enviar(req, env) {
  let ids;
  try {
    ids = await lerIds(req);
  } catch {
    return json({ ok: false, erro: "formato inválido" }, 400);
  }
  if (!ids.length) return json({ ok: false, erro: "nenhum ID válido" }, 400);
  if (ids.length > MAX_IDS_POR_ENVIO) return json({ ok: false, erro: `máximo de ${MAX_IDS_POR_ENVIO} por envio` }, 413);

  // Limite por pessoa: hash do IP + dia (o IP em si não é guardado)
  const dia = new Date().toISOString().slice(0, 10);
  const ip = req.headers.get("cf-connecting-ip") || "desconhecido";
  const chave = await sha256(`${ip}|${dia}|${env.ROBO_TOKEN || ""}`);
  const lim = await env.DB.prepare(
    "INSERT INTO limites (chave, dia, n) VALUES (?1, ?2, 1) ON CONFLICT (chave, dia) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(chave, dia).first();
  if ((lim?.n || 0) > MAX_ENVIOS_POR_DIA) return json({ ok: false, erro: "limite de envios por dia atingido" }, 429);

  const fila = await env.DB.prepare("SELECT COUNT(*) AS n FROM pendentes").first();
  if ((fila?.n || 0) > MAX_FILA) return json({ ok: false, erro: "fila cheia, tente mais tarde" }, 503);

  const agora = Date.now();
  const ins = env.DB.prepare("INSERT OR IGNORE INTO pendentes (id, recebido) VALUES (?1, ?2)");
  await env.DB.batch(ids.map((id) => ins.bind(id, agora)));
  return json({ ok: true, recebidos: ids.length });
}

async function pendentes(url, env) {
  const limite = Math.min(Math.max(parseInt(url.searchParams.get("limite") || "2000", 10) || 2000, 1), 5000);
  const { results } = await env.DB.prepare("SELECT id FROM pendentes ORDER BY recebido LIMIT ?1").bind(limite).all();
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM pendentes").first();
  return json({ ok: true, ids: results.map((r) => r.id), naFila: total?.n || 0 });
}

async function remover(req, env) {
  let ids;
  try {
    ids = await lerIds(req);
  } catch {
    return json({ ok: false, erro: "formato inválido" }, 400);
  }
  // D1 aceita até 100 parâmetros por consulta
  const lotes = [];
  for (let i = 0; i < ids.length; i += 100) {
    const parte = ids.slice(i, i + 100);
    lotes.push(env.DB.prepare(`DELETE FROM pendentes WHERE id IN (${parte.map(() => "?").join(",")})`).bind(...parte));
  }
  // limpa contadores de dias anteriores
  lotes.push(env.DB.prepare("DELETE FROM limites WHERE dia < ?1").bind(new Date().toISOString().slice(0, 10)));
  await env.DB.batch(lotes);
  return json({ ok: true, removidos: ids.length });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/enviar" && req.method === "POST") return enviar(req, env);

    if (url.pathname.startsWith("/pendentes")) {
      if (!autorizado(req, env)) return json({ ok: false, erro: "não autorizado" }, 401);
      if (url.pathname === "/pendentes" && req.method === "GET") return pendentes(url, env);
      if (url.pathname === "/pendentes/remover" && req.method === "POST") return remover(req, env);
    }

    return json({ ok: true, servico: "Fila da lista compartilhada do Bloqueador de Vídeos de IA para YouTube" });
  }
};
