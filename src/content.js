/* global AIB_DEFAULTS, AIB_LABEL_PHRASES, AIB_LABEL_HELP_IDS, AIB_HISTORY_MAX */
(() => {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;
  // No Firefox, content.fetch faz a requisição como se fosse a própria página
  const pageFetch = (globalThis.content && typeof globalThis.content.fetch === "function")
    ? globalThis.content.fetch.bind(globalThis.content)
    : globalThis.fetch.bind(globalThis);

  // Cartões de vídeo usados pelo YouTube (layout antigo, novo e mobile)
  const CARD_SELECTOR = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-reel-item-renderer",
    "ytd-playlist-video-renderer",
    "ytd-playlist-panel-video-renderer",
    "yt-lockup-view-model",
    "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2",
    "ytm-video-with-context-renderer",
    "ytm-compact-video-renderer"
  ].join(",");

  const TITLE_SELECTOR = [
    "#video-title",
    "#video-title-link",
    ".yt-lockup-metadata-view-model__title",
    ".shortsLockupViewModelHostMetadataTitle",
    ".shortsLockupViewModelHostOutsideMetadataTitle",
    "h3"
  ].join(",");

  let cfg = { ...AIB_DEFAULTS };
  let blockedSet = new Set();
  let allowedSet = new Set();
  let allowedVideoSet = new Set();

  // Estado da página de vídeo atual
  const watch = { id: null, blocked: false, allowed: false, reason: "", checking: false };

  // ---------- utilidades ----------

  const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

  function applyConfig(stored) {
    cfg = { ...AIB_DEFAULTS, ...stored };
    blockedSet = new Set((cfg.blockedChannels || []).map(norm).filter(Boolean));
    allowedSet = new Set((cfg.allowedChannels || []).map(norm).filter(Boolean));
    allowedVideoSet = new Set((cfg.allowedVideos || []).map((s) => String(s).trim()).filter(Boolean));
  }

  function handleFromHref(href) {
    if (!href) return "";
    try {
      const path = new URL(href, location.origin).pathname.split("/").filter(Boolean);
      if (!path.length) return "";
      if (path[0].startsWith("@")) return decodeURIComponent(path[0]);
      if (path[0] === "channel" || path[0] === "c" || path[0] === "user") return decodeURIComponent(path[1] || "");
    } catch { /* ignora */ }
    return "";
  }

  function videoIdFromHref(href) {
    if (!href) return null;
    try {
      const u = new URL(href, location.origin);
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/shorts\/([^/?#]+)/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  function channelKeys(root, nameSelectors) {
    const keys = new Set();
    root.querySelectorAll('a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]').forEach((a) => {
      const h = handleFromHref(a.getAttribute("href"));
      if (h) keys.add(norm(h));
      const t = norm(a.textContent);
      if (t && t.length < 80) keys.add(t);
    });
    if (nameSelectors) {
      root.querySelectorAll(nameSelectors).forEach((n) => {
        const t = norm(n.textContent);
        if (t && t.length < 80) keys.add(t);
      });
    }
    return keys;
  }

  function cardChannel(el) {
    const a = el.querySelector('a[href^="/@"], a[href^="/channel/"]');
    return { handle: a ? handleFromHref(a.getAttribute("href")) : "", name: (a?.textContent || "").trim() };
  }

  const anyIn = (keys, set) => [...keys].some((k) => set.has(k));

  // ---------- rótulo oficial via API interna do YouTube ----------

  const labelCache = new Map(); // id -> true/false
  let cacheLoaded = false;
  let cacheSaveTimer = null;
  const CACHE_MAX = 4000;

  async function loadCache() {
    if (cacheLoaded) return;
    cacheLoaded = true;
    const { labelCache: saved = {} } = await api.storage.local.get("labelCache");
    Object.entries(saved).forEach(([k, v]) => labelCache.set(k, !!v));
  }

  function saveCacheSoon() {
    clearTimeout(cacheSaveTimer);
    cacheSaveTimer = setTimeout(() => {
      const entries = [...labelCache.entries()].slice(-CACHE_MAX);
      const obj = {};
      entries.forEach(([k, v]) => { obj[k] = v ? 1 : 0; });
      api.storage.local.set({ labelCache: obj });
    }, 3000);
  }

  function sectionHasAiLabel(sectionText) {
    if (AIB_LABEL_HELP_IDS.some((id) => sectionText.includes(`answer/${id}`))) return true;
    const low = sectionText.toLowerCase();
    return AIB_LABEL_PHRASES.some((p) => low.includes(p));
  }

  async function fetchLabel(id) {
    const res = await pageFetch("https://www.youtube.com/youtubei/v1/next?prettyPrint=false", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: "2.20261101.00.00", hl: "pt", gl: "BR" } },
        videoId: id
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Procura a seção "Como este conteúdo foi criado", o título e o canal na resposta
    const sections = [];
    let owner = null;
    let primary = null;
    const stack = [data];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== "object") continue;
      for (const k in o) {
        if (k === "howThisWasMadeSectionViewModel") sections.push(o[k]);
        else if (k === "videoOwnerRenderer" && !owner) owner = o[k];
        else if (k === "videoPrimaryInfoRenderer" && !primary) primary = o[k];
        if (o[k] && typeof o[k] === "object") stack.push(o[k]);
      }
    }
    const runsText = (x) => (x?.runs || []).map((r) => r.text).join("") || x?.simpleText || "";
    const ownerRun = owner?.title?.runs?.[0];
    const base = ownerRun?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ||
                 owner?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || "";
    return {
      ai: sections.some((s) => sectionHasAiLabel(JSON.stringify(s))),
      title: runsText(primary?.title).trim(),
      ch: { handle: handleFromHref(base), name: runsText(owner?.title).trim() }
    };
  }

  // Título e canal dos vídeos consultados nesta página (não vão para o cache)
  const labelInfo = new Map(); // id -> { title, ch }

  // Fila com no máximo 2 consultas simultâneas
  const queue = [];
  const waiting = new Map(); // id -> [callbacks]
  let active = 0;
  let pausedUntil = 0;

  function checkLabel(id) {
    if (labelCache.has(id)) return Promise.resolve(labelCache.get(id));
    return new Promise((resolve) => {
      if (waiting.has(id)) {
        waiting.get(id).push(resolve);
        return;
      }
      waiting.set(id, [resolve]);
      queue.push(id);
      pump();
    });
  }

  function pump() {
    if (Date.now() < pausedUntil) {
      setTimeout(pump, pausedUntil - Date.now() + 50);
      return;
    }
    while (active < 2 && queue.length) {
      const id = queue.shift();
      active++;
      fetchLabel(id)
        .then(({ ai, title, ch }) => {
          labelInfo.set(id, { title, ch });
          labelCache.set(id, ai);
          saveCacheSoon();
          return ai;
        })
        .catch(() => {
          pausedUntil = Date.now() + 30000; // YouTube recusou: espera 30 s
          return null;
        })
        .then((ai) => {
          (waiting.get(id) || []).forEach((cb) => cb(ai));
          waiting.delete(id);
          active--;
          pump();
        });
    }
  }

  // ---------- estatística ----------

  let pendingCount = 0;
  let countTimer = null;
  function bumpCounter() {
    pendingCount++;
    clearTimeout(countTimer);
    countTimer = setTimeout(async () => {
      const n = pendingCount;
      pendingCount = 0;
      const { stats = { total: 0 } } = await api.storage.local.get("stats");
      stats.total = (stats.total || 0) + n;
      await api.storage.local.set({ stats });
    }, 1500);
  }

  async function autoBlockChannel(ch) {
    const entry = ch.handle || ch.name;
    if (!entry || blockedSet.has(norm(entry)) || allowedSet.has(norm(entry))) return;
    blockedSet.add(norm(entry));
    const { blockedChannels = [] } = await api.storage.local.get("blockedChannels");
    if (blockedChannels.map(norm).includes(norm(entry))) return;
    blockedChannels.push(entry);
    await api.storage.local.set({ blockedChannels });
  }

  // ---------- histórico de vídeos e contagem por canal ----------
  // blockedVideos: { id: { title, channel, handle, reason, shorts, first, last } }
  // aiChannels:    { chave: { handle, name, videos: [ids com o rótulo de IA] } }

  const pendingHistory = new Map();
  const pendingAi = new Map();
  let recordTimer = null;

  // Grava no máximo 1,5 s depois do primeiro registro (sem adiar a cada novo)
  function recordSoon() {
    if (recordTimer) return;
    recordTimer = setTimeout(() => {
      recordTimer = null;
      flushRecords();
    }, 1500);
  }

  // Não perde o que está pendente ao fechar ou trocar de aba
  const flushNow = () => {
    clearTimeout(recordTimer);
    recordTimer = null;
    flushRecords();
  };
  window.addEventListener("pagehide", flushNow);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushNow(); });

  function recordBlocked(id, { title = "", ch = {}, reason = "", shorts = false }) {
    if (!id) return;
    const prev = pendingHistory.get(id) || {};
    pendingHistory.set(id, {
      title: title || prev.title || "",
      channel: ch.name || prev.channel || "",
      handle: ch.handle || prev.handle || "",
      reason: reason || prev.reason || "",
      shorts: shorts || prev.shorts || false
    });
    recordSoon();
  }

  function recordAiVideo(id, ch) {
    if (!id || !ch || !(ch.handle || ch.name)) return;
    pendingAi.set(id, ch);
    recordSoon();
  }

  function findChannelKey(channels, ch) {
    const h = norm(ch.handle);
    const n = norm(ch.name);
    if (h && channels[h]) return h;
    // mesmo canal visto antes só pelo nome (ou só pelo @handle)
    for (const [k, c] of Object.entries(channels)) {
      if ((h && norm(c.handle) === h) || (n && norm(c.name) === n)) return k;
    }
    return h || n;
  }

  // Uma gravação por vez, para uma não sobrescrever a outra
  let flushChain = Promise.resolve();
  function flushRecords() {
    flushChain = flushChain.then(writeRecords).catch(() => {});
    return flushChain;
  }

  async function writeRecords() {
    if (!pendingHistory.size && !pendingAi.size) return;
    const hist = new Map(pendingHistory);
    const ai = new Map(pendingAi);
    pendingHistory.clear();
    pendingAi.clear();

    const { blockedVideos = {}, aiChannels = {} } = await api.storage.local.get(["blockedVideos", "aiChannels"]);
    const now = Date.now();

    hist.forEach((e, id) => {
      const old = blockedVideos[id] || {};
      blockedVideos[id] = {
        title: e.title || old.title || "",
        channel: e.channel || old.channel || "",
        handle: e.handle || old.handle || "",
        reason: e.reason || old.reason || "",
        shorts: e.shorts || old.shorts || false,
        first: old.first || now,
        last: now
      };
    });
    const ids = Object.keys(blockedVideos);
    if (ids.length > AIB_HISTORY_MAX) {
      ids.sort((a, b) => (blockedVideos[a].last || 0) - (blockedVideos[b].last || 0))
        .slice(0, ids.length - AIB_HISTORY_MAX)
        .forEach((id) => delete blockedVideos[id]);
    }

    const reached = [];
    ai.forEach((ch, id) => {
      const key = findChannelKey(aiChannels, ch);
      if (!key) return;
      const c = aiChannels[key] || (aiChannels[key] = { handle: "", name: "", videos: [] });
      c.handle = c.handle || ch.handle || "";
      c.name = c.name || ch.name || "";
      if (!c.videos.includes(id)) c.videos.push(id);
      if (c.videos.length > (cfg.autoBlockThreshold ?? 10)) reached.push(c);
    });

    await api.storage.local.set({ blockedVideos, aiChannels });
    if (cfg.autoBlockChannels) {
      for (const c of reached) await autoBlockChannel(c);
    }
  }

  // ---------- cartões nos feeds ----------

  const LABEL_REASON = "selo oficial \"Criado com IA\" do YouTube";

  function clearCard(el) {
    delete el.dataset.aibState;
    delete el.dataset.aibSig;
    delete el.dataset.aibVid;
    delete el.dataset.aibRevealed;
    el.querySelectorAll(":scope > .aib-badge").forEach((b) => b.remove());
  }

  function blockCard(el, reason) {
    if (el.dataset.aibState) return;
    bumpCounter();
    const vid = el.dataset.aibVid;
    if (vid) {
      const info = labelInfo.get(vid);
      const ch = cardChannel(el);
      recordBlocked(vid, {
        title: el.dataset.aibSig || info?.title,
        ch: { handle: ch.handle || info?.ch.handle, name: ch.name || info?.ch.name },
        reason,
        shorts: !!el.querySelector('a[href*="/shorts/"]')
      });
      // Bloqueado pela lista de canais: consulta o rótulo mesmo assim, para
      // completar o histórico e contar os vídeos de IA do canal
      if (reason !== LABEL_REASON && cfg.checkLabelInFeeds) {
        checkLabel(vid).then((ai) => {
          const got = labelInfo.get(vid);
          const hasCh = !!(got?.ch.handle || got?.ch.name);
          if (hasCh) recordBlocked(vid, { title: got.title, ch: got.ch });
          if (ai) recordAiVideo(vid, hasCh ? got.ch : ch);
        });
      }
    }
    if (cfg.mode === "blur") {
      el.dataset.aibState = "blur";
      const badge = document.createElement("div");
      badge.className = "aib-badge";
      const strong = document.createElement("strong");
      strong.textContent = "Vídeo de IA";
      const small = document.createElement("span");
      small.textContent = `(${reason}) — clique para mostrar`;
      badge.append(strong, small);
      badge.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.dataset.aibRevealed = "1";
        badge.remove();
      }, true);
      el.appendChild(badge);
    } else {
      el.dataset.aibState = "hide";
    }
  }

  function evaluateCard(el) {
    const titleEl = el.querySelector(TITLE_SELECTOR);
    const title = (titleEl?.getAttribute("title") || titleEl?.textContent || "").trim();
    const sig = title || (el.textContent || "").trim().slice(0, 120);
    if (!sig) return; // ainda carregando
    if (el.dataset.aibSig === sig) return; // já avaliado
    clearCard(el);
    el.dataset.aibSig = sig;

    const vidLink = el.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
    const vid = videoIdFromHref(vidLink?.getAttribute("href"));
    if (vid) el.dataset.aibVid = vid;
    if (vid && allowedVideoSet.has(vid)) return;

    const keys = channelKeys(el);
    // nomes de canal no layout novo aparecem como linhas de texto soltas
    (el.innerText || el.textContent || "").split("\n").forEach((line) => {
      const t = norm(line);
      if (t && t.length < 80) keys.add(t);
    });

    if (anyIn(keys, allowedSet)) return;
    if (anyIn(keys, blockedSet)) {
      blockCard(el, "canal bloqueado");
      return;
    }

    // Só bloqueia com o rótulo oficial do YouTube (consulta assíncrona)
    if (vid && cfg.checkLabelInFeeds) {
      checkLabel(vid).then((ai) => {
        if (!ai || el.dataset.aibVid !== vid || el.dataset.aibRevealed === "1") return;
        blockCard(el, LABEL_REASON);
        const info = labelInfo.get(vid);
        const ch = cardChannel(el);
        recordAiVideo(vid, (info?.ch.handle || info?.ch.name) ? info.ch : ch);
      });
    }
  }

  function scanCards() {
    document.querySelectorAll(CARD_SELECTOR).forEach((el) => {
      // Processa só o cartão mais externo (evita deixar "buracos" na grade)
      if (el.parentElement?.closest(CARD_SELECTOR)) return;
      if (el.dataset.aibRevealed === "1") return;
      evaluateCard(el);
    });
  }

  // ---------- página do vídeo / Shorts ----------

  function currentVideoId() {
    return videoIdFromHref(location.href);
  }

  function watchContainer() {
    if (location.pathname.startsWith("/shorts/")) {
      return document.querySelector("ytd-reel-video-renderer[is-active]") ||
             document.querySelector("ytd-shorts") || document.body;
    }
    return document.querySelector("ytd-watch-metadata") ||
           document.querySelector("ytd-watch-flexy #below") ||
           document.querySelector("ytm-slim-video-metadata-section-renderer") || document.body;
  }

  function domHasLabel(container) {
    // Só olha dentro da área do vídeo atual (o painel lateral pode ter restos do vídeo anterior)
    return [...container.querySelectorAll("how-this-was-made-section-view-model")].some((sec) => {
      const links = [...sec.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).join(" ");
      return sectionHasAiLabel(`${links} ${sec.textContent || ""}`);
    });
  }

  function currentChannel(container = watchContainer()) {
    const link = container.querySelector('ytd-channel-name a, a[href^="/@"], a[href^="/channel/"]');
    const handle = link ? handleFromHref(link.getAttribute("href")) : "";
    const nameEl = container.querySelector("ytd-channel-name #text, ytd-channel-name a, .ytReelChannelBarViewModelChannelName, a[href^='/@']");
    const name = (nameEl?.textContent || "").trim();
    return { handle, name };
  }

  function watchTitle(c = watchContainer()) {
    return (document.querySelector("ytd-watch-metadata h1")?.textContent ||
            c.querySelector("h2, .ytShortsVideoTitleViewModelShortsVideoTitle")?.textContent ||
            "").trim();
  }

  function blockWatch(reason, isLabel) {
    if (watch.blocked || watch.allowed) return;
    watch.blocked = true;
    watch.reason = reason;
    bumpCounter();
    const id = watch.id;
    const shorts = location.pathname.startsWith("/shorts/");
    // espera o título e o canal aparecerem na página
    setTimeout(() => {
      const info = labelInfo.get(id);
      const samePage = watch.id === id;
      const pageCh = samePage ? currentChannel() : {};
      const ch = (info?.ch.handle || info?.ch.name) ? info.ch : pageCh;
      recordBlocked(id, { title: (samePage && watchTitle()) || info?.title, ch, reason, shorts });
      if (isLabel) recordAiVideo(id, ch);
    }, 1500);
    if (cfg.blockWatchPage) showWall(reason);
  }

  function evaluateWatch() {
    const id = currentVideoId();
    if (!id) {
      watch.id = null;
      removeWall();
      return;
    }
    if (id !== watch.id) {
      Object.assign(watch, { id, blocked: false, allowed: false, reason: "", checking: false });
      removeWall();
    }
    if (watch.allowed || watch.blocked || allowedVideoSet.has(id)) return;

    const c = watchContainer();
    const keys = channelKeys(c, "ytd-channel-name #text, .ytReelChannelBarViewModelChannelName");
    if (anyIn(keys, allowedSet)) return;

    if (domHasLabel(c)) {
      blockWatch(LABEL_REASON, true);
      return;
    }
    if (!watch.checking) {
      watch.checking = true;
      checkLabel(id).then((ai) => {
        if (!ai || watch.id !== id) return;
        if (!watch.blocked) {
          blockWatch(LABEL_REASON, true);
          return;
        }
        // Já bloqueado pela lista de canais: só conta o vídeo de IA do canal
        const info = labelInfo.get(id);
        recordAiVideo(id, (info?.ch.handle || info?.ch.name) ? info.ch : currentChannel());
      });
    }

    if (anyIn(keys, blockedSet)) blockWatch("canal bloqueado");
  }

  function pauseAll() {
    document.querySelectorAll("video").forEach((v) => { try { v.pause(); } catch { /* ignora */ } });
  }

  // Impede que o vídeo bloqueado volte a tocar sozinho
  document.addEventListener("play", (e) => {
    if (watch.blocked && !watch.allowed && cfg.enabled && cfg.blockWatchPage && e.target instanceof HTMLVideoElement) {
      e.target.pause();
    }
  }, true);

  function showWall(reason) {
    pauseAll();
    if (document.getElementById("aib-wall")) return;
    const wall = document.createElement("div");
    wall.id = "aib-wall";
    const box = document.createElement("div");
    box.className = "aib-wall-box";
    const h = document.createElement("h2");
    h.textContent = "Vídeo de IA bloqueado";
    const p = document.createElement("p");
    p.textContent = `Motivo: ${reason}.`;
    const actions = document.createElement("div");
    actions.className = "aib-wall-actions";

    const back = document.createElement("button");
    back.textContent = "Voltar";
    back.addEventListener("click", () => {
      if (history.length > 1) history.back();
      else location.href = "https://www.youtube.com/";
    });
    const home = document.createElement("button");
    home.textContent = "Ir para o início";
    home.addEventListener("click", () => { location.href = "https://www.youtube.com/"; });
    const watchAnyway = document.createElement("button");
    watchAnyway.className = "aib-secondary";
    watchAnyway.textContent = "Assistir mesmo assim";
    watchAnyway.addEventListener("click", () => {
      watch.allowed = true;
      removeWall();
      document.querySelector("video")?.play().catch(() => {});
    });

    actions.append(back, home, watchAnyway);
    box.append(h, p, actions);
    wall.appendChild(box);
    document.documentElement.appendChild(wall);
  }

  function removeWall() {
    document.getElementById("aib-wall")?.remove();
  }

  // ---------- ciclo principal ----------

  function resetAll(keepWatch) {
    document.querySelectorAll("[data-aib-sig]").forEach(clearCard);
    if (keepWatch) return;
    Object.assign(watch, { id: null, blocked: false, allowed: false, reason: "", checking: false });
    removeWall();
  }

  function run() {
    if (!cfg.enabled) return;
    scanCards();
    evaluateWatch();
  }

  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      run();
    }, 250);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  // Navegação interna do YouTube (SPA)
  document.addEventListener("yt-navigate-finish", schedule);
  window.addEventListener("popstate", schedule);

  const IGNORED_KEYS = new Set(["stats", "labelCache", "blockedVideos", "aiChannels"]);
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const keys = Object.keys(changes).filter((k) => !IGNORED_KEYS.has(k));
    if (!keys.length) return;
    // Se só a lista de canais bloqueados mudou (ex.: bloqueio automático),
    // mantém o que já foi decidido para não piscar a página.
    const onlyBlocked = keys.every((k) => k === "blockedChannels");
    api.storage.local.get(null).then((s) => {
      applyConfig(s);
      if (onlyBlocked) {
        // reavalia só o que ainda não foi bloqueado
        document.querySelectorAll("[data-aib-sig]:not([data-aib-state])").forEach((el) => { delete el.dataset.aibSig; });
      } else {
        resetAll(false);
      }
      run();
    });
  });

  // Mensagens do popup
  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "aib:getChannel") {
      return Promise.resolve(currentVideoId() ? currentChannel() : null);
    }
    return undefined;
  });

  Promise.all([api.storage.local.get(null), loadCache()]).then(([s]) => {
    applyConfig(s);
    run();
  });
})();
