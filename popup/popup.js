/* global AIB_DEFAULTS */
(() => {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;
  const $ = (id) => document.getElementById(id);

  const CHECKS = ["enabled", "useOfficialLabel", "checkLabelInFeeds", "strictMode", "autoBlockChannels", "blockWatchPage"];
  const LISTS = ["keywords", "blockedChannels", "allowedChannels"];

  const toLines = (arr) => (arr || []).join("\n");
  const fromLines = (txt) => [...new Set(txt.split("\n").map((s) => s.trim()).filter(Boolean))];

  function msg(text, isErr = false) {
    const el = $("msg");
    el.textContent = text;
    el.classList.toggle("err", isErr);
    if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 3500);
  }

  function fill(cfg, stats) {
    CHECKS.forEach((k) => { $(k).checked = !!cfg[k]; });
    $("mode").value = cfg.mode;
    LISTS.forEach((k) => { $(k).value = toLines(cfg[k]); });
    $("nBlocked").textContent = (cfg.blockedChannels || []).length;
    $("total").textContent = (stats?.total || 0).toLocaleString("pt-BR");
  }

  async function load() {
    const s = await api.storage.local.get(null);
    fill({ ...AIB_DEFAULTS, ...s }, s.stats);
  }

  function collect() {
    const out = { mode: $("mode").value };
    CHECKS.forEach((k) => { out[k] = $(k).checked; });
    LISTS.forEach((k) => { out[k] = fromLines($(k).value); });
    return out;
  }

  async function save() {
    await api.storage.local.set(collect());
    $("nBlocked").textContent = fromLines($("blockedChannels").value).length;
    msg("Configurações salvas.");
  }

  // Os interruptores e o modo salvam na hora
  [...CHECKS, "mode"].forEach((k) => $(k).addEventListener("change", save));
  $("save").addEventListener("click", save);

  $("reset").addEventListener("click", async () => {
    const { blockedChannels = [], allowedChannels = [], stats } = await api.storage.local.get(null);
    // Restaura opções e palavras-chave, mas mantém as listas de canais
    const cfg = { ...AIB_DEFAULTS, blockedChannels, allowedChannels };
    await api.storage.local.set(cfg);
    fill(cfg, stats);
    msg("Padrões restaurados (listas de canais mantidas).");
  });

  $("blockCurrent").addEventListener("click", async () => {
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !/^https?:\/\/(www|m)\.youtube\.com\//.test(tab.url)) {
        msg("Abra um vídeo do YouTube nesta aba.", true);
        return;
      }
      const ch = await api.tabs.sendMessage(tab.id, { type: "aib:getChannel" });
      const entry = ch?.handle || ch?.name;
      if (!entry) {
        msg("Não encontrei o canal. Abra a página de um vídeo ou Short.", true);
        return;
      }
      const list = fromLines($("blockedChannels").value);
      if (!list.some((c) => c.toLowerCase() === entry.toLowerCase())) list.push(entry);
      $("blockedChannels").value = toLines(list);
      await save();
      msg(`Canal ${entry}${ch.name && ch.handle ? ` (${ch.name})` : ""} bloqueado.`);
    } catch {
      msg("Recarregue a página do YouTube e tente de novo.", true);
    }
  });

  load();
})();
