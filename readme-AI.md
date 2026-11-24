# Notas para assistentes de IA (Claude, ChatGPT etc.)

Contexto técnico para quem for alterar este código. O [README.md](README.md) é para os usuários. Não coloque nele notas de implementação.

## Regras do projeto

- **Só o selo oficial bloqueia vídeos.** O dono do projeto decidiu (versão 1.2.0) eliminar falsos positivos. Bloqueio por palavra-chave, título ou "modo rigoroso" foi removido de propósito. Não reintroduza sem pedido explícito.
- O canal só é bloqueado automaticamente com **mais de `autoBlockThreshold` (padrão 10)** vídeos **diferentes** com o selo. A comparação é `>` e não `>=`.
- Interface, comentários, mensagens de commit e documentação em **português do Brasil**.
- Sem dependências, sem build e sem servidor próprio. A extensão só acessa o YouTube (selo) e o `raw.githubusercontent.com` (lista compartilhada, só leitura).
- Nada de `innerHTML` com dados do YouTube: monte o DOM com `createElement` e `textContent`. O `web-ext lint` acusa e a AMO rejeita.
- Antes de commitar, rode `web-ext lint`. A meta é 0 erros e 0 avisos.

## Arquivos

| Arquivo | Papel |
|---|---|
| `manifest.json` | MV3, Firefox 142+, permissão `storage` e hosts `*.youtube.com`. ID gecko `bloqueador-ia-youtube@wisley.local` |
| `src/defaults.js` | `AIB_DEFAULTS` (configurações), `AIB_HISTORY_MAX`, `AIB_LABEL_HELP_IDS`, `AIB_LABEL_PHRASES`. Compartilhado entre o content script e as páginas |
| `src/content.js` | Toda a detecção e o bloqueio (IIFE única) |
| `src/background.js` | Script de fundo (`background.scripts`): baixa a lista compartilhada. Fica fora do content script porque, no Firefox, o `fetch` feito de dentro da página do YouTube não completava |
| `lists/ai-list.json` | Lista compartilhada: `{version, updated, channels: {"@handle": {name, videos: [ids]}}}`. Só o robô deve gravar nela |
| `scripts/verify-list.mjs` | Script do robô (Node 20, sem dependências). Lê IDs do bloco `aib-ids` da issue (env `ISSUE_BODY`) ou de argumentos, confere o selo de cada um e grava a lista e `resultado.md`. Reaproveita `AIB_LABEL_*` de `src/defaults.js` via `vm` |
| `.github/workflows/lista-compartilhada.yml` | Roda o script em issues com título `[lista]`, faz commit da lista, comenta e fecha a issue |
| `src/content.css` | `[data-aib-state=hide|blur]`, `.aib-badge`, `#aib-wall` |
| `popup/popup.*` | Painel do ícone (configurações). Salva na hora ao mudar interruptores |
| `popup/lists.*` | Página "Vídeos e canais bloqueados", aberta numa aba via `runtime.getURL` |
| `TESTES.md` | Resultados de testes em páginas reais, com datas |

## Como o selo é detectado

1. **Página do vídeo/Short:** procura `how-this-was-made-section-view-model` dentro de `watchContainer()`. Fora dele, o painel lateral pode ter restos do vídeo anterior.
2. **Miniaturas, e também a página do vídeo quando o DOM ainda não tem o selo:** faz `POST https://www.youtube.com/youtubei/v1/next` com `videoId`. Usa `content.fetch` no Firefox, que envia como a própria página.
   - Na resposta, percorre o JSON procurando `howThisWasMadeSectionViewModel`, o `videoOwnerRenderer` (canal) e o `videoPrimaryInfoRenderer` (título).
3. `sectionHasAiLabel()`: o sinal principal é o link de ajuda `support.google.com/youtube/answer/15447836`, que funciona em qualquer idioma (`AIB_LABEL_HELP_IDS`). As frases em `AIB_LABEL_PHRASES` são só reserva.
   - "Dublagem automática" usa o artigo 15569972 e **não** pode bloquear.
4. Fila de consultas com no máximo 2 simultâneas. Se o YouTube recusar, pausa 30 s.
   - `labelCache` (id → 0/1, até 4000 entradas) fica em `storage.local`.
   - `labelInfo` (título/canal) fica só em memória.
