/* global AIB_DEFAULTS, AIB_REPO_URL, AIB_SUBMIT_MAX */
(() => {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;
  const $ = (id) => document.getElementById(id);
  const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const YT = "https://www.youtube.com";

  let data = {};

  // ---------- utilidades ----------

  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") e.className = v;
      else if (k === "onclick") e.addEventListener("click", v);
      else e.setAttribute(k, v);
    });
    children.flat().forEach((c) => { if (c != null) e.append(c); });
    return e;
  }

  const videoUrl = (id, shorts) => (shorts ? `${YT}/shorts/${id}` : `${YT}/watch?v=${id}`);
  const channelUrl = (handle) => (handle.startsWith("@") ? `${YT}/${handle}` : `${YT}/channel/${handle}`);
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");

  function msg(text, isErr = false) {
    const m = $("msg");
    m.textContent = text;
    m.classList.toggle("err", isErr);
    if (text) setTimeout(() => { if (m.textContent === text) m.textContent = ""; }, 4000);
  }

  function channelCell(name, handle) {
    if (!name && !handle) return "—";
    const label = name || handle;
    return [
      handle ? el("a", { href: channelUrl(handle), target: "_blank", rel: "noopener" }, label) : label,
      handle && name ? el("span", { class: "sub" }, handle) : null
    ];
  }

  // ---------- vídeos ----------

  function renderVideos() {
    const vids = data.blockedVideos || {};
    const q = norm($("qVideos").value);
    const rows = Object.entries(vids)
      .filter(([, v]) => !q || norm(`${v.title} ${v.channel} ${v.handle} ${v.reason}`).includes(q))
      .sort((a, b) => (b[1].last || 0) - (a[1].last || 0));

    $("nVideos").textContent = Object.keys(vids).length;
    $("videosBody").replaceChildren(...rows.map(([id, v]) => el("tr", {},
      el("td", {}, el("a", { href: videoUrl(id, v.shorts), target: "_blank", rel: "noopener" }, v.title || id),
        v.shorts ? el("span", { class: "sub" }, "Short") : null),
      el("td", {}, channelCell(v.channel, v.handle)),
      el("td", {}, v.reason || "—"),
      el("td", { class: "when" }, fmtDate(v.last)),
      el("td", { class: "actions" }, el("button", { class: "small", onclick: () => allowVideo(id, v) }, "Liberar"))
    )));
    $("videosEmpty").hidden = rows.length > 0;
    $("videosEmpty").textContent = q && Object.keys(vids).length ? "Nada encontrado." : "Nenhum vídeo bloqueado ainda.";
  }

  async function allowVideo(id, v) {
    const { allowedVideos = [], allowedVideoInfo = {}, blockedVideos = {} } =
      await api.storage.local.get(["allowedVideos", "allowedVideoInfo", "blockedVideos"]);
    if (!allowedVideos.includes(id)) allowedVideos.push(id);
    allowedVideoInfo[id] = { title: v.title || "", channel: v.channel || "", shorts: !!v.shorts };
    delete blockedVideos[id];
    await api.storage.local.set({ allowedVideos, allowedVideoInfo, blockedVideos });
    msg(`"${v.title || id}" liberado. Recarregue o YouTube para ver.`);
  }

  // ---------- canais ----------

  function buildChannels() {
    const ai = data.aiChannels || {};
    const blocked = (data.blockedChannels || []).map((s) => s.trim()).filter(Boolean);
    const allowed = (data.allowedChannels || []).map((s) => s.trim()).filter(Boolean);
    const blockedN = new Set(blocked.map(norm));
    const allowedN = new Set(allowed.map(norm));
    const rows = new Map();

    Object.values(ai).forEach((c) => {
      const key = norm(c.handle || c.name);
      if (key) rows.set(key, { handle: c.handle || "", name: c.name || "", count: c.videos?.length || 0 });
    });
    const findRow = (entry) => {
      const n = norm(entry);
      for (const [k, r] of rows) if (k === n || norm(r.handle) === n || norm(r.name) === n) return r;
      return null;
    };
    [...blocked, ...allowed].forEach((entry) => {
      if (findRow(entry)) return;
      rows.set(norm(entry), { handle: entry.startsWith("@") ? entry : "", name: entry.startsWith("@") ? "" : entry, count: 0 });
    });

    const sharedN = sharedBlockedKeys();
    rows.forEach((r) => {
      const keys = [norm(r.handle), norm(r.name)].filter(Boolean);
      r.allowed = keys.some((k) => allowedN.has(k));
      r.blocked = !r.allowed && keys.some((k) => blockedN.has(k));
      r.shared = !r.allowed && !r.blocked && keys.some((k) => sharedN.has(k));
      r.entry = r.handle || r.name;
    });
    return [...rows.values()];
  }

  // Canais bloqueados pela lista compartilhada (mesma regra do content script)
  function sharedBlockedKeys() {
    const out = new Set();
    const on = (data.useSharedList ?? AIB_DEFAULTS.useSharedList) && (data.autoBlockChannels ?? AIB_DEFAULTS.autoBlockChannels);
    if (!on) return out;
    const limit = data.autoBlockThreshold ?? AIB_DEFAULTS.autoBlockThreshold;
    Object.entries(data.sharedList?.channels || {}).forEach(([k, c]) => {
      if ((c.videos?.length || 0) > limit) out.add(norm(k));
    });
    return out;
  }

  function renderChannels() {
    const limit = data.autoBlockThreshold ?? AIB_DEFAULTS.autoBlockThreshold;
    const auto = data.autoBlockChannels ?? AIB_DEFAULTS.autoBlockChannels;
    $("channelsHint").textContent = auto
      ? `Um canal é bloqueado sozinho quando tem mais de ${limit} vídeos diferentes com o rótulo oficial "Criado com IA". Só contam vídeos que você viu no YouTube com a extensão ligada.`
      : "O bloqueio automático de canais está desligado no painel. A contagem continua sendo feita.";

    const all = buildChannels();
    const q = norm($("qChannels").value);
    const f = $("fChannels").value;
    const rows = all
      .filter((r) => !q || norm(`${r.name} ${r.handle}`).includes(q))
      .filter((r) => f === "all" || (f === "blocked" && r.blocked) || (f === "allowed" && r.allowed) ||
        (f === "blocked" && r.shared) || (f === "pending" && !r.blocked && !r.allowed && !r.shared))
      .sort((a, b) => ((b.blocked || b.shared) - (a.blocked || a.shared)) || (b.count - a.count) || norm(a.entry).localeCompare(norm(b.entry)));

    $("nChannels").textContent = all.length;
    $("channelsBody").replaceChildren(...rows.map((r) => {
      let chip;
      if (r.allowed) chip = el("span", { class: "chip allow" }, "Sempre permitido");
      else if (r.blocked) chip = el("span", { class: "chip block" }, "Bloqueado");
      else if (r.shared) chip = el("span", { class: "chip block" }, "Bloqueado pela comunidade");
      else {
        const left = Math.max(limit + 1 - r.count, 0);
        chip = el("span", { class: "chip wait" }, auto ? `Faltam ${left} para bloquear` : "Não bloqueado");
      }
      const actions = [];
      if (r.allowed) actions.push(el("button", { class: "small", onclick: () => setChannel(r, "none") }, "Tirar dos permitidos"));
      else if (r.blocked) {
        actions.push(el("button", { class: "small", onclick: () => setChannel(r, "none") }, "Desbloquear"));
        actions.push(el("button", { class: "small", onclick: () => setChannel(r, "allow") }, "Sempre permitir"));
      } else {
        actions.push(el("button", { class: "small", onclick: () => setChannel(r, "block") }, "Bloquear agora"));
        actions.push(el("button", { class: "small", onclick: () => setChannel(r, "allow") }, "Sempre permitir"));
      }
      return el("tr", {},
        el("td", {}, channelCell(r.name, r.handle)),
        el("td", { class: "num" }, String(r.count)),
        el("td", {}, chip),
        el("td", { class: "actions" }, actions));
    }));
    $("channelsEmpty").hidden = rows.length > 0;
    $("channelsEmpty").textContent = q || f !== "all" ? "Nada encontrado." : "Nenhum canal ainda.";
  }

  async function setChannel(r, to) {
    const { blockedChannels = [], allowedChannels = [] } = await api.storage.local.get(["blockedChannels", "allowedChannels"]);
    const mine = new Set([norm(r.handle), norm(r.name)].filter(Boolean));
    const without = (list) => list.filter((s) => !mine.has(norm(s)));
    const b = without(blockedChannels);
    const a = without(allowedChannels);
    if (to === "block") b.push(r.entry);
    if (to === "allow") a.push(r.entry);
    await api.storage.local.set({ blockedChannels: b, allowedChannels: a });
    const name = r.name || r.handle;
    msg(to === "block" ? `${name} bloqueado.`
      : to === "allow" ? `${name} sempre permitido.`
        : `${name} tirado da lista. Se passar do limite de vídeos de IA, volta a ser bloqueado; use "Sempre permitir" para evitar.`);
  }

  // ---------- vídeos liberados ----------

  function renderAllowed() {
    const ids = data.allowedVideos || [];
    const info = data.allowedVideoInfo || {};
    $("nAllowed").textContent = ids.length;
    $("allowedBody").replaceChildren(...[...ids].reverse().map((id) => {
      const v = info[id] || {};
      return el("tr", {},
        el("td", {}, el("a", { href: videoUrl(id, v.shorts), target: "_blank", rel: "noopener" }, v.title || id),
          v.channel ? el("span", { class: "sub" }, v.channel) : null),
        el("td", { class: "actions" }, el("button", { class: "small", onclick: () => unallowVideo(id) }, "Remover")));
    }));
    $("allowedEmpty").hidden = ids.length > 0;
  }

  async function unallowVideo(id) {
    const { allowedVideos = [], allowedVideoInfo = {} } = await api.storage.local.get(["allowedVideos", "allowedVideoInfo"]);
    delete allowedVideoInfo[id];
    await api.storage.local.set({ allowedVideos: allowedVideos.filter((x) => x !== id), allowedVideoInfo });
    msg("Vídeo removido dos liberados.");
  }

  // ---------- compartilhar ----------

  // Vídeos com selo vistos por você que ainda não estão na lista nem foram enviados
  function shareCandidates() {
    const inShared = new Set(Object.values(data.sharedList?.channels || {}).flatMap((c) => c.videos || []));
    const sent = new Set(data.submittedVideos || []);
    const mine = Object.values(data.aiChannels || {}).flatMap((c) => c.videos || []);
    return [...new Set(mine)].filter((id) => !inShared.has(id) && !sent.has(id));
  }

  function renderShare() {
    const list = data.sharedList;
    const chans = Object.values(list?.channels || {});
    const vids = chans.reduce((n, c) => n + (c.videos?.length || 0), 0);
    const on = data.useSharedList ?? AIB_DEFAULTS.useSharedList;
    $("sharedStatus").textContent = !on
      ? "Desligada no painel da extensão."
      : list?.updated
        ? `${vids.toLocaleString("pt-BR")} vídeos de ${chans.length.toLocaleString("pt-BR")} canais. Atualizada em ${new Date(list.updated).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.`
        : "Ainda não foi baixada. Abra o YouTube com a extensão ligada.";

    $("shareLimit").textContent = data.autoBlockThreshold ?? AIB_DEFAULTS.autoBlockThreshold;
    const n = shareCandidates().length;
    $("nShare").textContent = n;
    $("shareCount").textContent = n
      ? `Você encontrou ${n} vídeo(s) com o selo "Criado com IA" que ainda não estão na lista.${n > AIB_SUBMIT_MAX ? ` Serão enviados ${AIB_SUBMIT_MAX} por vez.` : ""}`
      : "Nenhum vídeo novo para enviar. Continue usando o YouTube: os vídeos com selo que você encontrar aparecem aqui.";
    $("share").disabled = n === 0;
  }

  async function share() {
    const ids = shareCandidates().slice(0, AIB_SUBMIT_MAX);
    if (!ids.length) return;
    const body = [
      "Contribuição enviada pela extensão Bloqueador de Vídeos de IA para YouTube.",
      "",
      "Um robô vai conferir cada vídeo no YouTube: só entram na lista os que têm o selo oficial \"Criado com IA\".",
      "Não altere o bloco abaixo.",
      "",
      "```aib-ids",
      ids.join(" "),
      "```"
    ].join("\n");
    const url = `${AIB_REPO_URL}/issues/new?title=${encodeURIComponent(`[lista] ${ids.length} vídeo(s) com selo de IA`)}&body=${encodeURIComponent(body)}`;
    await api.tabs.create({ url });
    const { submittedVideos = [] } = await api.storage.local.get("submittedVideos");
    // guarda os últimos 5000 enviados, para não mandar de novo
    await api.storage.local.set({ submittedVideos: [...submittedVideos, ...ids].slice(-5000) });
    msg(`Abri o GitHub com ${ids.length} vídeo(s). Falta clicar em "Create" lá.`);
  }

  // ---------- geral ----------

  function render() {
    renderVideos();
    renderChannels();
    renderAllowed();
    renderShare();
  }

  async function load() {
    data = await api.storage.local.get(null);
    render();
  }

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.id !== `tab-${b.dataset.tab}`; });
  }));

  $("qVideos").addEventListener("input", renderVideos);
  $("qChannels").addEventListener("input", renderChannels);
  $("fChannels").addEventListener("change", renderChannels);

  $("share").addEventListener("click", share);

  $("clearHistory").addEventListener("click", async () => {
    if (!confirm("Apagar o histórico de vídeos bloqueados? As listas de canais continuam como estão.")) return;
    await api.storage.local.set({ blockedVideos: {} });
    msg("Histórico apagado.");
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (Object.keys(changes).every((k) => k === "labelCache" || k === "stats")) return;
    load();
  });

  load();
})();
