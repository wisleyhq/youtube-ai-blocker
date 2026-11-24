/* global AIB_DEFAULTS, AIB_LABEL_PHRASES, AIB_LABEL_HELP_IDS */
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

  // "AI", "Ai" ou "IA" como palavra solta (diferencia maiúsculas: não pega "ia" de "eu ia")
  const STRICT_RE = /(?<![\p{L}\p{N}_])(AI|Ai|IA)(?![\p{L}\p{N}_])/u;

  let cfg = { ...AIB_DEFAULTS };
  let keywordRegexes = [];
  let blockedSet = new Set();
  let allowedSet = new Set();

  // Estado da página de vídeo atual
  const watch = { id: null, blocked: false, allowed: false, reason: "", checking: false };

  // ---------- utilidades ----------

  const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

  function buildRegex(kw) {
    kw = kw.trim();
    if (!kw) return null;
    // Siglas curtas em maiúsculas (ex.: "IA", "AI") diferenciam maiúsculas,
    // para não confundir "IA" com o verbo "ia".
    const caseSensitive = kw.length <= 3 && kw === kw.toUpperCase() && /\p{Lu}/u.test(kw);
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      return new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, caseSensitive ? "u" : "iu");
    } catch {
      return null;
    }
  }

  function applyConfig(stored) {
    cfg = { ...AIB_DEFAULTS, ...stored };
    keywordRegexes = (cfg.keywords || []).map(buildRegex).filter(Boolean);
    blockedSet = new Set((cfg.blockedChannels || []).map(norm).filter(Boolean));
    allowedSet = new Set((cfg.allowedChannels || []).map(norm).filter(Boolean));
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

  function matchKeyword(text) {
    for (const re of keywordRegexes) if (re.test(text)) return "palavra-chave";
    if (cfg.strictMode && STRICT_RE.test(text)) return "menção a IA no título";
    return null;
  }

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
    // Procura a seção "Como este conteúdo foi criado" na resposta
    const sections = [];
    const stack = [data];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== "object") continue;
      for (const k in o) {
        if (k === "howThisWasMadeSectionViewModel") sections.push(o[k]);
        else if (o[k] && typeof o[k] === "object") stack.push(o[k]);
      }
    }
    return sections.some((s) => sectionHasAiLabel(JSON.stringify(s)));
  }

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
        .then((ai) => {
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

  // ---------- cartões nos feeds ----------

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
    if (cfg.mode === "blur") {
      el.dataset.aibState = "blur";
      const badge = document.createElement("div");
      badge.className = "aib-badge";
      const strong = document.createElement("strong");
      strong.textContent = "Possível vídeo de IA";
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

    const text = `${title}\n${el.innerText || el.textContent || ""}`;
    const keys = channelKeys(el);
    // nomes de canal no layout novo aparecem como linhas de texto soltas
    text.split("\n").forEach((line) => {
      const t = norm(line);
      if (t && t.length < 80) keys.add(t);
    });

    if (anyIn(keys, allowedSet)) return;

    let reason = null;
    if (anyIn(keys, blockedSet)) reason = "canal bloqueado";
    else reason = matchKeyword(text);
    if (reason) {
      blockCard(el, reason);
      return;
    }

    // Nada no texto: consulta o rótulo oficial (assíncrono)
    if (vid && cfg.useOfficialLabel && cfg.checkLabelInFeeds) {
      checkLabel(vid).then((ai) => {
        if (!ai || el.dataset.aibVid !== vid || el.dataset.aibRevealed === "1") return;
        blockCard(el, "rótulo oficial do YouTube");
        if (cfg.autoBlockChannels) autoBlockChannel(cardChannel(el));
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

  function blockWatch(reason, isLabel) {
    if (watch.blocked || watch.allowed) return;
    watch.blocked = true;
    watch.reason = reason;
    bumpCounter();
    if (isLabel && cfg.autoBlockChannels) {
      // espera o nome do canal aparecer na página
      setTimeout(() => autoBlockChannel(currentChannel()), 1500);
    }
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
    if (watch.allowed || watch.blocked) return;

    const c = watchContainer();
    const keys = channelKeys(c, "ytd-channel-name #text, .ytReelChannelBarViewModelChannelName");
    if (anyIn(keys, allowedSet)) return;

    if (cfg.useOfficialLabel) {
      if (domHasLabel(c)) {
        blockWatch("rótulo oficial do YouTube: criado com IA", true);
        return;
      }
      if (!watch.checking) {
        watch.checking = true;
        checkLabel(id).then((ai) => {
          if (ai && watch.id === id) blockWatch("rótulo oficial do YouTube: criado com IA", true);
        });
      }
    }

    const title = (document.querySelector("ytd-watch-metadata h1")?.textContent ||
                   c.querySelector("h2, .ytShortsVideoTitleViewModelShortsVideoTitle")?.textContent ||
                   "").trim();
    if (anyIn(keys, blockedSet)) blockWatch("canal bloqueado");
    else if (title) {
      const r = matchKeyword(title);
      if (r) blockWatch(`${r} no título`);
    }
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

  const IGNORED_KEYS = new Set(["stats", "labelCache"]);
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
