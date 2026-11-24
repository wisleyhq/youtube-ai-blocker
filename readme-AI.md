# Notas para assistentes de IA (Claude, ChatGPT etc.)

Contexto técnico para quem for alterar este código. O [README.md](README.md) é para os usuários. Não coloque nele notas de implementação.

## Regras do projeto

- **Só o selo oficial bloqueia vídeos.** O dono do projeto decidiu (versão 1.2.0) eliminar falsos positivos. Bloqueio por palavra-chave, título ou "modo rigoroso" foi removido de propósito. Não reintroduza sem pedido explícito.
- O canal só é bloqueado automaticamente com **mais de `autoBlockThreshold` (padrão 10)** vídeos **diferentes** com o selo. A comparação é `>` e não `>=`.
- Interface, comentários, mensagens de commit e documentação em **português do Brasil**.
- Sem dependências, sem build e sem servidor próprio. A única rede usada é o próprio YouTube.
- Nada de `innerHTML` com dados do YouTube: monte o DOM com `createElement` e `textContent`. O `web-ext lint` acusa e a AMO rejeita.
- Antes de commitar, rode `web-ext lint`. A meta é 0 erros e 0 avisos.

## Arquivos

| Arquivo | Papel |
|---|---|
| `manifest.json` | MV3, Firefox 142+, permissão `storage` e hosts `*.youtube.com`. ID gecko `bloqueador-ia-youtube@wisley.local` |
| `src/defaults.js` | `AIB_DEFAULTS` (configurações), `AIB_HISTORY_MAX`, `AIB_LABEL_HELP_IDS`, `AIB_LABEL_PHRASES`. Compartilhado entre o content script e as páginas |
| `src/content.js` | Toda a detecção e o bloqueio (IIFE única) |
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
5. Cartões bloqueados pela lista de canais também consultam o selo. Isso completa o canal no histórico (os Shorts na busca não têm link do canal no DOM) e conta os vídeos de IA.

## Armazenamento (`browser.storage.local`)

| Chave | Formato |
|---|---|
| configurações | as chaves de `AIB_DEFAULTS` |
| `blockedChannels` / `allowedChannels` | `string[]` com `@handle` ou nome exibido. Comparação via `norm()` (trim, minúsculas, espaços únicos) |
| `allowedVideos` | `string[]` de IDs. `allowedVideoInfo`: `{id: {title, channel, shorts}}`, só para exibir |
| `blockedVideos` | `{id: {title, channel, handle, reason, shorts, first, last}}`. Limitado a `AIB_HISTORY_MAX` pelo `last` |
| `aiChannels` | `{chave: {handle, name, videos: [ids com selo]}}`. Chave = handle normalizado (ou nome). `findChannelKey` junta o mesmo canal visto por nome ou por handle |
| `labelCache` | `{id: 0|1}` |
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

## Pendências e ideias discutidas

- **Lista compartilhada entre usuários** (ainda não feita). Proposta:
  - um arquivo `lists/channels.json` no GitHub, baixado periodicamente pela extensão (somente leitura, via `raw.githubusercontent.com`);
  - contribuições por issue ou PR;
  - uma GitHub Action que reconsulta o selo de cada vídeo antes de aceitar, já que o selo é verificável por qualquer um.
  - Gravar direto no GitHub a partir da extensão exigiria um token embutido, o que é inseguro. Não faça isso.
- Publicação na AMO (addons.mozilla.org) e `.xpi` na página Releases.
