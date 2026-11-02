# Gravar a chamada atual

## O Discord tem?

**Não tem gravação de chamada embutida.** O caminho usual é um bot (o Craig,
que grava cada pessoa numa trilha separada) ou programa externo como OBS e
Audacity [terceiros: [JotMe](https://www.jotme.io/blog/how-to-record-discord-call),
[Zapier](https://zapier.com/blog/how-to-record-discord-calls/)]. O que existe é
o **Clips**: quem está **transmitindo** salva os últimos segundos da
transmissão, e cada pessoa pode excluir a própria voz dos clips
[terceiros: [PC Gamer](https://www.pcgamer.com/discord-clips-feature-privacy/)].

Vale desconfiar de páginas que falam numa pasta "Native Recordings" do Discord:
são repetitivas e não batem com nenhuma fonte confiável.

**Para o Aether, isto é diferencial:** gravar a call com um clique, salvando
direto numa pasta do computador escolhida nas configurações.

## Desenho proposto [proposta]

### Onde roda

**Só no app desktop**, porque o navegador não escreve em pasta escolhida. A
gravação é **local**: o arquivo vai direto para o disco de quem grava e não
passa por servidor nenhum (sem custo de armazenamento, sem o Aether guardar a
conversa de ninguém).

### Como captura [código: `apps/web/src/lib/voice/room.ts`]

O áudio de quem fala já passa por um `AudioContext` (é ele que amplifica
volume acima de 100%). A gravação liga um ponto de saída a mais nesse grafo:

1. cada trilha de áudio remota que entra na sala, mais o seu microfone, é
   ligada a um `MediaStreamAudioDestinationNode`;
2. um `MediaRecorder` grava esse ponto em Opus (`audio/webm`), em pedaços de
   alguns segundos;
3. cada pedaço vai pelo IPC para o processo principal do desktop, que anexa
   ao arquivo na pasta escolhida. Se o app fechar, o que já foi gravado está
   salvo.

Quem entra no meio da call passa a ser gravado a partir da entrada; quem sai
deixa de ser.

### Configuração

- **Aba "Este computador"** ganha "Pasta das gravações". O padrão é
  `Documentos/Aether/Gravações`, e há um botão para escolher outra pasta
  (diálogo nativo do sistema).
- Nome do arquivo: `AAAA-MM-DD HHhMM — <servidor ou DM> — <canal>.webm`.
- Opções da primeira versão: só áudio; mixado num arquivo só.

### Consentimento: obrigatório, e visível

Gravar a voz de outras pessoas tem implicação legal (LGPD) e de confiança.
Regras mínimas:

- **Todo mundo na call vê que está sendo gravado**, com um indicador vermelho
  ao lado de quem grava e um som curto ao começar e ao parar. O gateway
  anuncia o estado de gravação para a sala, como já faz com câmera e tela.
- **O servidor pode proibir:** uma permissão nova, "Gravar chamada", por
  canal, como `CAMERA` e `SCREEN_SHARE`. Em DM, as duas pessoas sempre veem o
  indicador.
- O aviso é o que torna a gravação justa; sem ele, o recurso vira ferramenta
  de gravação escondida.

### O que fica para depois

- Uma trilha por pessoa (como o Craig), útil para edição.
- Gravar junto a tela compartilhada (vídeo).
- Gravação pela nuvem (LiveKit Egress): grava no servidor, mas custa e não
  salva no computador, que é o que foi pedido.

## Decisões pendentes

1. **Consentimento:** basta o aviso visível para todos (recomendado, é o
   padrão de apps de reunião), ou cada pessoa precisa aceitar antes?
2. **Permissão por canal:** ela já nasce **liberada** para todos, ou só para
   cargos marcados?
3. **Formato:** `.webm` (Opus, pequeno, nativo do navegador) ou converter para
   `.mp3`/`.m4a` depois de gravar (mais compatível, precisa de um conversor no
   desktop)?