5. Vídeos que estão na lista compartilhada contam como "com selo" sem consultar o YouTube (`sharedVideoMap`).
6. A consulta também devolve o canal. Ele é guardado no cache e usado para aplicar as listas de canais mesmo quando a página não mostra o canal (Shorts na busca e na página do canal).
7. Cartões bloqueados pela lista de canais também consultam o selo. Isso completa o canal no histórico (os Shorts na busca não têm link do canal no DOM) e conta os vídeos de IA.

## Armazenamento (`browser.storage.local`)

| Chave | Formato |
|---|---|
| configurações | as chaves de `AIB_DEFAULTS` |
| `blockedChannels` / `allowedChannels` | `string[]` com `@handle` ou nome exibido. Comparação via `norm()` (trim, minúsculas, espaços únicos) |
| `allowedVideos` | `string[]` de IDs. `allowedVideoInfo`: `{id: {title, channel, shorts}}`, só para exibir |
| `blockedVideos` | `{id: {title, channel, handle, reason, shorts, first, last}}`. Limitado a `AIB_HISTORY_MAX` pelo `last` |
| `aiChannels` | `{chave: {handle, name, videos: [ids com selo]}}`. Chave = handle normalizado (ou nome). `findChannelKey` junta o mesmo canal visto por nome ou por handle |
| `labelCache` | `{id: 0|1}` (formato antigo) ou `{id: [0|1, "@handle"]}` |
| `sharedList` | `{fetchedAt, updated, channels}`, cópia filtrada de `lists/ai-list.json`. Atualizada pelo `background.js` a cada 12 h. Em caso de erro, nova tentativa em 30 min |
| `submittedVideos` | IDs já enviados para a lista compartilhada (últimos 5000) |
| `stats` | `{total}`. Conta bloqueios exibidos, inclusive repetidos |

- Gravações do histórico e da contagem: `recordBlocked`/`recordAiVideo` → `flushRecords`.
  - Grava no máximo 1,5 s após o primeiro registro, em série (`flushChain`), e também em `pagehide`/`visibilitychange`.
  - Não troque por debounce que adia a cada registro: com consultas contínuas a gravação nunca acontecia.
- `storage.onChanged` no content script ignora `stats`, `labelCache`, `blockedVideos` e `aiChannels`. Se só `blockedChannels` mudou, reavalia sem desfazer o que já foi bloqueado.

## Testes

Não há testes unitários. Os testes são feitos no YouTube real:

- **Firefox real automatizado:** `puppeteer-core` 24 com `browser: "firefox"` (WebDriver BiDi), `executablePath` do Firefox instalado e `browser.installExtension(pasta)`. Instale fora do repositório.
- O BiDi **não abre páginas `moz-extension://`**, nem em iframe. Para testar o histórico, use uma cópia da extensão que copie o `storage` para `document.documentElement.dataset` da página. Para testar as páginas da extensão, use um HTML com `browser.storage` simulado.
- **Vídeos de referência:**
  - com selo: `upsQiTCQVrw`, `CRKKvnc4nxQ`, `lO8p9z0CvzU` e o Short `KoOY36Glshc`;
  - sem selo: `dx05ivXQ4Ko`, `TNM8moLggbI` (só dublagem automática) e `dQw4w9WgXcQ`.
- Registre resultados novos em `TESTES.md`, com data e versão.

## Lista compartilhada: como funciona

- **Receber:** o `background.js` baixa `AIB_SHARED_LIST_URL` (raw do GitHub, com CORS `*`, sem cookies). O content script monta:
  - `sharedVideoMap`: vídeos que contam como "com selo";
  - `sharedBlockedSet`: chaves de canais com **mais de `autoBlockThreshold`** vídeos na lista. Só vale com `autoBlockChannels` ligado. Motivo exibido: "canal na lista compartilhada".
- **Enviar:** a aba Compartilhar (`popup/lists.js`) junta os IDs de `aiChannels`, exceto os que já estão na lista ou em `submittedVideos`, até `AIB_SUBMIT_MAX` (300). Depois abre `github.com/.../issues/new` com o título `[lista] ...` e um bloco `aib-ids`. A pessoa confirma no GitHub.
  - Não grave no GitHub direto da extensão: isso exigiria token embutido.
- **Robô:** só confia nos IDs. O texto da issue entra no script por variável de ambiente e nunca é interpolado no shell.
  - Se mais da metade das consultas falhar (YouTube recusando), o script sai com código 2, e o workflow comenta e deixa a issue aberta.
- **Testar a extensão contra uma lista local:** troque `AIB_SHARED_LIST_URL` numa cópia por um servidor local com `access-control-allow-origin: *`.

## Pendências

- Publicação na AMO (addons.mozilla.org) e `.xpi` na página Releases.
