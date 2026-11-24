# Bloqueador de Vídeos de IA para YouTube

Extensão para o **Firefox** que esconde do YouTube os vídeos gerados por inteligência artificial.

Ela funciona na página inicial, na busca, em Inscrições, nas recomendações ao lado do vídeo, nos Shorts e na própria página do vídeo.

## Por que confiar no bloqueio

A extensão **só bloqueia o que o próprio YouTube marca como IA**. Ela não tenta adivinhar pelo título, pela miniatura ou por palavras como "AI".

Quando um criador publica um vídeo feito ou alterado com IA, ele precisa declarar isso ao YouTube. O vídeo então ganha o selo **"Criado com IA"**, na seção *"Como este conteúdo foi criado"* da descrição. A extensão lê esse selo.

Na prática:

- Um vídeo que só **fala** sobre IA (notícia, tutorial, review) **não** é bloqueado, a menos que o criador o tenha marcado.
- Outros avisos da mesma seção, como **"Dublagem automática"**, são ignorados.
- Um vídeo de IA que o criador **não** declarou passa, porque o YouTube não o marca.

## O que acontece com um vídeo de IA

- **Nas listas de vídeos** (início, busca, recomendações): o vídeo some. Se preferir, ele pode aparecer desfocado, com um aviso que você clica para mostrar.
- **Ao abrir o vídeo ou Short**: aparece uma tela de bloqueio e o vídeo fica pausado. Você pode **voltar**, ir para o **início** ou **assistir mesmo assim**.

## Bloqueio de canais

Quando um canal publica **mais de 10 vídeos diferentes** com o selo "Criado com IA", ele entra sozinho na sua lista de canais bloqueados. A partir daí, todos os vídeos dele somem.

- O número 10 pode ser mudado no painel. O bloqueio automático também pode ser desligado.
- Só contam os vídeos que você viu no YouTube com a extensão ligada.
- Você também pode bloquear um canal na hora: abra um vídeo dele e clique em **"Bloquear o canal do vídeo aberto"**.

## Lista compartilhada da comunidade

Todos que usam a extensão podem ajudar a montar uma lista única de vídeos e canais de IA, guardada neste repositório na branch [`lista`](https://github.com/wisleyhq/youtube-ai-blocker/blob/lista/lists/ai-list.json), separada do código.

- **Receber:** a extensão baixa a lista do GitHub a cada 12 horas. Vídeos da lista são bloqueados na hora, e canais com mais de 10 vídeos nela são bloqueados para todos.
- **Contribuir:** na página de listas, aba **Compartilhar**, clique em **"Enviar para a lista compartilhada"**. Abre o GitHub com uma mensagem pronta, e você só confirma (é preciso ter uma conta no GitHub, gratuita).
- **Sem bagunça:** antes de entrar, um robô do GitHub confere **cada vídeo** direto no YouTube. Só entram os que têm o selo "Criado com IA". Ninguém consegue incluir um canal comum na lista.
- **Privacidade:** a contribuição é pública e fica no GitHub com o seu nome de usuário, junto com os IDs dos vídeos enviados. Envie só se estiver de acordo.
- Para não usar a lista, desligue **"Usar a lista compartilhada da comunidade"** no painel.

## Listas de vídeos e canais

No painel da extensão, clique em **"Ver vídeos e canais bloqueados"**. Abre uma página com três abas:

| Aba | O que mostra | O que dá para fazer |
|---|---|---|
| **Vídeos** | Os últimos 1000 vídeos bloqueados: título, canal, motivo e data | Buscar, abrir o vídeo, **liberar** o vídeo, limpar o histórico |
| **Canais** | Todos os canais com vídeos de IA, quantos vídeos com selo cada um tem e quantos faltam para o bloqueio | Bloquear agora, desbloquear, **sempre permitir** |
| **Vídeos liberados** | Os vídeos que você liberou | Desfazer a liberação |
| **Compartilhar** | O estado da lista compartilhada e quantos vídeos novos você encontrou | Enviar sua contribuição |

Um canal **"sempre permitido"** nunca é bloqueado, nem mesmo pelo selo.

## Instalar

### Para testar (some quando o Firefox fecha)

1. Baixe este repositório: botão verde **Code → Download ZIP**, e descompacte.
2. No Firefox, abra `about:debugging#/runtime/this-firefox`.
3. Clique em **"Carregar extensão temporária…"** e escolha o arquivo `manifest.json` da pasta.
4. Abra ou recarregue o YouTube.

### Para usar sempre

O Firefox comum só instala extensões assinadas pela Mozilla. A extensão ainda não está publicada na loja de complementos. O arquivo `.xpi` será disponibilizado na página [Releases](https://github.com/wisleyhq/youtube-ai-blocker/releases). Enquanto isso:

- **Firefox Developer Edition ou Nightly**: em `about:config`, mude `xpinstall.signatures.required` para `false`. Depois instale o arquivo `.xpi`.
- **Assinatura própria, de graça**: crie uma conta em <https://addons.mozilla.org/developers/> e envie o `.xpi` como **"Por conta própria"**. Em poucos minutos você baixa o arquivo assinado e instala arrastando para o Firefox.

## Configurações

Clique no ícone da extensão:

- **Liga/desliga** geral.
- **Ocultar** ou **desfocar** os vídeos detectados.
- **Conferir o selo nas miniaturas**: verifica cada vídeo das listas. Se desligado, só a página do vídeo aberto é verificada.
- **Bloquear canais automaticamente** e a partir de quantos vídeos de IA.
- **Tela de bloqueio** ao abrir um vídeo de IA.
- **Lista compartilhada** da comunidade: ligar ou desligar.
- Listas de **canais bloqueados** e **canais sempre permitidos**.

## Privacidade

- A extensão só se comunica com o **próprio YouTube**, para ler o selo de cada vídeo, e com o **GitHub**, para baixar a lista compartilhada. Esse download não envia nenhum dado seu.
- Nada é enviado sem você clicar em **Enviar** e confirmar no GitHub.
- Não há conta, servidor, rastreamento nem anúncios.
- Configurações, listas e histórico ficam guardados só no seu Firefox.

## Perguntas frequentes

**Um vídeo de IA não foi bloqueado. Por quê?**
Provavelmente o criador não declarou o vídeo como IA, então o YouTube não mostra o selo. A extensão só bloqueia vídeos com o selo, para não esconder nada por engano. Se o canal te incomoda, bloqueie o canal pelo painel.

**Um vídeo foi bloqueado, mas eu quero assistir.**
Na tela de bloqueio, clique em **"Assistir mesmo assim"**. Para liberar de vez, use **"Liberar"** na lista de vídeos.

**Por que o YouTube ficou um pouco mais lento?**
Com "Conferir o selo nas miniaturas" ligado, a extensão consulta o YouTube uma vez por vídeo, no máximo 2 de cada vez. O resultado fica guardado. Se quiser, desligue essa opção.

## Problemas e sugestões

Abra uma [issue](https://github.com/wisleyhq/youtube-ai-blocker/issues) contando o que aconteceu. Se for o caso, informe o link do vídeo.

Os resultados dos testes estão em [TESTES.md](TESTES.md).
