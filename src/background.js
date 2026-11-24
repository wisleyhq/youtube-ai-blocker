/* global AIB_DEFAULTS, AIB_SHARED_LIST_URL, AIB_SHARED_REFRESH_MS */
// Script de fundo: baixa a lista compartilhada do GitHub.
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

  api.runtime.onInstalled.addListener(() => refresh(true));
  api.runtime.onStartup.addListener(() => refresh(false));

  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "aib:refreshShared") return refresh(!!msg.force);
    return undefined;
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.useSharedList?.newValue === true) refresh(true);
  });
})();
