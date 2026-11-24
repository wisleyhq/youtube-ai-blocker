# Testes de identificação (23/11/2026)

As seções 1 a 5 testaram as versões 1.0.0 e 1.1.0, que também bloqueavam por
palavras-chave e "modo rigoroso". A partir da versão 1.2.0 (seção 6) a extensão
só bloqueia pelo selo oficial "Criado com IA" do YouTube.

Nas seções 1 a 4, o `content.js` foi injetado em páginas reais do YouTube
(navegador Chromium, com uma simulação da API `browser.storage`).

## 1. Busca "#aivideo" (só palavras-chave, versão 1.0.0)

- 57 cartões de vídeo, 36 marcados (63%).
- Os não marcados usavam termos fora da lista: "vídeos de IA" (plural), "Sora 2",
  "Seedance", "#aishorts", "#aicats" e "AI" solto no título ("AI fruit videos",
  "Adorable AI Vegetable Baby").
- Correção: lista de palavras-chave ampliada e criado o **modo rigoroso**
  ("AI", "Ai" ou "IA" como palavra solta, diferenciando maiúsculas).

## 2. Rótulo oficial do YouTube

- O texto do rótulo mudou: agora é **"Como este conteúdo foi criado: Os sons ou
  recursos visuais foram alterados ou totalmente gerados por IA"**, com o selo
  **"Criado com IA"**. A versão 1.0.0 procurava "Conteúdo alterado ou sintético"
  e **não teria detectado nada**.
- Sinal independente de idioma: o link "Saiba mais" do rótulo de IA aponta para
  o artigo de ajuda `support.google.com/youtube/answer/15447836`. A mesma seção
  também é usada para "Dublagem automática" (artigo 15569972), que **não** deve
  bloquear.
- O rótulo só aparece dentro do vídeo. Para as miniaturas, a extensão consulta
  `youtubei/v1/next` (API interna do YouTube) por vídeo, com cache e no máximo 2
  consultas simultâneas.

Verificação do rótulo (7 de 7 corretos):

| Vídeo | Esperado | Resultado |
|---|---|---|
| upsQiTCQVrw (bolo de cenoura, declarado como IA) | IA | OK |
| CRKKvnc4nxQ (bolo de cenoura, declarado como IA) | IA | OK |
| lO8p9z0CvzU (geradores de vídeo por IA) | IA | OK |
| KoOY36Glshc (Short "AI fruit videos") | IA | OK |
| dx05ivXQ4Ko (tutorial sem rótulo) | não IA | OK |
| TNM8moLggbI (só dublagem automática) | não IA | OK |
| dQw4w9WgXcQ (clipe musical) | não IA | OK |

## 3. Página do vídeo com rótulo (palavras-chave desligadas)

- Tela de bloqueio exibida com o motivo "rótulo oficial do YouTube: criado com IA".
- Vídeo pausado; canal adicionado automaticamente à lista de bloqueio.
- "Assistir mesmo assim" remove a tela e o vídeo volta a tocar.
- Barra lateral: 9 de 20 recomendações identificadas só pelo rótulo.

## 4. Busca comum "receita bolo de cenoura" (tudo ligado)

- 76 cartões, 3 marcados:
  - 2 vídeos de bolo que o próprio criador declarou como gerados por IA (acerto).
  - 1 anúncio de "Assistente de IA" (modo rigoroso).
- Nenhum vídeo comum de receita foi bloqueado.

## 5. Firefox real (Firefox 160, versão 1.1.0)

A extensão foi carregada como complemento temporário num Firefox 160 de
verdade (automatizado com Puppeteer via WebDriver BiDi, perfil limpo).

- **Rótulo oficial** (palavras-chave e modo rigoroso desligados): os mesmos
  7 vídeos da seção 2 deram 7 de 7 corretos. Nos 4 vídeos de IA a tela de
  bloqueio apareceu e o vídeo ficou pausado.
- **Miniaturas**: a barra lateral foi marcada só pelo rótulo (7 de 20 e 2 de
  20 em dois vídeos sem rótulo), o que confirma que a consulta via
  `content.fetch` funciona no Firefox.
