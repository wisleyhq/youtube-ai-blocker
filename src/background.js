/* global AIB_DEFAULTS, AIB_SHARED_LIST_URL, AIB_SHARED_REFRESH_MS, AIB_WORKER_URL, AIB_SUBMIT_MAX */
// Script de fundo: baixa a lista compartilhada do GitHub e, se a pessoa
// permitir, envia de forma anônima os vídeos com selo que ela encontrou.
// Fica aqui (e não no content script) porque o pedido feito de dentro da
// página do YouTube fica sujeito às regras da própria página.
(() => {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const RETRY_MS = 30 * 60 * 1000;
  let running = null;

  async function refreshShared(force = false) {
    const { useSharedList = AIB_DEFAULTS.useSharedList, sharedList } =
      await api.storage.local.get(["useSharedList", "sharedList"]);
    if (!useSharedList) return { ok: false, reason: "off" };
    if (!force && sharedList?.fetchedAt && Date.now() - sharedList.fetchedAt < AIB_SHARED_REFRESH_MS) {
      return { ok: true, cached: true };
    }
    try {
      const res = await fetch(AIB_SHARED_LIST_URL, { cache: "no-cache", credentials: "omit" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Guarda só o formato esperado (o arquivo vem da internet)
      const channels = {};
      Object.entries(data?.channels || {}).forEach(([key, c]) => {
        if (typeof key !== "string" || !key.trim() || key.length > 100) return;
        const videos = (Array.isArray(c?.videos) ? c.videos : [])
          .filter((v) => typeof v === "string" && VIDEO_ID_RE.test(v));
        if (videos.length) channels[key] = { name: typeof c.name === "string" ? c.name.slice(0, 100) : "", videos };
      });
      await api.storage.local.set({ sharedList: { fetchedAt: Date.now(), updated: String(data?.updated || ""), channels } });
      return { ok: true };
    } catch (e) {
      // Sem rede ou arquivo indisponível: mantém a lista anterior e tenta de novo em 30 min
      await api.storage.local.set({
        sharedList: { ...(sharedList || {}), fetchedAt: Date.now() - AIB_SHARED_REFRESH_MS + RETRY_MS }
      });
      return { ok: false, reason: String(e) };
    }
  }

  // Um download por vez
  function refresh(force) {
    if (!running) running = refreshShared(force).finally(() => { running = null; });
    return running;
  }

  // ---------- envio anônimo para a fila (Cloudflare Worker) ----------

  const CONSENT = { data_collection: ["browsingActivity"] };
  const SEND_MAX_PER_RUN = 2000; // por rodada (a fila aceita 500 por pedido)
  const ALARM = "aib-6h";
  let sending = null;

  async function hasConsent() {
    try {
      return await api.permissions.contains(CONSENT);
    } catch {
      return false;
    }
  }

  // Vídeos com selo vistos aqui que não estão na lista nem foram enviados
  function candidates(s) {
    const inShared = new Set(Object.values(s.sharedList?.channels || {}).flatMap((c) => c.videos || []));
    const sent = new Set(s.submittedVideos || []);
    const mine = Object.values(s.aiChannels || {}).flatMap((c) => c.videos || []);
    return [...new Set(mine)].filter((id) => !inShared.has(id) && !sent.has(id));
  }

  async function sendPending(manual) {
    const s = await api.storage.local.get(["autoShare", "aiChannels", "sharedList", "submittedVideos"]);
    if (!manual && !s.autoShare) return { ok: false, reason: "off" };
    if (!(await hasConsent())) return { ok: false, reason: "consent" };

    const todo = candidates(s);
    const batch = todo.slice(0, SEND_MAX_PER_RUN);
    let sent = 0;
    let error = "";
    for (let i = 0; i < batch.length; i += AIB_SUBMIT_MAX) {
      const part = batch.slice(i, i + AIB_SUBMIT_MAX);
      try {
        const res = await fetch(`${AIB_WORKER_URL}/enviar`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: part }),
          credentials: "omit"
        });
        if (!res.ok) {
          error = res.status === 429 ? "limite de envios do dia atingido" : `o servidor respondeu ${res.status}`;
          break;
        }
      } catch {
        error = "sem conexão com o servidor";
        break;
      }
      sent += part.length;
      const { submittedVideos = [] } = await api.storage.local.get("submittedVideos");
      await api.storage.local.set({ submittedVideos: [...submittedVideos, ...part].slice(-20000) });
    }
    const result = { ok: !error, when: Date.now(), sent, left: todo.length - sent, error };
    await api.storage.local.set({ lastShare: result });
    return result;
  }

  function send(manual) {
    if (!sending) sending = sendPending(manual).finally(() => { sending = null; });
    return sending;
  }

  // ---------- agenda e mensagens ----------

  function schedule() {
    api.alarms.create(ALARM, { delayInMinutes: 5, periodInMinutes: 360 });
  }

  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM) return;
    refresh(false).finally(() => send(false));
  });

  api.runtime.onInstalled.addListener(() => {
    schedule();
    refresh(true);
  });
  api.runtime.onStartup.addListener(() => {
    schedule();
    refresh(false);
  });

  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "aib:refreshShared") return refresh(!!msg.force);
    if (msg?.type === "aib:sendNow") return send(true);
    return undefined;
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.useSharedList?.newValue === true) refresh(true);
    if (changes.autoShare?.newValue === true) send(false);
  });
})();
