# Testes de identificação (23/11/2026)

O `content.js` foi injetado em páginas reais do YouTube (navegador Chromium, com
uma simulação da API `browser.storage`) para medir a detecção.

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

## Limitações

- Testado no Chromium com API simulada; no Firefox a consulta usa
  `content.fetch` (mesma origem da página). Vale conferir no Firefox real.
- Vídeos de IA sem rótulo, sem palavra-chave e de canal desconhecido passam.
- O modo rigoroso bloqueia também vídeos que só falam sobre IA (notícias,
  tutoriais). Desative no painel ou use "Canais sempre permitidos".
