# Bloqueador de Vídeos de IA para YouTube (Firefox)

Extensão que oculta ou desfoca vídeos gerados por IA no YouTube: página inicial, busca, inscrições, recomendações laterais, Shorts e a própria página do vídeo.

## Como detecta

1. **Rótulo oficial do YouTube** — quando o criador declara que o vídeo foi "alterado ou totalmente gerado por IA", o YouTube mostra o selo **"Criado com IA"** na seção "Como este conteúdo foi criado". A extensão:
   - lê esse rótulo na página do vídeo/Short e mostra a tela de bloqueio;
   - consulta o rótulo também para as miniaturas dos feeds (API interna do YouTube, 1 consulta por vídeo, com cache);
   - (opcional) adiciona o canal à lista de bloqueio, para os próximos vídeos dele sumirem direto.
   - Rótulos que não são de IA na mesma seção, como "Dublagem automática", são ignorados.
2. **Palavras-chave** no título/metadados (ex.: "gerado por IA", "#aiart", "Sora 2", "Veo 3", "Midjourney"). Editáveis no painel.
   - Siglas curtas em maiúsculas (ex.: `IA`, `AI`) diferenciam maiúsculas, para não bloquear "eu ia ao mercado".
   - **Modo rigoroso** (ligado por padrão): bloqueia títulos com "AI", "Ai" ou "IA" soltos. Pega bem mais vídeos de IA, mas também vídeos que só falam sobre IA.
3. **Lista de canais bloqueados** — `@handle` ou nome do canal. O botão "Bloquear o canal do vídeo aberto" adiciona o canal da aba atual.
4. **Canais sempre permitidos** — nunca são bloqueados (para evitar falsos positivos).

Resultados dos testes em páginas reais: veja [TESTES.md](TESTES.md).

## Instalar para testar (temporário)

1. Abra `about:debugging#/runtime/this-firefox`
2. Clique em **Carregar extensão temporária…**
3. Selecione o arquivo `manifest.json` da pasta (ou o `.xpi`)
4. Abra o YouTube e recarregue a página

A extensão temporária some quando o Firefox fecha.

## Instalar de forma permanente

O Firefox normal só instala extensões assinadas pela Mozilla:

- **Assinatura gratuita (recomendado)** — crie uma conta em https://addons.mozilla.org/developers/, envie o `.xpi` como **"Por conta própria" (unlisted)**. A assinatura sai em minutos e você baixa o `.xpi` assinado para instalar arrastando no Firefox.
- **Firefox Developer Edition / Nightly** — em `about:config`, defina `xpinstall.signatures.required` como `false` e instale o `.xpi` direto.

## Estrutura

```
manifest.json         Manifest V3 (Firefox 142+)
src/defaults.js       Configuração padrão e textos do rótulo oficial
src/content.js        Detecção e bloqueio nas páginas do YouTube
src/content.css       Estilos de ocultar/desfocar e tela de bloqueio
popup/                Painel de configurações
icons/icon.svg        Ícone
```

Configurações, listas e cache ficam em `storage.local`. A única comunicação externa é com o próprio YouTube, para ler o rótulo dos vídeos.