- **"Assistir mesmo assim"**: remove a tela e o vídeo volta a tocar.
- **Busca "#aivideo"** (configuração padrão): 99 de 107 cartões marcados.
  Inclui tutoriais sobre ferramentas de IA (efeito esperado do modo rigoroso).
- **Busca "receita bolo de cenoura"** (configuração padrão): 2 de 64
  marcados, ambos vídeos de bolo declarados como IA. Nenhuma receita comum
  bloqueada.
- **`web-ext lint`** (validador da Mozilla): 0 erros, 0 avisos.
- O painel (popup) não pôde ser testado de forma automática: o Firefox não
  deixa a automação abrir páginas `moz-extension://`. Conferir à mão.

## 6. Versão 1.2.0: só o selo oficial (Firefox 160, 23/11/2026)

Palavras-chave e modo rigoroso foram removidos. Testes no Firefox real, como na seção 5.

- **Páginas de vídeo:** os mesmos 7 vídeos da seção 2 deram 7 de 7 corretos.
  "Assistir mesmo assim" continua funcionando.
- **Busca "#aivideo":** 30 de 59 cartões marcados, todos com o selo
  declarado pelo criador. Na 1.1.0 eram 99 de 107, a maioria só pelo título.
- **Busca "receita bolo de cenoura":** 2 de 64, os dois com o selo.
- **Histórico de vídeos:** 23 de 23 registros com título e canal, inclusive
  Shorts da busca, cujo canal não aparece na página. O canal vem da consulta ao YouTube.
- **Contagem por canal:** com o limite reduzido para 1 numa cópia de teste,
  foram bloqueados exatamente os 3 canais com 2 vídeos com selo. Nenhum canal
  com 1 vídeo foi bloqueado. Com o padrão (10), o canal precisa de 11 vídeos.
- **Vídeo liberado:** um vídeo com selo, colocado em "Vídeos liberados", não
  mostrou a tela de bloqueio.
- **Página "Vídeos e canais bloqueados":** testada com dados simulados
  (o Firefox não deixa a automação abrir páginas `moz-extension://`). Liberar
  vídeo, bloquear, desbloquear e permitir canal funcionaram, sem rolagem
  lateral em tela de celular.
- **`web-ext lint`:** 0 erros, 0 avisos.

## 7. Versão 1.3.0: lista compartilhada (Firefox 160, 24/11/2026)

- **Robô (`scripts/verify-list.mjs`), rodado no computador com os 7 vídeos de
  referência mais 1 ID inválido:** 4 com selo adicionados, 3 sem selo
  ignorados, 1 não conferido. Um texto malicioso dentro do bloco `aib-ids`
  foi ignorado: só IDs válidos são lidos.
- **Download da lista** (servidor local no lugar do GitHub): baixada pelo
  script de fundo. Entradas inválidas foram descartadas.
- **Vídeo da lista:** um vídeo sem selo, colocado na lista de teste, foi
  bloqueado. Isso prova que a lista é usada sem consultar o YouTube.
- **Canal com 11 vídeos na lista:** na página de Shorts do canal, 50 de 50
  bloqueados. O canal vem da consulta, porque não aparece na página.
- **Lista inexistente no GitHub** (antes do primeiro envio): a extensão
  continua funcionando normalmente. Vídeos de referência: 7 de 7.
- **Aba Compartilhar** (dados simulados): envia só vídeos que não estão na
  lista e ainda não foram enviados. O link abre a issue com título `[lista]` e
  o bloco `aib-ids` correto.
- **`web-ext lint`:** 0 erros, 0 avisos.
- **Robô no GitHub de verdade** ([issue #1](https://github.com/wisleyhq/youtube-ai-blocker/issues/1)):
  o teste levou 1 vídeo com selo (`MaWQPAvLPXo`) e 1 sem selo (`dx05ivXQ4Ko`).
  O robô adicionou só o primeiro, fez o commit na lista, respondeu e fechou a
  issue. A extensão real baixou a lista do GitHub.
- **Repositório público:** a lista e as contribuições só funcionam com o
  repositório público. No privado, o endereço da lista dá "não encontrado".

## Limitações

- Vídeos de IA que o criador não declarou não têm selo e passam (exceto se o
  canal estiver bloqueado).
- A contagem de vídeos por canal só inclui vídeos vistos com a extensão
  ligada. A lista compartilhada depende de contribuições.
