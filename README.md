# AETHER (nome provisorio)

Plataforma de comunicacao em tempo real: canais persistentes no estilo TeamSpeak
com a usabilidade do Discord — voz, compartilhamento de tela e chat.

> O nome definitivo ainda nao foi decidido. Toda a interface le o nome de
> `packages/shared/src/brand.ts`; trocar o produto de nome e alterar uma linha.

---

## Estado atual: FASES 1-6 concluidas

| Fase | Escopo | Status |
| --- | --- | --- |
| 1 | Estrutura, autenticacao, usuarios, servidores, interface base | ✅ pronto |
| 2 | Canais, categorias, cargos, permissoes (CRUD + canais privados) | ✅ pronto |
| 3 | Gateway WebSocket, presenca, entrada/saida de canal, chat | ✅ pronto |
| 4 | WebRTC: microfone, audio, canais de voz (SFU) | ✅ pronto |
| 5 | Compartilhamento de tela (getDisplayMedia + distribuicao) | ✅ pronto |
| 6 | Administracao, moderacao, logs | ✅ pronto |
| 7 | Performance, reconexao, seguranca, testes, deploy | em andamento (7a, 7b, 7c-1 prontos) |

---

## Processo por fase

Regras de trabalho, validas para toda fase daqui em diante. **Antes** de
implementar:

1. **Analisar a arquitetura existente** — ler o que ja existe antes de escrever.
2. **Dizer quais arquivos serao criados e modificados**, antes de mexer.
3. **Explicar as decisoes tecnicas** e o porque de cada uma.

Durante e depois:

4. **Implementar apenas a fase pedida** — nada de adiantar a proxima.
5. **Nao quebrar o que ja funciona** — rodar os `scripts/verify-phase*.mjs` das
   fases anteriores como teste de regressao.
6. **Explicar como testar** ao terminar.
7. **Listar problemas e limitacoes conhecidos** — cada fase deste README tem a
   sua secao de limitacoes, e ela e escrita com honestidade.

Duas regras que valem sempre: **nenhuma alteracao grande sem explicar antes**, e
o alvo e **codigo de producao, nao demonstracao visual** — se algo e simulado ou
provisorio, isso vai escrito na secao de limitacoes.

---

## Roteiro das fases 4 a 7

### FASE 4 — voz
- WebRTC
- microfone
- audio
- canais de voz

Ja preparado: `Permissions-Policy` no `next.config.ts` libera `microphone=(self)`,
o tipo `VoiceState` existe em `packages/shared`, e o gateway da fase 3 e a fonte
de verdade de quem esta em qual canal. A midia em si vai por um SFU (LiveKit) —
malha P2P nao aguenta canal com muita gente.

### FASE 5 — tela
- compartilhamento de tela
- `getDisplayMedia`
- distribuicao do stream
- interface de screen sharing

Ja preparado: `display-capture=(self)` liberado no `next.config.ts` e a flag
`streaming` em `VoiceState`. O botao existe na UI desde a fase 1, desabilitado.

### FASE 6 — administracao
- administracao
- moderacao
- logs

Ja preparado: modelos `Ban`, `Invite` e `AuditLog` no schema, `audit.ts` no app
web, e as permissoes `KICK_MEMBERS`, `BAN_MEMBERS`, `MUTE_MEMBERS`,
`DEAFEN_MEMBERS`, `MOVE_MEMBERS` e `VIEW_AUDIT_LOG` ja definidas no bitfield.

### FASE 7 — endurecimento
- performance
- reconexao
- seguranca
- testes
- deploy

Aqui entram as dividas registradas nas limitacoes das fases anteriores: rate
limit em memoria virando Redis, adapter de Redis para o gateway escalar
horizontalmente, revalidacao de sessao em conexao ja aberta, e a primeira
suite de testes automatizados de verdade.

---

## Stack

- **Next.js 15** (App Router, Server Actions) + **React 19** + **TypeScript** estrito
- **Tailwind CSS 4** com design tokens proprios
- **PostgreSQL** (Supabase) + **Prisma 6**
- **Sessao propria**: JWT HS256 (`jose`) em cookie httpOnly + linha `Session` no
  banco para permitir revogacao
- **scrypt** nativo do Node para hash de senha (sem modulo nativo para compilar)

Fases seguintes: Socket.IO (fase 3) e LiveKit como SFU (fases 4 e 5).

---

## Estrutura

```
aether/
├── apps/
│   ├── web/                    Next.js — interface + server actions
│   │   └── src/
│   │       ├── app/            rotas (App Router)
│   │       ├── components/     UI (layout, auth, servers, ui)
│   │       ├── lib/            utilitarios de cliente
│   │       └── server/         TUDO que so roda no servidor
│   │           ├── actions/    server actions (entrada validada)
│   │           ├── auth/       senha, cookie de sessao, rate limit
│   │           ├── services/   camada de dados reaproveitavel
│   │           ├── guards.ts   autenticacao + autorizacao
│   │           └── audit.ts    log de auditoria
│   └── realtime/               gateway WebSocket (FASE 3)
│       └── src/
│           ├── env.ts          configuracao validada no boot
│           ├── auth.ts         handshake autenticado pelo cookie de sessao
│           └── index.ts        servidor Socket.IO
└── packages/
    ├── db/                     schema Prisma + cliente singleton
    ├── shared/                 tipos, permissoes, validacao Zod, marca
    └── access/                 sessao + permissao efetiva (web E gateway)
```

Regra de ouro da arquitetura: **nada de logica de negocio em componente**.
Componente chama action, action chama guard e service, service fala com o banco.

Segunda regra, que nasceu na fase 3: **regra de autorizacao mora em um lugar so**.
`apps/web` e `apps/realtime` sao apps irmaos e nenhum importa do outro; o que
os dois precisam saber sobre sessao e permissao vive em `@aether/access`. Duas
copias da regra de permissao divergem, e permissao divergente nao e bug de tela,
e falha de autorizacao.

---

## Como rodar

Pre-requisitos: Node 20.11+ e npm.

```bash
# 1. dependencias  (ja instaladas nesta maquina)
npm install
#    npm 12+ bloqueia install scripts: se aparecer o aviso "allow-scripts",
#    rode  npm approve-scripts @prisma/client @prisma/engines prisma esbuild sharp
#    (o package.json ja tem esses aprovados)

# 2. variaveis de ambiente
#    O arquivo e .env NA RAIZ do monorepo (nao .env.local, e nao dentro de apps/web):
#    todos os comandos injetam esse arquivo via dotenv-cli, entao Prisma e Next
#    leem exatamente as mesmas variaveis.
#    Ja existe nesta maquina com o AUTH_SECRET gerado.
#
#    Senha do Postgres — NAO edite a URL na mao (senhas do Supabase costumam ter
#    @ / ? & que quebram a URL). Use:
npm run db:password -- "senha-crua-do-dashboard"
npm run db:diagnose         # confere usuario/host/encoding sem imprimir a senha

# 3. cliente Prisma + tabelas
npm run db:generate
npm run db:deploy           # aplica a migration inicial (cria as 13 tabelas)

# 4. (opcional) dados de teste: usuarios ryan/joao, senha senha123
npm run db:seed

# 5. subir
npm run dev                 # http://localhost:3000
```

---

## App desktop (Windows)

```bash
npm run dev:desktop      # abre a janela apontando para a producao
npm run build:desktop    # gera apps/desktop/dist/Aether Setup X.Y.Z.exe
```

**A casca NAO empacota o site.** O Next roda no servidor (Server Actions,
SSR), entao nao existe versao estatica para embutir — e mesmo que existisse,
embutir significaria reinstalar a cada correcao. O app carrega
`https://aether-mocha-phi.vercel.app`, entao um deploy chega sem ninguem baixar
nada. E o mesmo desenho que Discord e Slack usam.

**Electron, e nao Tauri.** O Tauri geraria um instalador de ~5MB em vez de
78MB, mas exige Rust e MSVC Build Tools (varios GB de ferramenta) e usa o
WebView2 do SISTEMA — o mesmo motor cujo `getDisplayMedia` falha ao capturar
audio em algumas maquinas Windows. O Electron traz o Chromium proprio e tem
uma API de captura loopback especifica, que e um caminho de codigo diferente.

**Instalador, e nao portable**, por tres motivos concretos: o app e publicado
varias vezes por semana (portable exigiria reenviar o .exe a cada correcao),
atalho e icone aparecem sozinhos, e instalado ha caminho para auto-update
depois.

### Seletor de tela proprio

Uma janela nossa, com miniaturas de cada tela e janela, abas separando as duas
e uma chave para levar o som. E o mesmo caminho que o Discord usa:
`desktopCapturer.getSources()` devolve as fontes com miniatura, a interface
desenha, e a captura so comeca depois da escolha.

Nasceu de um bug: a primeira versao passava `sources[0]` direto para o
callback, apostando que `useSystemPicker: true` faria o Windows abrir o
seletor nativo antes. Nesta combinacao de Electron e Windows isso nao
acontece, e o "plano B" virou o comportamento de sempre — clicar em
compartilhar ia direto para a tela inteira, sem perguntar nada.

Detalhes que valem saber:

- **As miniaturas viram data URL no processo PRINCIPAL.** O renderer do
  seletor nao recebe `desktopCapturer` — se recebesse, aquela janela poderia
  enumerar telas por conta propria, e ela so precisa desenhar o que mandaram.
- **O nome da fonte entra por `textContent`, nunca `innerHTML`.** Titulo de
  janela e texto escolhido por OUTRO programa da maquina.
- **CSP restritiva no HTML** (`default-src 'none'`): a janela nao carrega nada
  da rede, e a regra existe para continuar assim quando alguem mexer nela.
- **Os handlers de IPC sao registrados ANTES do `loadFile`.** O renderer pede
  as fontes assim que carrega; com o registro depois, o pedido chegava antes
  do handler existir e a grade ficava vazia. Aconteceu.
- **A chave de som fica AQUI, e nao herda a do app web.** No navegador aquela
  preferencia se auto-desliga quando a captura de som falha; herdar isso no
  desktop faria o loopback do Electron — o motivo de existir esta versao —
  nunca ser exercitado.

### Limitacoes conhecidas

- **O executavel NAO e assinado.** Na primeira execucao o Windows mostra
  "editor desconhecido" e pede confirmacao. Assinar exige um certificado pago.
- **Buildar exige o Modo de Desenvolvedor do Windows LIGADO.** O
  electron-builder baixa um pacote de ferramentas que contem symlinks do
  macOS, e criar symlink no Windows exige privilegio. Ironicamente os dois
  arquivos que falham (`libcrypto.dylib`, `libssl.dylib`) sao inuteis num
  build para Windows, mas o extrator aborta assim mesmo.
  Ligar em: `ms-settings:developers`.
- **`npmRebuild: false` no electron-builder.yml nao e otimizacao, e
  necessidade.** Sem isso ele roda "install production dependencies" no
  diretorio do app, e num monorepo com workspaces isso PODA o node_modules da
  raiz — levando Next, Vitest e Prisma junto. Aconteceu uma vez durante a
  implementacao.
- **A versao do Electron esta FIXA** (`33.4.11`, sem `^`) em
  `apps/desktop/package.json`. Com workspaces o binario fica na raiz, e o
  electron-builder so descobre a versao se ela estiver fixa ali.
- **A casca se atualiza sozinha a partir da 0.1.3** (`electron-updater`). Quem
  estiver em versao anterior precisa instalar a 0.1.3 na mao UMA vez — nao da
  para atualizar quem nao tem o atualizador.

  Publicar versao nova:

  ```bash
  # 1. sobe a versao em apps/desktop/package.json
  # 2. GH_TOKEN="$(gh auth token)" npm run release --workspace=@aether/desktop
  # 3. o electron-builder cria a release como RASCUNHO; tirar do rascunho:
  #    gh release edit v0.1.X --repo ryanrn/aether-releases --draft=false
  ```

  O passo 3 e facil de esquecer e falha em silencio: rascunho e invisivel para
  o atualizador, e o app simplesmente nunca acha a versao nova.

  **Link de download permanente**, para o site nao precisar ser editado a cada
  release:

  ```
  https://github.com/ryanrn/aether-releases/releases/latest/download/Aether-Setup.exe
  ```

  Ele so funciona porque o `artifactName` no `electron-builder.yml` NAO inclui a
  versao. Com o nome padrao (`Aether-Setup-0.1.3.exe`) o endereco mudaria a cada
  versao, e o botao do site apontaria para o nada assim que alguem esquecesse
  de atualizar.

  **As versoes vao para um repositorio PUBLICO separado** (`aether-releases`),
  enquanto o codigo fica privado. Release de repo privado exige token para
  baixar, e token embutido num programa distribuido e token publicado.

  O download e automatico; a INSTALACAO nao. Reiniciar o app no meio de uma
  call para aplicar update seria pior que o problema resolvido — entao ele
  pergunta, e quem nao quiser agora recebe no proximo fechamento.
- **So Windows x64.** macOS e Linux exigem buildar em cada sistema, ou CI.
- **O loopback de audio do Electron FUNCIONA** na maquina onde o navegador
  falhava. Verificado em 22/08/2026 pelo caminho real (seletor incluso):
  `{ ok: true, video: 1, audio: 1 }`, e 4 de 4 repeticoes com som.

  Duas conclusoes erradas foram registradas antes desta, e ambas vinham de
  falhas TRANSITORIAS (`NotReadableError / Could not start audio source`)
  quando algo segurava o dispositivo de audio no momento do teste. Repetir e
  o que separou "esta maquina nao suporta" de "naquele instante nao deu".

  Dois erros de API no caminho, que valem como aviso:
  `loopbackWithSilence` NAO existe (validos: `loopback` e `loopbackWithMute`),
  e passar `audio: undefined` tambem e recusado — a chave precisa ser OMITIDA
  quando nao ha som.

- **O renderer TAMBEM precisa pedir audio, nao basta o handler devolver.**
  Verificado com um teste de tres casos: com o renderer mandando
  `audio: false` e o handler devolvendo `loopback`, chegam ZERO faixas de som.
  So funciona quando os dois pedem.

  Por isso `isDesktopApp()` existe: no desktop o app web pede audio SEMPRE, e
  quem decide e a chave do seletor. Sem isso, a chave do seletor seria enfeite
  para quem tivesse a preferencia do app desligada — que e exatamente o estado
  de quem ja apanhou do navegador, porque ela se auto-desliga na falha.

- **O loopback falha de verdade — e de forma permanente — quando a saida de
  audio PADRAO do Windows e um dongle sem fio.** Reportado em 22/08/2026:
  compartilhar com um fone Logitech PRO X2 ligado por cabo P2 funcionava; o
  MESMO fone no receptor USB 2,4GHz sem fio dava `Could not start audio
  source` sempre. Um segundo teste, trocando a saida padrao do Windows EM
  TEMPO REAL durante uma transmissao ja no ar, confirmou: com "High
  Definition Audio Device" (onboard) o outro lado ouvia o som; com o PRO X2
  sem fio como padrao, nao ouvia. E limitacao do driver do dongle em abrir
  captura WASAPI em modo loopback, nao um bug de logica — a mesma falha
  acontece via `getDisplayMedia` do navegador.

  **Isso NAO se resolve com um seletor de saida de audio dentro do app.** O
  loopback do Chromium (e o do Electron, que usa o mesmo mecanismo) sempre
  captura da saida que o WINDOWS considera padrao no momento — nenhuma API
  exposta pelo `setDisplayMediaRequestHandler` deixa escolher um dispositivo
  especifico e diferente do padrao. Resolver isso de verdade exigiria um
  modulo nativo falando WASAPI diretamente (contornando a abstracao do
  Chromium), o que e obra muito maior que uma tela de configuracao. O
  contorno real, hoje, e trocar a saida padrao do Windows para o dispositivo
  com fio/onboard antes de compartilhar com som.

  O que ERA um bug de verdade, e foi corrigido: no desktop pedimos audio
  SEMPRE (ver acima), entao cada nova tentativa de compartilhar caia no
  MESMO erro de novo, para sempre — nao havia como a tela nem sair sem som.
  A causa: a preferencia que se autodesliga na falha
  (`saveShareAudioPreference`) e do NAVEGADOR (localStorage) e nunca chega a
  valer no desktop, porque la a chave que importa e a do seletor proprio
  (`picker-prefs.json`, no processo principal). Agora
  `apps/web/src/lib/voice/room.ts` avisa o Electron pela ponte
  `window.aetherDesktop.reportAudioCaptureFailed()`
  (`apps/desktop/src/preload.js` → `desktop:audio-capture-failed` →
  `disableAudioPreference()` em `apps/desktop/src/picker.js`) quando a
  captura falha por causa do som. Na proxima vez o seletor ja abre com "levar
  som" desmarcado e a tela funciona de primeira.

## Configuracoes do app (diferente das do servidor)

Havia DUAS engrenagens fazendo a mesma coisa — as duas abriam as
configuracoes do servidor — e nenhuma para o proprio usuario. Agora:

| onde | o que abre |
| --- | --- |
| barra de cima, ao lado de "Convidar" | configuracoes do SERVIDOR |
| barra de baixo, ao lado do seu nome | suas configuracoes (e o avatar tambem) |

O modal tem menu lateral, e nao abas no topo: a lista deve crescer (aparencia,
atalhos, notificacoes) sem virar uma fileira apertada.

- **Minha conta** — foto, nome de exibicao e o apelido no servidor atual. Era
  um modal proprio; virou aba, porque dois lugares para editar a mesma coisa e
  o mesmo problema das duas engrenagens.
- **Voz e video** — escolha de microfone e um TESTE com medidor de nivel ao
  vivo. Existe porque antes descobrir que o microfone estava mudo exigia
  entrar numa call e perguntar para alguem.

### Limitacoes conhecidas

- **O teste de microfone e um botao, nao liga sozinho.** Ninguem deve ter o
  microfone aberto sem ter pedido. O stream fecha quando a tela sai — o audio
  nao e gravado, nem enviado, nem guardado.
- **`mic-level.ts` e separado de `voice-activity.ts` de proposito**, apesar de
  os dois lerem RMS do microfone: um reporta BOOLEANO nas transicoes (vai pelo
  socket para os outros), o outro devolve nivel CONTINUO que nunca sai da
  maquina. Unificar acoplaria uma medicao de interface a um evento de rede.
- **A escolha do alto-falante troca a saida ao vivo**, sem derrubar a call:
  `setSinkId` e aplicado a todos os `<audio>` ja anexados (microfone dos
  outros e som de tela) e guardado para as faixas que chegarem depois. E
  Chromium-only — no Firefox o metodo nao existe e a tela diz isso em vez de
  fingir que funcionou.

  **Isso NAO conserta o som do compartilhamento de tela em fone sem fio.**
  Sao mecanismos opostos: aqui e para ONDE tocamos o que chega; la e de ONDE
  capturamos o som para ENVIAR — e o loopback sempre le da saida PADRAO do
  Windows, coisa que nenhuma API do Electron deixa escolher (ver a secao do
  app desktop).
- **Ainda nao ha sensibilidade manual nem push-to-talk.** O volume de cada
  pessoa continua no menu dela, na arvore de canais.
- **O medidor multiplica o RMS por 4.** Voz normal fica em 0,02–0,15 de RMS;
  sem isso a barra mal sairia do lugar e pareceria microfone quebrado.

## Amigos

Adicionar pessoas sem depender de servidor em comum. E o unico lugar do app
onde duas contas se enxergam fora de um servidor — e por isso a parte mais
delicada nao foi a tela, foi decidir **o que exatamente um amigo passa a ver**.

### O modelo: uma linha por par

`Friendship` guarda `requesterId`, `addresseeId` e `status`. **Uma linha por
par, nao duas.** Duas linhas (uma por direcao) obrigariam a manter as duas em
acordo a cada mudanca, e duas verdades sobre a mesma relacao terminam com uma
delas para tras.

A consequencia e que depois de aceito **nao ha mais lado**: `requesterId` so
diz quem pediu (que e o que decide de que lado aparece o botao "aceitar"), e
toda consulta de "meus amigos" precisa olhar **as duas colunas**. Isso mora em
`packages/access/src/friends.ts`, num lugar so, porque o gateway precisa da
mesma resposta que o app web — regra de quem-ve-quem duplicada e falha de
privacidade, nao tela desatualizada.

O indice unico do banco e **por direcao**. Ele nao barra o par invertido: quem
barra e a action, que consulta os dois sentidos antes de criar. Existe um teste
que prova justamente isso (`verify-friends.mjs`), para ninguem remover a
checagem da action achando que o banco cobre.

### A sala pessoal, e por que a presenca de amigo e um evento separado

Presenca so trafegava em `server:<id>`. Dois amigos sem servidor em comum nunca
se veriam online. Agora todo socket entra tambem na propria sala `user:<id>`,
e e por ela que chega o que e endereçado a PESSOA.

**O evento `friend:presence` e separado do `presence:update` por privacidade,
nao por organizacao.** O de servidor carrega `serverId`; entregar isso a um
amigo que nao e membro contaria que aquele servidor existe — inclusive
servidores privados. O de amigo leva exatamente cinco campos: `userId`,
`status`, `game`, `gameSince`, `gameIcon`. Ha um teste que falha se algum
outro campo aparecer.

**O que um amigo NAO ve:** em qual canal de voz voce esta. Isso continua em
`voice:update`, restrito a sala do servidor, porque canal de voz so faz
sentido para quem e membro dali. Se voces dividem um servidor, voce ve pela
via de sempre — como membro, nao como amigo.

### Adicionar so por nome exato

Nao existe busca de pessoas, nem listagem, nem sugestao. Um endpoint de
procurar gente vira um catalogo de quem tem conta aqui, e catalogo assim serve
para montar lista de alvo.

**Dizemos quando o nome nao existe** — diferente da recuperacao de senha, que
responde igual dos dois jeitos. A diferenca e deliberada: la o dado e o e-mail,
que identifica a pessoa fora daqui; aqui e o nome de usuario, que ja aparece
para qualquer um que divida um servidor com ela. E engolir o erro faria todo
erro de digitacao virar um pedido que nunca chega, sem jeito de perceber — o
recurso ficaria quebrado na pratica para proteger o que ja e publico.

O que sobra de risco e varrer nomes para descobrir quais existem. Contra isso
ha rate limit **por IP e por conta**: so por IP daria para varrer trocando de
rede.

### Invisivel agora esconde o jogo de verdade

Antes, quem escolhia "Invisivel" aparecia apagado, mas **o nome do jogo
continuava viajando pela rede** — invisibilidade so na tela de quem usa o
cliente oficial. Agora o gateway zera `game`, `gameSince` e `gameIcon` no que
sai, tanto para servidor quanto para amigo. O dado nem sai do processo.

Isso nao muda nada na SUA tela: o cartao de atividade so le a atividade dos
outros, nunca a propria.

### Como testar

```bash
# regras do banco (indice, check, cascade) — nao precisa de servico no ar
npx dotenv -e .env -- node scripts/verify-friends.mjs

# roteamento ao vivo — precisa do gateway (npm run dev:realtime)
npx dotenv -e .env -- node scripts/verify-friends-live.mjs
```

Na interface: o botao **Amigos** no topo da barra de servidores, com um ponto
vermelho quando ha pedido esperando voce.

### O layout de tres paineis

```
 64px        244px            flexivel              260px
 servidores  navegacao        lista de amigos       "Ativo agora"
```

Fixos e lado a lado; nenhum flutua sobre o outro, nenhum vira tela separada.
Duas escolhas merecem explicacao:

**O formulario de adicionar mora DENTRO da lista**, e nao numa tela propria.
Quem acaba de mandar um pedido ve a lista mudar no mesmo lugar em que ja estava
olhando, em vez de voltar de uma tela vazia para conferir se funcionou.

**Em "Solicitacoes" o agrupamento e recebido/enviado, nunca online/offline.**
Nao e estetica: a presenca de um amigo so viaja entre AMIGOS, entao quem ainda
e um pedido pendente aparece sempre como offline ali. Agrupar por isso diria
"fulano esta offline" quando a verdade e "ainda nao da para saber" — o
comportamento de privacidade esta certo, e a tela e que estava mentindo sobre
ele.

O painel direito so mostra quem esta REALMENTE jogando. Nao ha lista de
"amigos online" repetida: isso ja e o painel do meio, e repetir a mesma
informacao em duas colunas gasta 260px sem dizer nada novo.

**O que NAO foi construido, de proposito:** "Nitro", "Loja", "Missoes",
mensagens diretas, aba "Bloqueado" e o botao de mensagem no hover. Nenhum
desses recursos existe no Aether. Construir a casca de um recurso inexistente
entrega um botao que nao faz nada — que e demonstracao visual, e este projeto
mira o contrario. Entram conforme passarem a existir.

### Limitacoes conhecidas dos amigos

- **Nao ha bloquear.** Recusar um pedido **apaga** a linha em vez de marcar
  "recusado". Guardar a recusa significaria guardar para sempre que fulano
  disse nao a sicrano, e impedir pedido futuro — o que ja seria bloqueio. Por
  enquanto, contra insistencia so ha o rate limit (20 por hora, por IP e por
  conta).
- **Nao ha mensagem direta.** Amizade hoje serve para ver quem esta online e
  entrar junto num servidor que os dois tenham. Conversa continua sendo por
  canal de servidor.
- **A lista de amigos do gateway fica em memoria.** Aceitar um pedido so passa
  a valer porque o app web avisa em `/internal/friends-changed`. Se o gateway
  estiver fora do ar nesse instante, os dois continuam amigos no banco, mas a
  presenca de um so aparece para o outro na proxima reconexao. Mesmo desenho
  (e mesma limitacao) do `/internal/evict`.
- **Com mais de uma instancia do gateway isso quebra**, como o resto da
  presenca: a sala `user:<id>` e local ao processo. Precisa do adapter de
  Redis junto com o restante do estado vivo.
- **O status inicial da lista vem do banco, nao de quem esta online.** Ao
  abrir a tela, quem aparece e a preferencia guardada ate o primeiro
  `friend:sync` chegar — fracao de segundo, mas existe.
- **Nao ha limite de quantidade de amigos.** Uma conta pode acumular quantos
  quiser; o custo aparece no `friend:presence`, que percorre a lista a cada
  mudanca de status.

## AETHER Activity (cartao de atividade)

O que a pessoa esta fazendo agora, num cartao que abre ao clicar nela — na
arvore de canais ou no painel de membros.

**Nao existe um "objeto de presenca" novo por tras disto, de proposito.** Tudo
que o cartao mostra ja viajava em tempo real: `presence` da o online/ausente, e
`VoiceState` ja carregava canal, mudo, surdo, tela e falando. Inventar uma
segunda fonte para os mesmos fatos criaria duas verdades sobre a mesma pessoa —
e quando divergissem, nao haveria qual acreditar. E o mesmo motivo pelo qual a
autorizacao mora so em `@aether/access`.

O unico campo novo e `joinedAt`, em `VoiceState`. Carimbado pelo GATEWAY, nunca
pelo cliente: relogio de navegador erra, e um cliente poderia dizer que esta ali
ha oito horas.

Onde fica:

- `packages/shared/src/types.ts` — `joinedAt` em `VoiceState`
- `apps/realtime/src/state.ts` — carimbo na entrada
- `apps/web/src/components/profile/user-activity-card.tsx` — o cartao
- `channel-members.tsx` e `member-panel.tsx` — quem abre
- `tests/unit/voice-activity.test.ts` — as regras do relogio

### Limitacoes conhecidas do AETHER Activity

- **"Assistindo a transmissao de alguem" NAO existe.** Estava no rascunho
  original, mas ninguem rastreia quem esta OLHANDO qual tela: o SFU sabe quem
  publica, nao quem assiste. Mostrar isso exigiria um evento novo de
  sinalizacao, e ficou de fora desta versao em vez de ser simulado.
- **Nada de jogo, musica ou status personalizado.** E a "2.0" do rascunho:
  depende de integracao externa (um jogo dizendo ao AETHER o que esta
  rodando), que e trabalho de outra natureza.
- **Trocar de canal REINICIA o relogio; reconectar no mesmo canal preserva.**
  A segunda regra existe porque uma queda de rede chama `joinVoice` de novo — e
  zerar ali faria o tempo voltar do zero por um soluco que a pessoa nem viu.
  Testado nos dois sentidos.
- **O relogio vem do gateway, que guarda voz em MEMORIA.** Reiniciar o gateway
  zera o tempo de todo mundo, porque ninguem "esta numa call" de forma
  persistente. E a mesma limitacao ja documentada da fase 3.
- **Aberto pela arvore de canais, o cartao FECHA se a pessoa sair da voz** — a
  lista inteira desmonta junto com ela. Pelo painel de membros isso nao
  acontece. Nao e travamento: verificado, sem erro no console.
- **O cartao nao se reposiciona se a janela for redimensionada com ele
  aberto.** Ele se ajusta para caber na ABERTURA; depois disso, fica. Mesmo
  comportamento do menu de moderacao, que ja era assim.
- **A contagem de pessoas no canal e derivada no cliente**, contando quem a
  store conhece naquele canal. Bate com a arvore de canais porque as duas leem
  a mesma fonte.

## Capa de jogo pelo IGDB (fase 1 — camada de metadados)

O que a atividade mostra alem do nome. **O IGDB e provedor de METADADOS, nunca
detector**: quem descobre que voce esta jogando continua sendo o app de
desktop, lendo processos na sua maquina.

### O que o IGDB resolve — e o que ele NAO resolvia

A suposicao comum e que falta um banco de jogos para converter
`HollowKnight.exe` em "Hollow Knight". **O Aether nunca olhou o nome do
executavel.** Ele olha a pasta de instalacao e o manifesto da propria loja:
`appmanifest_*.acf` na Steam, `DisplayName` na Epic. "Apex Legends" ja saia
certo porque o jogo mora em `steamapps/common/Apex Legends/` — sem cadastrar
nada.

O problema real era outro: **icone de executavel tem 48px, e capa de jogo e um
retrato de 264x374.** Era isso que fazia a atividade parecer pobre. E isso que
o IGDB conserta.

### A ordem, que e o desenho todo

```
1. cache no banco   (compartilhado entre todo mundo)
2. IGDB             (so em falta no cache, ou quando ele envelheceu)
3. o que o detector ja deu  (nome + icone do executavel)
```

O passo 3 **nunca falha**, e e por isso que a atividade nunca fica quebrada: o
IGDB e enfeite em cima de algo que ja funciona sozinho. Fora do ar, sem
credencial, respondendo 429 ou simplesmente sem o jogo — a pessoa continua
aparecendo como "jogando X" com o icone do executavel.

**Quem chama nao espera.** O gateway anuncia o jogo na hora e resolve a capa em
segundo plano; quando ela chega, anuncia de novo. Pendurar o anuncio na
consulta faria a atividade de todo mundo depender da latencia de terceiro.

### O cache e compartilhado, e nao tem coluna de usuario

`GameMetadata` guarda **"Hollow Knight tem esta capa"**, nunca "fulano jogou
Hollow Knight". O primeiro que abre um jogo resolve a capa para todos os
outros — cache por maquina faria cada pessoa pagar a mesma consulta, e o IGDB
limita a 4 por segundo.

A ausencia de coluna de usuario e verificada por teste, nao por disciplina:
guardar quem consultou transformaria um cache de arte num historico de habitos
de jogo — exatamente o dado que a deteccao local se recusa a mandar para o
servidor.

Duas validades, porque os casos sao diferentes: linha **com** capa vale 30
dias (esta resolvida); linha **sem** capa vale 3 (pode ser jogo que o IGDB
ainda nao tinha, e merece nova chance).

### Casar o nome errado e o pior defeito possivel aqui

Nao e travamento nem excecao: e uma imagem plausivel e ERRADA na tela de outras
pessoas. Por isso o casamento e em degraus e o corte e alto:

| confianca | criterio |
|-----------|----------|
| 1,00 | identicos depois de normalizar |
| 0,90 | identicos ignorando a edicao ("Spider-Man" x "... Remastered") |
| 0,75 | um contem o outro **e o que sobra nao e numero de sequencia** |
| 0,00 | qualquer outra coisa |

Abaixo de 0,75 **nao usamos nada** — sem capa e melhor que capa errada. E o
nome do IGDB so substitui o do detector acima de 0,90; abaixo disso o nome da
LOJA vale mais, porque veio do manifesto do jogo instalado.

A clausula do numero de sequencia existe por causa de um defeito que o teste
pegou: `"Portal"` cabe dentro de `"Portal 2"` como palavra, e a capa de Portal
ia para quem joga Portal 2. Agora o que sobra decide — `"the wild hunt"` e
subtitulo (mesmo jogo), `"2"` e sequencia (outro jogo). Vale para romano
tambem: "Final Fantasy" nao e "Final Fantasy VII".

### Onde as credenciais moram

O IGDB autentica pela **Twitch**, com *client credentials* — a aplicacao pega
um token para ela mesma. Nao ha login de usuario, nao ha redirect, nao ha nada
para o navegador fazer.

`TWITCH_CLIENT_ID` e `TWITCH_CLIENT_SECRET` vao **so para o gateway** (Fly).
Nao vao para a Vercel e nao vao para o Electron: o app desktop carrega conteudo
remoto, e segredo la e segredo publicado. A consulta parte do nosso servidor,
nao da maquina de quem joga — assim o IGDB ve o IP de um servidor, e nao "o IP
do Ryan pediu Hollow Knight as 3 da manha".

O par e opcional. Sem ele tudo funciona, so nao ha capa.

### Nunca uma imagem quebrada

A cadeia no desenho: capa do IGDB, senao icone do executavel, senao icone
generico. **A falha de CARREGAMENTO tambem cai na cadeia** — uma capa que
responde 404 e indistinguivel de nao ter capa, do ponto de vista de quem esta
olhando a tela.

### Como testar

```bash
npx vitest run tests/unit/game-metadata.test.ts
npx dotenv -e .env -- npx tsx scripts/verify-igdb.mjs
npx dotenv -e .env -- npx tsx scripts/verify-igdb-live.mjs   # precisa do gateway no ar
```

Os dois ultimos rodam por `tsx` (e nao `node`) porque importam os modulos
TypeScript do gateway de verdade, em vez de uma reimplementacao.

Sem credencial, o `verify-igdb` **nao pula em silencio**: confere a tabela e o
caminho de fallback — que e o que passa a valer — e diz o que ficou por
conferir.

O `verify-igdb-live` e o que prova que o GATEWAY liga as pecas, e nao so que
os modulos funcionam isolados. Ele percorre o que a pessoa percorre: o anuncio
imediato sem capa, o segundo anuncio com a capa, o cache gravado, a troca de
jogo sem herdar a arte do anterior. Essa classe de defeito — peca certa,
ligacao errada — ja apareceu duas vezes neste projeto.

### Limitacoes conhecidas da capa de jogo

- **O app da Twitch precisa ser do tipo CONFIDENCIAL.** Cliente publico nao
  recebe Client Secret — por definicao — e o fluxo *client credentials* nao
  funciona sem ele. Se o botao "Novo Segredo" nao aparecer no console da
  Twitch, e porque o tipo esta como "Publico".
- **A capa vai como URL, nao embutida.** O navegador de QUEM OLHA busca a
  imagem no `images.igdb.com`, entao o IGDB ve o IP de quem esta vendo a
  atividade. Embutir obrigaria o servidor a baixar e reencodar a capa de todo
  jogo. Se isso incomodar, o conserto e um proxy no nosso dominio.
- **So Steam e Epic sao detectados** — o IGDB nao muda isso, porque ele nao e o
  detector. GOG, Battle.net, Xbox e jogos avulsos continuam de fora ate a fase
  3 (aliases e cadastro manual).
- **Nao ha `details` nem `state`** como no Rich Presence do Discord ("Nivel 3",
  "Na partida"). Isso exige o JOGO cooperar por um SDK; nada e derivavel de
  fora. O que temos e nome, capa e tempo.
- **O genero e guardado mas nao aparece** em lugar nenhum ainda.
- **Um jogo com nome muito generico pode nao casar.** O corte alto e
  deliberado: prefere ficar sem capa a arriscar a errada.

## Deteccao de jogo (so no app desktop)

"Jogando Hollow Knight" no cartao de atividade, como o Discord faz.

**Nao existe banco de dados de jogos, e nao precisa** — cada loja ja diz o que
instalou, e cada uma diz de um jeito:

- **Steam** instala sempre em `steamapps/common/<Pasta do Jogo>/`, entao o
  caminho do processo ja identifica o jogo; o `appmanifest_*.acf` ao lado
  converte a pasta no nome oficial — e de la que sai o apostrofo certo de
  "Marvel's Spider-Man Remastered", que a pasta nao tem.
- **Epic** nao tem convencao de pasta nenhuma: o GTA V que motivou este
  suporte estava em `E:\GTAV`, sem nada no caminho que dissesse "Epic". Em
  compensacao ela guarda um manifesto JSON por jogo em
  `C:/ProgramData/Epic/EpicGamesLauncher/Data/Manifests/*.item`, com
  `DisplayName` JA PRONTO e `InstallLocation` — melhor estruturado que o da
  Steam. Casamos por caminho de instalacao.

Isso cobre qualquer jogo dessas duas lojas, inclusive os instalados depois.

**Privacidade e o que decide o desenho.** O casamento acontece no processo
principal do Electron, e a lista de processos NUNCA sai da maquina — o unico
dado que atravessa a ponte (e dai para o gateway) e o nome do jogo ja
identificado. Tudo que nao casa com a regra da Steam e descartado sem sair
dali. Por isso tambem **comeca desligada**: ninguem tem a propria lista de
programas lida sem ter pedido.

O gateway trata o nome como TEXTO DE CLIENTE — corta em `GAME_NAME_MAX` e nao
persiste. Nao ha lista de jogos validos para conferir contra, e inventar uma so
criaria cadastro para manter; o dano possivel de um nome mentiroso e alguem
dizer que joga o que nao joga.

Onde fica:

- `apps/desktop/src/game-detect.js` — deteccao e casamento
- `apps/desktop/src/main.js` / `preload.js` — a ponte e a preferencia
- `apps/web/src/lib/desktop/game-activity.ts` — o lado da pagina
- `apps/web/src/components/realtime/game-activity-monitor.tsx` — leva ao gateway
- `packages/shared/src/events.ts` — `game`/`gameSince` em `PresenceEntry`
- `tests/unit/game-detect.test.ts` e `scripts/verify-game-activity.mjs`

### Limitacoes conhecidas da deteccao de jogo

- **So Steam e Epic.** GOG, Battle.net, Xbox e jogos avulsos ainda nao sao
  detectados — cada loja guarda o catalogo de um jeito, e cobrir mais uma e
  escrever mais uma regra. A alternativa geral seria uma tela de "adicionar
  jogo" manual.
- **Um jogo instalado pelas DUAS lojas conta como Steam.** A regra da Steam e
  avaliada primeiro; e caso raro e o nome sai igual de qualquer jeito.
- **O cache dos manifestos da Epic e invalidado pela data da PASTA**, nao por
  tempo. Instalar ou desinstalar mexe na pasta e forca a releitura. Uma leitura
  VAZIA nunca vira cache, de proposito: a Epic reescreve os manifestos ao
  instalar ou verificar um jogo, e cachear o vazio desse instante travaria a
  deteccao ate a pasta mudar outra vez.
- **So no app de desktop, e so no Windows.** Navegador nao enumera processos —
  no site a secao aparece explicando isso, em vez de um botao morto.
- **O icone vem do EXECUTAVEL**, via `app.getFileIcon` — sem CDN, sem banco de
  imagens, sem consultar a internet, e funciona igual para qualquer loja. Nao e
  a arte de capa que outros apps mostram: aquilo vem do catalogo deles.

  Entre os processos do mesmo jogo escolhemos o de MAIOR data URL, e isso nao e
  chute: medido no GTA V, o `PlayGTAV.exe` devolve 550 bytes (praticamente um
  icone generico) e o `GTA5.exe` devolve 4126 bytes em 48x48. Pegar o primeiro
  daria o pior dos dois.

  **Anti-cheat, bootstrapper e relator de erro nao emprestam o icone.**
  Descoberto com o Fall Guys, que aparecia com o escudo do Easy Anti-Cheat.
  A investigacao contrariou a suposicao inicial: TRES dos quatro executaveis
  trazem a logo do jogo (`RunFallGuys.exe`, `FallGuys_client.exe`,
  `FallGuys_client_game.exe`) e so o `start_protected_game.exe` traz o do EAC —
  que ainda por cima e o MENOR, ou seja, a regra de "maior vence" ja o
  descartaria. O problema era outro: o anti-cheat sobe ANTES do jogo, existe
  uma janela em que ele e o unico processo da pasta, e o icone capturado ali
  ficava preso porque so avisavamos quando o NOME mudava. Dois consertos: a
  lista `NAO_DA_ICONE` e a comparacao passou a incluir o icone, entao ele
  MELHORA assim que o processo do jogo aparece.

  **E isso quebrou de outro jeito**, reportado na sequencia: com o anti-cheat
  bloqueado, o Fall Guys passou a nao ter icone NENHUM — enquanto se joga, o
  unico processo visivel daquela pasta pode ser justamente o do anti-cheat.
  A saida foi parar de depender so de quem esta RODANDO: o manifesto da Epic
  traz `LaunchExecutable`, e esse arquivo existe no disco o tempo todo. Ele
  entra como candidato junto dos processos, e vence quem tiver o icone maior —
  o que mantem o GTA V com o icone bom do `GTA5.exe` (4126 bytes) em vez do
  atalho `PlayGTAV.exe` (550).

  O icone atravessa o gateway como data URL e e renderizado na tela dos
  OUTROS — por isso passa por `safeGameIcon`, que so aceita PNG, JPEG e WEBP em
  base64, com teto de tamanho. **SVG e recusado de proposito**: SVG e
  documento, aceita `<script>`, e nenhum icone precisa ser SVG.
- **Sem detalhes de dentro do jogo** (placar, fase, grupo). Isso exigiria que
  os jogos integrassem com um SDK NOSSO, o que nenhum vai fazer. E a diferenca
  entre a deteccao por processo e o Rich Presence de verdade.
- **O que a loja instala mas nao e jogo precisa de lista de exclusao.**
  Descoberto na primeira deteccao real: veio `wallpaper_engine` junto do jogo.
  A Epic tem o caso equivalente na Unreal Engine, que ela distribui pela mesma
  via dos jogos. A lista esta em `NAO_SAO_JOGOS` e cobre os casos conhecidos —
  outro app pode escapar ate ser adicionado.
- **Verifica a cada 15s**, entao abrir ou fechar um jogo leva ate 15 segundos
  para refletir. Medido nesta maquina: ~300ms por verificacao com `wmic`,
  contra ~1600ms do PowerShell — por isso `wmic` vem primeiro.
- **`wmic` foi removido por padrao no Windows 11 24H2+**, e por isso existe a
  reserva em PowerShell. Nessas maquinas cada verificacao custa ~5x mais.
- **Mais de um jogo aberto mostra so um** — o primeiro em ordem alfabetica.
  Escolha estavel, nao "a melhor": sem ordenar, o nome ficaria alternando entre
  os dois a cada verificacao.
- **Nao persiste.** Reiniciar o gateway limpa o jogo de todo mundo, como a
  presenca.
- **A varredura de processos em si nao tem teste automatizado**, e nem daria:
  dublar `execFile` testaria o duble. O que esta coberto por teste e a logica
  que decide — caminho -> nome, o que nao e jogo, leitura do manifesto.

  A ponte IPC foi verificada rodando o `main.js` e o `preload.js` REAIS, com o
  Electron apontado para uma pagina de teste local que relata por HTTP (o
  Electron no Windows nao entrega o console para um terminal com pipe). Sete
  verificacoes, incluindo a cadeia inteira ate o nome do jogo chegar na pagina.
  Se for repetir: o app usa trava de instancia unica, entao passe
  `--user-data-dir` proprio ou a instancia de teste sai na hora com o app
  aberto.

## Testes automatizados

Suite unitaria (fase 7a). **Nao precisa de banco, servidor nem gateway** — roda
em cerca de um segundo, offline:

```bash
npm test
```

```bash
npm run test:watch
```

O Vitest apaga os tipos sem conferir, entao a suite tem um passo proprio de
typecheck:

```bash
npm run typecheck:tests
```

O que ela cobre: o bitfield de permissoes e a resolucao de overwrites, a
hierarquia de quem pode moderar quem, a separacao entre cookie de sessao e
ticket de socket, o hash de senha, os dois rate limits, os schemas que
transformam entrada, e as recusas do upload de icone (tamanho e tipo real por
bytes). E logica pura — o caminho de ponta a ponta continua sendo dos
`verify-phase*.mjs`.

### Regressao de integracao

Os `verify-phase*.mjs` falam HTTP e WebSocket de verdade, contra o banco de
verdade. Precisam dos servicos no ar:

```bash
npx dotenv -e .env -- node scripts/verify-phase3.mjs
```

**Feche as abas do app antes**, ou a cobertura fica incompleta. A presenca conta
por USUARIO, nao por socket: com uma aba de `joao` aberta, o `server:join` do
script nao o torna presente — ele ja era — e o gateway, corretamente, nao
anuncia nada. Duas assercoes da fase 3 dependem disso.

Quando ha cliente conectado, o script avisa no topo e **pula** essas duas,
nomeando-as com `--`, em vez de reprova-las. Falhar ali descreveria uma aba
aberta, nao um defeito; e barrar as outras quarenta por causa de duas trocaria
um resultado enganoso por resultado nenhum.

`scripts/verify-phase7b.mjs` testa a revalidacao de sessao e o recalculo de
salas (fase 7b). Mais lento que os demais de proposito: a secao de sessao
espera ate 40s pelo intervalo real do guarda do gateway — nao ha como provar
que um timer dispara sem esperar o timer disparar.

```bash
npx dotenv -e .env -- node scripts/verify-phase7b.mjs
```

Os de amizade sao dois porque cobrem camadas diferentes: `verify-friends.mjs`
so precisa do banco (indice unico, `CHECK` de nao-ser-amigo-de-si-mesmo,
cascade), e `verify-friends-live.mjs` precisa do gateway no ar — e onde se
prova que a presenca chega ao amigo **sem** `serverId` e sem canal de voz.

```bash
npx dotenv -e .env -- node scripts/verify-friends.mjs
npx dotenv -e .env -- node scripts/verify-friends-live.mjs
```

Os dois criam usuarios descartaveis e os apagam no fim; nenhum toca em conta
real.

## Como testar a FASE 2

Verificacao automatica (com o dev server rodando em outro terminal):

```bash
npx dotenv -e .env -- node scripts/verify-phase2.mjs
```

O script cria sessoes reais no banco, assina o mesmo JWT do app e faz
requisicoes HTTP autenticadas — testa o caminho real (middleware, guards,
filtro de canais privados), nao uma reimplementacao da regra. Ele limpa tudo
o que cria.

Roteiro manual:

1. Entre como `ryan` / `senha123`.
2. Passe o mouse sobre uma categoria: aparecem renomear, excluir e **+**.
3. **Novo canal** → escolha Voz, marque **Canal privado** e libere so o cargo
   Moderator. Salve.
4. Em outra janela anonima, entre como `joao` / `senha123`: o canal privado
   **nao aparece** na arvore. Cole a URL dele: responde 404.
5. Como ryan, engrenagem no topo → **Cargos**: marque `Mutar usuarios` no
   cargo Member e salve. Volte em **Membros** e de o cargo Moderator ao joao.
6. Recarregue a janela do joao: o canal privado agora aparece.
7. Ainda como joao, tente abrir `/app/s/<id>/settings`: 404, porque Member nao
   tem `MANAGE_ROLES`.

### Regras de hierarquia que a interface mostra

- Cargo acima do seu abre em modo leitura.
- Permissao que voce nao possui aparece travada — conceder o que nao se tem
  seria escalada de privilegio, e o servidor recusa mesmo se o cliente enviar.
- O cargo do dono nao pode ser editado, excluido ou atribuido por ninguem.

---

## Como testar a FASE 1

1. `http://localhost:3000` redireciona para `/login`.
2. Crie uma conta em `/register`.
3. Sem servidores, o app mostra o estado vazio. Clique no **+** da barra lateral
   → **Criar servidor**. Sao criados automaticamente: 5 cargos
   (Owner/Administrator/Moderator/Member/Guest), as categorias GERAL e PRIVADO,
   os canais de exemplo e um convite.
4. O botao **Convidar** no topo gera/reaproveita um codigo de 8 caracteres.
5. Abra uma janela anonima, crie uma segunda conta e entre com o codigo
   (**+** → *Entrar com convite*, ou `http://localhost:3000/invite/<codigo>`).
6. A segunda conta aparece no painel da direita agrupada pelo cargo Member.

### Verificacoes de seguranca (o que deve falhar)

- Acessar `/app/s/<id-de-servidor-que-voce-nao-participa>` → **404**
  (nao 403: nao revelamos que o servidor existe).
- Acessar `/app/s/<seu-servidor>/c/<canal-de-outro-servidor>` → **404**.
- Sair da conta e abrir `/app` → redireciona para `/login`.
- Errar a senha 10x em 5 minutos → bloqueio temporario por IP.
- O botao **Convidar** so aparece para quem tem a permissao `CREATE_INVITE` —
  e a action revalida a permissao no servidor, entao chamar a action direto
  sem permissao tambem falha.

---

## Backup do banco

```bash
npm run backup           # gera backups/aether-<carimbo>.json
npm run backup:verify    # PROVA que restaura — roda isto, nao so o de cima
npm run restore -- backups/aether-....json
```

**Backup de DADOS, nao de schema.** A estrutura ja esta versionada em
`packages/db/prisma/migrations` — duplicar isso num dump criaria duas verdades
sobre a mesma coisa, e no dia de restaurar ninguem saberia qual seguir.

O caminho de volta completo:

1. `npx prisma migrate deploy` — recria a estrutura a partir do git, ja com o
   RLS da migracao `20260823000000_rls_e_revoke`;
2. `npm run restore -- <arquivo>` — devolve os dados.

### O que o `backup:verify` prova

Backup nao testado e crenca, nao capacidade. Sao dois modos de falhar, e cada
um tem sua verificacao:

- **Ordem** — para cada uma das 22 chaves estrangeiras, a tabela pai vem antes
  da filha. Verificado como PROPRIEDADE contra o grafo real de FKs, e nao
  "restaurei e nao deu erro": uma tabela vazia por acaso passaria pelo segundo
  teste sem exercitar ordem nenhuma.
- **Fidelidade** — dump, restauracao num schema descartavel do proprio banco, e
  comparacao canonica. As 13 tabelas voltam identicas.
- **O bitfield de permissoes** ganha teste proprio, inclusive com um valor
  acima de 2^53. `permissions`, `allow` e `deny` sao `BigInt`, e
  `JSON.stringify` LANCA em BigInt: errar ali nao corrompe "um dado", corrompe
  quem pode o que.

O teste roda num schema descartavel do banco de producao (criado e derrubado na
hora), e nao num projeto novo. Nao cria infraestrutura e ainda assim exercita
Postgres de verdade.

**Um bug real saiu daqui**, e nao de leitura de codigo: o Postgres nao converte
texto para ENUM sozinho num INSERT parametrizado (`column "status" is of type
"UserStatus" but expression is of type text`). O `restore.mjs` passou a
converter as colunas de enum explicitamente.

### Limitacoes conhecidas do backup

- **O Supabase Storage NAO entra.** Fotos de perfil e icones de servidor vivem
  fora do banco; o dump tem a URL, nao a imagem. Restaurar o banco num projeto
  novo deixaria os avatares quebrados.
- **E manual.** Nao ha agendamento: se ninguem rodar, nao ha backup. O plano do
  Supabase e o FREE, onde a retencao propria e curta.
- **`backups/` esta no `.gitignore`, e isso nao e detalhe.** O dump carrega o
  `passwordHash` de todo mundo e a tabela de sessoes — um backup versionado e
  um vazamento com historico.
- **A trava do `restore` e por contagem de usuarios**, nao por identidade do
  banco: ele recusa restaurar onde ja ha gente, e `--force` passa por cima.
  Nao ha nada que impeca apontar para o banco errado com `--force`.
- **Tabela criada por migracao FUTURA nao ganha RLS sozinha.** O
  `ALTER DEFAULT PRIVILEGES` cobre os grants, mas RLS e por tabela. Um gatilho
  de evento resolveria; nao foi feito porque seria maquinaria que alguem teria
  de entender depois, para um caso que o Security Advisor do Supabase ja
  denuncia. O habito vale mais: rodar o advisor apos mexer no schema.

## A API REST do Supabase esta FECHADA (RLS)

O Supabase nao expoe o banco so pela conexao Postgres que o Prisma usa: ele
tambem publica uma API REST automatica (PostgREST) na internet, aberta com a
chave `anon` — que o Supabase trata como PUBLICA por design, feita para ser
embutida em navegador.

**Estava tudo aberto, e nao era teorico.** Verificado em 23/08/2026 chamando a
API de fora: `GET /rest/v1/User` respondia `200` com a chave `anon`, e o papel
`anon` tinha SELECT, INSERT e DELETE nas 14 tabelas, todas com RLS desligado.
Ou seja: quem tivesse a chave lia `passwordHash`, lia sessoes e mensagens, e
podia APAGAR o banco inteiro. O que segurava era a chave nao estar publicada em
lugar nenhum — e isso e sorte, nao seguranca.

A correcao tem duas camadas, na migracao `fecha_api_publica_rls_e_revoke`:

1. `REVOKE` de tabelas, sequencias e funcoes para `anon`/`authenticated`, mais
   `ALTER DEFAULT PRIVILEGES` para tabela nova ja nascer sem grant;
2. `ENABLE ROW LEVEL SECURITY` nas 14 tabelas — rede de seguranca, porque o
   Supabase reconcede grants em algumas operacoes.

**Nao existe policy nenhuma, e isso e o certo aqui:** RLS ligado sem policy
significa NEGAR TUDO, e este app nunca usa PostgREST. O Advisor passa a marcar
"RLS Enabled No Policy" em nivel INFO — que descreve exatamente o desenho, e
nao um problema.

O app nao sente nada porque o Prisma conecta como `postgres`, DONO das tabelas,
e dono nao e afetado por RLS nem por grant. Confirmado depois de aplicar:
`GET /rest/v1/User` com a chave `anon` responde `401 permission denied`, o
DELETE tambem, e as 123 assercoes de regressao (fases 2 a 7b e jogo) seguem
passando.

Se um dia alguem precisar do PostgREST, o caminho e escrever policies
deliberadas — nunca desligar o RLS.

## Limitacoes conhecidas das IMAGENS (icone de servidor e foto de perfil)

Fora do roteiro das 7 fases: e uma divida da FASE 1 ("upload de avatar e icone
nao existe") paga fora de ordem, a pedido. Pronto: enviar, substituir e
remover o icone, com o resultado aparecendo na barra de servidores.

Onde mora: bucket `server-icons` no MESMO projeto Supabase que ja hospeda o
banco — nenhum fornecedor novo. O bucket e **publico para leitura** (e assim
que icone de servidor e servido em qualquer produto do genero) e a **escrita
passa so pela service_role key**, que ignora RLS por completo. Nao ha policy
de INSERT nenhuma, de proposito: quem autoriza a escrita e a Server Action
(`requirePermission MANAGE_SERVER`) antes de chamar o Storage; o Supabase nao
tem Auth proprio aqui para uma RLS decidir coisa alguma.

Duas camadas recusam arquivo indevido, e as duas foram verificadas: o servidor
detecta o tipo pelos **bytes reais** do arquivo (o `Content-Type` e escolhido
pelo cliente, entao um .exe renomeado para .png passaria se confiassemos
nele), e o proprio bucket recusa mime fora da lista mesmo com a service_role.

- **Arquivo antigo nunca e apagado.** Cada envio ganha um nome aleatorio novo,
  entao substituir ou remover deixa o anterior orfao no bucket. Apagar
  exigiria guardar o path (nao so a URL publica) e mais uma chamada de rede
  que pode falhar, por um espaco que custa centavos. Se um dia incomodar, e
  uma rotina de limpeza, nao uma mudanca de arquitetura.
- **Sem corte, sem redimensionamento, sem compressao.** Um PNG de 2MB e
  servido como 2MB para todo mundo que abre o app. O Supabase tem
  transformacao de imagem sob demanda, mas so no plano pago.
- **SVG e recusado de proposito.** E formato de imagem, mas carrega script —
  servido de um bucket publico vira XSS.
- **Avatar de usuario continua sem upload.** Este bloco cobriu so o icone de
  servidor; o `avatarUrl` do usuario segue caindo nas iniciais.
- **Sem as variaveis, o upload responde "nao configurado"** e nada mais
  quebra. Isso foi verificado: o app sobe e funciona igual sem
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.
- **O teste automatizado cobre as recusas, nao o sucesso.** As dez assercoes
  em `tests/unit/server-icon-upload.test.ts` rodam offline: tamanho, tipo real
  por bytes, SVG, e falha-fechada sem credencial. O caminho de sucesso exigiria
  a service_role key e rede — foi verificado a mao, contra o bucket real e
  pela interface, mas nao entra na suite.

## Limitacoes conhecidas dos AJUSTES DE USO (arvore em tempo real, volumes)

Fora do roteiro das 7 fases: pedidos que sairam do uso real com pessoas na
call. Pronto: a arvore de canais atualiza sozinha, volume por pessoa, e volume
do audio de tela.

### Foto de perfil

Cada pessoa troca a propria foto e o proprio nome de exibicao pelo modal que
abre ao clicar no seu avatar, na barra inferior. Bucket `avatars` proprio, e
nao `server-icons` com outro prefixo: um bucket chamado "icones de servidor"
guardando foto de usuario confunde depois, e separar da limites e limpeza
independentes.

As duas imagens passam pelo MESMO caminho de upload (`uploadImage` em
`server/storage.ts`). Duas copias da validacao divergiriam, e bastaria uma
esquecer o sniff de bytes para o bucket publico aceitar arquivo disfarcado.

- **As actions de perfil nao aceitam `userId`.** O id vem do cookie de sessao.
  Aceitar do cliente seria abrir "editar o perfil de qualquer um" atras de um
  campo de formulario.
- **Trocar a foto so atualiza a SUA tela na hora.** As outras pessoas veem a
  foto nova no proximo carregamento delas. O `revalidatePath` vale por sessao,
  e nao existe evento de socket para isso. Diferente do canal (que ganhou
  `server:changed`), foto de perfil atravessa TODOS os servidores da pessoa, e
  um evento global seria bem mais superficie por um ganho cosmetico.
- **Mensagens antigas ficam com a foto antiga** ate a pagina ser recarregada:
  o historico vem do banco com o avatar embutido no momento da consulta.
- **Nao ha auditoria.** O log e por servidor, e trocar a propria foto nao
  pertence a nenhum.
- **Arquivo antigo continua orfao no bucket**, mesma escolha do icone.
- **Nao existe apelido por servidor** (o item F do combinado). O nome de
  exibicao e um so, e vale em todos.
- **O caminho de sucesso segue sem teste automatizado** — os vinte testes de
  `server-icon-upload.test.ts` cobrem as recusas dos dois buckets. Upload e
  remocao foram verificados a mao, contra o Storage real e pela interface.

### Arvore de canais em tempo real

O sintoma que motivou: um canal criado agora so aparecia para os outros depois
de um F5. A fase 7b ja resolvia a metade de SEGURANCA (o socket entra na sala
do canal novo na hora), mas a LISTA e renderizada pelo Next e nada avisava o
cliente para pedi-la de novo.

O evento `server:changed` NAO carrega o que mudou, de proposito. Mandar a
arvore pelo socket exigiria o gateway recalcular e serializar permissao por
usuario — uma segunda copia da regra de autorizacao, que e exatamente o que
este projeto nao faz. O cliente recebe o sinal e pede ao Next para
re-renderizar; a regra continua morando num lugar so, e por isso tambem e
seguro emitir para a sala inteira: quem nao pode ver um canal re-renderiza e
recebe a mesma arvore de antes.

- **Debounce de 300ms.** Reordenar canal e uma sequencia de cliques; sem ele,
  cada seta viraria um re-render para todo mundo no servidor.
- **Cada mudanca custa um recalculo de salas para todos os conectados**, mesmo
  quando so a ORDEM mudou. Preferi isso a ter dois caminhos (um "so cosmetico"
  e um "de permissao"), porque esquecer qual usar em uma action nova daria
  sala velha — e sala velha e falha de acesso, nao tela desatualizada.
- **A barra de SERVIDORES nao atualiza**, so a de canais. Entrar ou sair de um
  servidor continua exigindo recarregar.

### Apelido por servidor

O nome que vale so num servidor. O campo `nickname` ja existia no schema desde
a fase 2 e ja era EXIBIDO (painel de membros, telas de moderacao) — o que
faltava era o caminho para defini-lo. A permissao `MANAGE_NICKNAMES` tambem ja
estava no bitfield e nos cargos padrao, sem uso.

Duas regras de acesso, e a diferenca importa:

- **o proprio apelido**: qualquer membro muda, pelo modal do proprio perfil
  (clique no seu avatar na barra inferior). E o proprio nome dele.
- **o apelido dos outros**: exige `MANAGE_NICKNAMES` E passa pela hierarquia,
  no modal de gerenciar o membro. Sem a hierarquia, alguem com a permissao
  renomearia o dono do servidor.

Ficou no modal de cargos, e nao no de moderacao, de proposito: la se expulsa e
bane, e misturar edicao com acao destrutiva e pedir clique errado.

- **O apelido NAO aparece no chat nem na voz.** Mensagem e participante de voz
  carregam `PublicUser`, que nao tem contexto de servidor; levar o apelido ate
  la exigiria o gateway resolver "apelido deste usuario neste servidor" a cada
  mensagem — uma consulta a mais no caminho mais quente do produto. Aparece no
  painel de membros, nas telas de moderacao e nas configuracoes.
- **Apelido vazio APAGA** (volta ao nome de exibicao). Guardar string vazia
  deixaria o membro sem nome nenhum na lista.
- **A action filtra por `serverId` no `updateMany`**, alem do guard: sem isso,
  mandar o `memberId` de um membro de OUTRO servidor renomearia ele.
- **Quem nao tem `MANAGE_NICKNAMES` nao ve o campo** no modal do membro. A
  action recusa de qualquer forma — a interface so evita oferecer o que sera
  negado.

### Trocar a qualidade sem parar a transmissao

A setinha ao lado do botao de compartilhar (mesmo vocabulario que o microfone
ja usa para trocar de aparelho) abre os tres perfis enquanto voce transmite. O
perfil ativo aparece marcado.

Por que nao parar e recomecar: isso reabriria o seletor nativo do Chrome,
obrigando a escolher a janela de novo no meio da conversa. O `restartTrack()`
do LiveKit tem o mesmo problema — para captura de tela ele chama
`getDisplayMedia` outra vez.

Entao mexemos nos tres lugares que aceitam mudanca ao vivo, e cada um e
independente do outro:

1. `contentHint` da MediaStreamTrack — decide o que o codificador sacrifica
   quando a banda aperta (nitidez ou fluidez). E o que mais muda a sensacao de
   qualidade.
2. `applyConstraints` — reduz resolucao e quadros na propria captura.
3. Parametros do `RTCRtpSender` — o teto de bitrate do encoder.

- **`applyConstraints` pode ser recusado** em alguns navegadores para faixa de
  tela. Quando isso acontece, os outros dois passos ainda valem e a qualidade
  muda de verdade — so nao na resolucao. Nao vira erro na tela: avisar "falhou"
  quando a transmissao mudou seria mentira. Fica no log de midia (`?debug=media`).
- **Nao da para SUBIR alem do que a captura entrega.** Se a fonte foi aberta a
  30fps, pedir 60 nao inventa quadros; a constraint e um teto, nao um piso.
  Trocar para um perfil mais alto que a captura original pode nao mudar nada
  visivelmente.
- **Os outros nao sao avisados**, de proposito: para eles nada mudou — a mesma
  pessoa segue transmitindo a mesma faixa. Nao ha evento de socket nem
  mudanca de `localSharing`.
- **Nao foi exercitado com transmissao real.** Testar exige `getDisplayMedia`,
  que precisa de gesto do usuario e de uma tela de verdade — fora do alcance do
  navegador automatizado. O typecheck cobre o contrato e a barra de controles
  foi verificada renderizando; o efeito na imagem ficou para o teste de uso.

### Volume por pessoa e volume da tela

Preferencia LOCAL, guardada no `localStorage`: e o volume com que EU ouço os
outros. Nao passa pelo gateway nem pelo banco — se passasse, mexer no volume
de alguem afetaria o que os outros escutam.

- **O teto e 100%, nao da para amplificar.** `HTMLMediaElement.volume` aceita
  0..1 por especificacao; acima disso lanca IndexSizeError. Amplificar exigiria
  rotear todo o audio por um GainNode da Web Audio API — este projeto ja apanhou
  de reproducao de audio (ver o comentario sobre `display:none` em
  `lib/voice/room.ts`), e trocar "consigo abaixar quem esta alto" por "posso ter
  quebrado o audio de todo mundo" nao compensa. Para equilibrar vozes
  desiguais, abaixe a mais alta.
- **Um controle so para o audio de TODAS as telas**, nao um por transmissao.
  Na pratica uma pessoa compartilha por vez; um slider por miniatura seria mais
  interface do que utilidade.
- **O volume nao viaja entre navegadores.** Trocar de maquina recomeça em 100%.
- **Nada disso foi exercitado numa call real de duas pessoas.** Os quinze
  testes de `tests/unit/volumes.test.ts` cobrem a logica pura (corte de faixa,
  persistencia, armazenamento corrompido ou bloqueado); o efeito sonoro em si
  depende de duas pessoas numa call e foi deixado para o teste de uso.

## Conversas diretas (DM)

Mensagem entre dois amigos, fora de qualquer servidor.

### Por que a conversa NAO e um `Channel`

Foi medido antes de decidir: **98** lugares no codigo acoplam canal a servidor,
contra **16** que tocam `Message.channelId`. Tornar `Channel.serverId` nulavel
mexeria numa superficie seis vezes maior.

Mais decisivo que o numero: `getChannelPermissions` se apoia inteiramente em
`MemberAccess` — servidor, membro, cargos, overwrites. Uma conversa direta nao
tem nenhum desses. A regra dela cabe em uma linha: *voce e um dos dois, e voces
ainda sao amigos*. Enfiar as duas coisas na mesma funcao criaria um segundo
caminho de decisao dentro da funcao que existe justamente para ser o unico.

Entao: `DmChannel` proprio, e `Message` com **dois pais possiveis**
(`channelId` OU `dmChannelId`). Uma tabela de mensagem so, e nao duas, porque
hoje a logica e fina — um `create`, duas leituras — mas editar, apagar e
responder vao chegar, e com duas tabelas chegam duas vezes e divergem.

### O que o banco garante (nao o codigo)

- **Par ordenado**: `CHECK ("userAId" < "userBId")`. Com a ordem obrigatoria, o
  indice unico impede DE VERDADE duas conversas para o mesmo par — inclusive
  quando os dois lados clicam em "conversar" no mesmo instante, que e onde uma
  checagem em codigo perde a corrida.
- **Um pai so por mensagem**: `CHECK (("channelId" IS NULL) <> ("dmChannelId" IS NULL))`.

Difere da `Friendship`, que indexa por DIRECAO, e a diferenca e proposital: la
o "quem pediu" precisa sobreviver, porque e ele que decide de que lado o botao
de aceitar aparece. Numa conversa nao existe esse lado.

### Duas portas: amizade, ou servidor em comum

`podeFalarCom(ator, alvo)` responde, nesta ordem:

1. **Amizade** — passa por cima de tudo, sem depender de configuracao.
2. **Servidor em comum**, se `alvo` tiver `allowServerDms` ligado (o padrao).

A regra e **assimetrica** de proposito: quem checa e quem AGE, e a chave
consultada e a de quem RECEBE. Se B desliga, A deixa de alcancar B — que e o
objetivo — mas B continua podendo ler e responder a propria conversa, porque a
chave dele governa o que CHEGA nele, nao o que ele quer dizer.

A permissao e rechecada a CADA acao, nao so na abertura: sem isso, bastaria ter
aberto uma vez para ficar alcancavel para sempre. **Nada e apagado** — religando
a chave (ou refazendo a amizade), o historico volta.

### Recusar em voz alta, e nao em silencio

Quando a porta esta fechada, `dm:open` responde
*"Esta pessoa so aceita mensagens de amigos. Envie um pedido de amizade."* — e a
tela mostra isso no cartao onde a pessoa clicou.

A alternativa considerada era aceitar a mensagem e nao entregar. Foi descartada:
quem manda acharia que foi entregue e que esta sendo ignorado. Mensagem que some
em silencio e pior que recusa, para os dois lados.

A recusa REVELA que a pessoa desligou a chave, e essa troca foi aceita
deliberadamente — esconder confunde mais do que protege, porque a configuracao
nao e um segredo, e uma preferencia de contato. Quem NAO existe continua
indistinguivel: so aparece a mensagem generica.

### Bloqueio por pessoa

`podeFalarCom` tem um PORTAO antes das duas portas: se existe bloqueio em
qualquer sentido, nada passa — nem amizade, nem servidor em comum.

A ordem importa e esta travada em teste. Com o bloqueio DEPOIS da amizade, um
`podeFalarCom` de duas pessoas que voltaram a ser amigas devolveria "amizade" e
o bloqueio nunca seria consultado; conferido por mutacao, e o teste
"amizade NAO passa por cima do bloqueio" cai.

**Os DOIS sentidos sao checados.** Olhar so "o alvo me bloqueou" deixaria quem
bloqueou continuar mandando mensagem para quem bloqueou — o oposto do que a
funcionalidade serve. Uma relacao bloqueada e muda nas duas direcoes.

A tabela, por outro lado, e DIRECIONAL: uma linha por sentido, sem par
ordenado. "A bloqueou B" e um fato diferente de "B bloqueou A", os dois podem
existir juntos, e desbloquear um nao desfaz o outro — ordenar os ids perderia
justamente quem bloqueou quem.

**Bloquear desfaz a amizade**, na MESMA transacao. Separadas, uma poderia
gravar e a outra nao, e sobraria alguem na sua lista de amigos com quem voce
nao consegue falar — o que contradiz a propria tela ("seus amigos sempre
conseguem falar com voce"). Vale para pedido pendente tambem.

**Desbloquear nao devolve a amizade.** Devolve a possibilidade de falar, nao a
relacao que existia antes: refazer amizade e decisao das duas pessoas, nao
efeito colateral. Isso esta dito na confirmacao, antes de bloquear.

Na tela: icone de bloquear ao lado de "desfazer amizade" na lista de amigos
(no hover, junto das outras decisoes de encerrar), e no cartao do membro dentro
do servidor — la com CONFIRMACAO, porque o botao fica perto de "Mandar
mensagem" num cartao pequeno e o erro nao se desfaz sozinho. A secao
"Bloqueados" na navegacao lista quem voce bloqueou, com "Desbloquear" sempre
visivel: aba cuja unica acao esta escondida no hover nao serve para nada.

### HISTORICO: por que o bloqueio precisou existir

Isto mudou quando a conversa por servidor nasceu, e e a parte menos obvia da
funcionalidade. Antes, desfazer amizade fechava a conversa — era a unica forma
de parar de receber mensagem de alguem, e funcionava.

Agora, se voces ainda dividem um servidor e a chave esta ligada (o padrao),
**desfazer amizade nao adianta nada**: a segunda porta continua aberta. Para se
livrar de uma pessoa especifica hoje e preciso desligar a chave — o que corta
TODO MUNDO que nao e amigo, nao so ela — ou sair do servidor em comum.

Isso esta travado em teste (`verify-dm.mjs`), com o nome dizendo o que e:
"desfazer amizade NAO fecha quando dividem servidor (comportamento novo)".

**Foi essa lacuna que o bloqueio por pessoa veio tapar** — ver a secao acima.
Hoje as saidas sao: bloquear a pessoa (o caminho certo), desligar
`allowServerDms` (que corta todos os nao-amigos de uma vez) ou sair do servidor
em comum.

### `channelId` virou `conversationId`

No contrato publico (`PublicMessage`) e nos eventos `message:send` /
`message:history`. O cliente sempre usou o campo como CHAVE (`messages[id]`,
`unread[id]`), nunca para buscar um `Channel` — com dois tipos de pai
possiveis, o nome antigo deixava pronta a armadilha de alguem escrever
`channel.findUnique({ id: message.channelId })` e receber `null` calado em toda
conversa direta.

### Como testar

```bash
npx dotenv -e .env -- node scripts/verify-dm.mjs
```

36 verificacoes: 8 tentam INSERIR no banco o que nao pode existir (par
invertido, conversa consigo mesmo, mensagem com dois pais, mensagem sem pai), e
20 exercitam o fluxo por socket real — incluindo as duas portas, a recusa
explicada e o que acontece ao desligar a chave com conversa ja aberta — abrir, idempotencia dos dois lados,
entregar na sala pessoal do outro, historico, listar, e o que mais importa: um
estranho de posse do id nao le nem escreve. Esse ultimo foi conferido por
mutacao (remover a checagem de participante derruba exatamente esses dois).

Na tela: entrar em Amigos, passar o mouse numa linha, clicar no icone de balao.

### Limitacoes conhecidas

- **Compatibilidade temporaria no gateway.** `message:send` e
  `message:history` ainda aceitam o nome antigo `channelId` alem de
  `conversationId`. Existe porque Vercel e Fly nao sobem no mesmo instante: sem
  isso, a janela entre os dois deploys seria chat quebrado para todo mundo.
  **Remover** — junto com o teste "compat:" em `verify-dm.mjs` — depois que os
  dois lados estiverem em producao com o nome novo.
- **Nao ha lista de conversas na lateral.** O evento `dm:list` existe e e
  testado, mas nada na tela o consome ainda: hoje se chega numa conversa pelo
  botao na lista de amigos ou pela URL. Conversa sem mensagem nova e sem
  atalho fica dificil de reencontrar.
- **Sem indicador de nao lida para DM.** O contador do store e por chave de
  conversa e ja funcionaria, mas nao ha onde exibi-lo sem a lista acima.
- **Sem notificacao.** Mensagem que chega com a conversa fechada nao avisa nada.
- **Sem anexo, edicao, exclusao ou resposta** — as mesmas ausencias do chat de
  servidor. O schema ja tem `replyToId`, `editedAt` e `deletedAt`; nada os usa.
- **O bloqueio nao esconde a pessoa nas outras telas.** Ele fecha a conversa,
  mas quem voce bloqueou continua aparecendo na lista de membros do servidor e
  nas mensagens antigas de canal. `loadBlockedBothWays` existe em
  `@aether/access` para filtrar isso quando for a hora; nada consome ainda.
- **Bloquear nao avisa quem foi bloqueado**, e isso e proposital. Mas a recusa
  de `dm:open` usa a mesma frase de quem so aceita amigos, entao da para
  deduzir tentando — nao e um segredo forte.
- **A chave e global, nao por servidor.** Nao da para aceitar mensagens de um
  servidor e recusar de outro.
- **`loadDmList` faz N consultas**, uma por conversa, porque passa cada uma pela
  mesma porta de `loadDmAccess` em vez de ter filtro proprio — lista que
  discorda do acesso e a forma mais silenciosa de a regra divergir. Na escala
  deste projeto sao dezenas; se um dia forem milhares, o jeito e resolver as
  duas portas em lote, nao afrouxar a checagem.

## Amizade a partir do servidor, e a chave que a governa

Botao "Adicionar amigo" no cartao do membro, dentro do servidor. Aparece SO
para quem ainda nao tem relacao com voce — nem amizade, nem pedido pendente,
nem bloqueio.

Esse calculo e feito NO SERVIDOR (`layout.tsx` monta `jaRelacionados`), e nao
no store do cliente. Quem sabe montar "pendente/aceito" e o banco, e uma copia
no navegador seria uma segunda versao da mesma consulta — a mesma razao pela
qual `friend:changed` so pede a tela nova em vez de dizer o que mudou.

`allowServerFriendRequests` e uma chave SEPARADA de `allowServerDms`, e nao a
mesma reaproveitada: sao decisoes diferentes. Da para querer receber pedido de
amizade e nao querer conversa direta de estranho, e o contrario tambem.

**Nao governa o caminho por nome de usuario exato.** Quem passou o proprio nome
para alguem ja decidiu ser encontravel por ali; a chave trata so de ser
abordavel por ter caido no mesmo servidor. A recusa diz isso e aponta o outro
caminho, em vez de sumir em silencio.

O SERVIDOR EM COMUM E CONFERIDO NO BANCO, nao pelo que a tela mandou. O cartao
so aparece para quem esta vendo a lista de membros, mas a action chega do
navegador — sem essa checagem, aceitar um id viraria exatamente o que o caminho
por nome evita: mandar pedido para qualquer conta sabendo so o id.

### Correcao que veio junto: bloqueio nao barrava pedido de amizade

Bloquear fechava a conversa mas NAO impedia a pessoa de mandar pedido de
amizade — e aceitar esse pedido reabriria tudo. Era um buraco deixado pela
propria funcionalidade de bloqueio. Agora `criarPedido` confere bloqueio nos
dois sentidos antes de qualquer coisa, e a recusa e generica: dizer "voce foi
bloqueado" avisaria a pessoa, e a decisao de bloquear nao precisa ser
anunciada.

## Confirmacao de acao destrutiva (`ConfirmDialog`)

Tres lugares ainda chamavam `window.confirm`: excluir canal, excluir categoria
e excluir cargo. No app de desktop aquilo abre a caixa NATIVA do Windows — com
a fonte do sistema, o titulo "@aether/desktop" e os botoes OK/Cancelar em
ingles. Alem do visual, ela mente sobre o que esta acontecendo: parece um aviso
do sistema operacional, e nao do aplicativo.

O projeto ja tinha decidido isso uma vez — `member-moderation-modal.tsx` carrega
o comentario "a confirmacao nao e `window.confirm`". Estes tres so ficaram para
tras, entao virou componente para nao haver uma quarta copia da decisao.

Duas escolhas dentro dele:

- **Cancelar primeiro, confirmar por ultimo.** Em caixa destrutiva, o botao que
  a pessoa alcanca por engano tem de ser o que nao apaga nada.
- **Vermelho SOLIDO no confirmar**, sobrescrevendo a variante `danger` do app.
  A `danger` normal e discreta de proposito, porque vive dentro de listas ao
  lado de outras acoes e gritar em toda linha cansaria. Aqui e o oposto: e a
  ultima confirmacao de algo que nao se desfaz, e a caixa existe so para ela.
  Sobrescrito no componente em vez de virar variante global — uma
  `danger-solid` convidaria a usar vermelho cheio onde nao cabe.

A troca pratica em relacao ao `confirm` nativo: ele e sincrono e trava a aba;
este e estado, entao quem chama guarda o que vai apagar. Um pouco mais de
codigo, e em troca a janela nao congela e o botao pode dizer "Excluindo..."
enquanto age.

## Contador de nao lidas no icone do servidor

Bolinha vermelha no canto superior direito do icone, no trilho, com quantas
mensagens nao lidas ha naquele servidor.

### O que precisou mudar no gateway

Ate aqui o cliente entrava em sala SO do servidor aberto — o `server:join` roda
pela rota. A consequencia e que mensagem de qualquer outro servidor nunca
chegava ao navegador: nao havia como acender contador nenhum, porque o app nem
ficava sabendo que algo aconteceu.

Agora, na CONEXAO, o socket entra nas salas de todos os servidores da pessoa
(`joinAllServerRooms`). **So as salas** — nao o resto do `server:join`. Aquele
tambem marca presenca e manda `voice:sync`; fazer isso para todos mudaria
comportamento (a pessoa apareceria "presente" em todos ao conectar) e mandaria
estado de voz que ninguem pediu.

**A permissao continua sendo a mesma:** `visibleChannelRooms` decide, igual ao
`server:join`. Canal privado que a pessoa nao ve nao vira sala, e portanto nao
vira notificacao — contador aceso por canal invisivel estaria contando o que a
pessoa nao pode saber que existe.

`message:new` passou a carregar `serverId` (`null` em conversa direta). O
cliente nao consegue descobrir isso sozinho: ele so conhece a arvore do
servidor aberto.

### O total e DERIVADO, nao um segundo contador

`useUnreadByServer` soma o `unread` que ja existia, usando um mapa
canal -> servidor aprendido das mensagens que chegam. Um contador proprio
precisaria ser decrementado a cada canal lido, e bastaria um caminho esquecer
para o numero do icone discordar da barra lateral — numero de notificacao que
nao zera e pior do que numero nenhum.

### Limitacoes

- **A conta e por SESSAO.** Recarregar zera, porque `unread` sempre viveu em
  memoria e nada disso e gravado. Para sobreviver ao restart seria preciso
  guardar "ultima mensagem lida" por canal no banco.
- **Nao ha notificacao do sistema nem som** — so o numero na tela.
- **Conversa direta nao entra em nenhum contador de servidor**, e ainda nao tem
  lugar proprio para aparecer (ver as limitacoes de DM).

## Abrir junto com o Windows

Chave em Configuracoes > Atividade > "Ao ligar o computador". So aparece no app
de desktop.

**Quem guarda a preferencia e o SISTEMA**, nao um arquivo nosso:
`app.getLoginItemSettings()` e a fonte da verdade, lida a cada vez. Manter copia
criaria o caso em que a caixa aparece marcada e o app nao abre — a pessoa pode
ter tirado o Aether da inicializacao pelo Gerenciador de Tarefas, e um valor
guardado continuaria dizendo que esta ligado.

Pelo mesmo motivo, o que a tela mostra e o que o sistema CONFIRMOU depois de
gravar, e nao o que a caixa marcou: o Windows pode recusar, e dizer "ligado"
enquanto o app nao abre no boot seria a pior forma de errar aqui.

`openAsHidden` fica falso: abrir escondido junto com o sistema e o tipo de coisa
que faz a pessoa achar que o app nao abriu. Se um dia houver icone na bandeja,
vale reconsiderar.

## Cartao do membro: um alvo so, em vez de dois

Clicar na pessoa abre TUDO: perfil, atividade, volume, silenciar, ensurdecer,
mover, mandar mensagem, adicionar amigo, bloquear.

### O que foi removido

O botao de tres pontinhos da lista de membros do canal de voz. Ele tinha 12x12
pixels, so aparecia no hover, e abria um menu SEPARADO do cartao — entao havia
duas coisas diferentes para a mesma pessoa, e a mais util era a mais dificil de
acertar. Foi a queixa mais repetida de quem usa.

O alvo passou de **12x12px** para **158x24px** — cerca de 25 vezes a area
clicavel, medido na tela.

### O que NAO mudou

O `VoiceMemberMenu` continua existindo, no BOTAO DIREITO dos blocos de video em
`voice-stage`. La ele nao concorre com nada nem depende de acertar um alvo
pequeno: o alvo e o bloco inteiro. Apagar o componente para "limpar" custaria
essa interacao sem devolver nada.

### O que aparece depende do estado, nao do cargo apenas

Volume, silenciar, ensurdecer e mover so aparecem quando a pessoa esta EM UMA
CALL — silenciar quem nao esta em canal de voz nao tem onde ser aplicado, e
mover exige ter de onde mover. Volume nao aparece para voce mesmo: regular o
proprio microfone ali nao quer dizer nada.

Esconder e so economia de clique: o servidor revalida cada acao em
`voice:moderate` e `voice:move`, como sempre.

## Reacoes de emoji

Passar o mouse numa mensagem revela o botao de reagir; clicar num emoji ja
existente alterna a sua.

### O modelo

`@@unique([messageId, userId, emoji])` — uma reacao por pessoa, por emoji, por
mensagem, garantido pelo BANCO. Sem ele, dois cliques rapidos ou dois aparelhos
da mesma pessoa criariam linhas repetidas e a contagem passaria a mentir sem
nada quebrar visivelmente.

Ele tambem torna o ALTERNAR correto sob concorrencia: em vez de "conferir e
decidir", o servidor tenta criar e le a colisao (`P2002`) como "ja existia,
entao remova". Uma checagem antes perderia a corrida de dois cliques
simultaneos.

O emoji e guardado como TEXTO, nao como id de catalogo nosso. Catalogo
envelhece — emoji novo entra no Unicode todo ano — e um id proprio obrigaria a
manter uma tabela de-para para sempre.

### A validacao que o campo exigia

`emoji` chega do CLIENTE. Sem filtro, "reagir" com um paragrafo, com HTML ou
com um caractere invisivel gravaria aquilo e mostraria na tela de todo mundo.

`emojiSchema` valida por PROPRIEDADE Unicode (`\p{Extended_Pictographic}`), e
nao por lista: lista recusaria os emojis novos ate alguem lembrar de
atualiza-la. Recusa tambem emoji com texto colado ("😀 clique aqui"), que e a
forma mais provavel de burlar. Coberto por `tests/unit/emoji.test.ts`, incluindo
os casos dificeis — sequencia ZWJ (`👨‍👩‍👧‍👦`) e tom de pele precisam PASSAR.

O teto de tamanho esta em dois lugares de proposito: no schema, para o caminho
normal, e num `CHECK` no banco, para qualquer outro que apareca.

### Autorizacao: ver e poder reagir

A regra e a da MENSAGEM, pela mesma `autorizarConversa` que envio e historico
usam — `VIEW_CHANNEL` basta. Deliberado: reagir e mais leve que escrever, e
exigir `SEND_MESSAGES` faria de um canal de anuncios um lugar onde ninguem pode
nem dizer "👍".

### O evento vai a lista INTEIRA, e personalizada

`reaction:update` manda todas as reacoes daquela mensagem, e nao o delta
("fulano somou 👍"). Delta exige o estado anterior certo para aplicar em cima, e
um evento perdido numa oscilacao de rede deixaria a contagem errada para
sempre. A lista inteira e idempotente.

E sai PERSONALIZADA por destinatario, porque `mine` depende de quem recebe —
mandar a mesma carga para a sala acenderia o botao de todo mundo quando uma
pessoa reagisse. Custa uma consulta por pessoa distinta; num canal com centenas
seria melhor mandar sem `mine` e deixar o cliente cruzar com o proprio id.

### O `emoji-mart` e a CSP

O `emoji-mart` busca o catalogo em `cdn.jsdelivr.net` quando nao recebe `data`,
e a CSP deste app so libera `'self'`, o gateway e o LiveKit. Com o padrao, o
seletor abriria VAZIO em producao e funcionaria no `npm run dev` — o pior jeito
de quebrar.

Os dados vao locais (423 KB, `import()` sob demanda: quem nunca abre o seletor
nao paga nada). **E o `i18n` tambem** — isso so apareceu na verificacao:
passar `data` sozinho nao basta, porque `locale: "pt"` faz ele buscar
`i18n/pt.json` no CDN do mesmo jeito. A CSP bloqueou, e ainda bem.

Nao usa `@emoji-mart/react`: o wrapper declara peer de React ate a 18 e este app
esta na 19. Instalar exigiria `--legacy-peer-deps`, que passa hoje e quebra num
`npm ci` futuro. O wrapper so monta o componente num `ref` — dez linhas de
`useEffect`.

### Limitacoes

- **Nao da para ver QUEM reagiu.** A lista de nomes nao viaja: numa mensagem
  com trinta reacoes seriam trinta usuarios completos por emoji a cada
  carregamento de historico, para desenhar um numero.
- **Sem emoji personalizado do servidor.** So os do Unicode.
- **Sem reacao em conversa direta pela tela** — o caminho do servidor funciona
  e o gateway trata os dois, mas a DM ainda nao foi verificada de ponta a ponta.

## CI (GitHub Actions)

`.github/workflows/ci.yml` roda a cada push no `master` e em todo PR: `npm ci`,
`prisma generate`, os dois typechecks e os 215 testes. Cerca de 68s.

**Por que existe.** Os testes rodavam so quando alguem lembrava. Isso vale para
qualquer teste, mas doi mais em um: `tests/unit/rate-limit-chave.test.ts` existe
para quebrar se `take(socket.id)` voltar ao gateway. Um guard que depende de
memoria humana nao e um guard.

Nenhum segredo entra no job. Os testes unitarios nao tocam banco; o
`prisma generate` so precisa da variavel DEFINIDA para ler o schema, e o valor
usado e falso.

### O que o CI NAO cobre

- **Os `verify-*.mjs`.** Sao integracao de verdade: precisam do Postgres com
  dados semeados, do gateway no ar, e no caso do `verify-seguranca.mjs` de duas
  conexoes simultaneas. Continuam sendo rodados a mao antes de subir.
- **O build do desktop.** O modulo nativo do som e C++ compilado contra os
  headers do Electron para Windows, e o runner e Linux.

### Duas coisas que a primeira rodada revelou

1. **O `engines` mentia.** Dizia `>=20.11`, e o job foi fixado nesse piso de
   proposito — rodar no minimo declarado pega uso acidental de API nova. So que
   o Vitest 4 importa `styleText` de `node:util`, que so existe a partir do
   20.12: o projeto nunca conseguiu rodar os proprios testes em 20.11. Piso que
   ninguem exercita vira ficcao. Agora o CI e o `engines` dizem `>=22`, que e o
   que o Dockerfile do gateway usa (`node:22-slim`) e o que a Vercel roda.

2. **`game-detect.js` e `picker.js` arrastam o Electron.** Os dois fazem
   `require("electron")` no TOPO do modulo, ainda que so usem `app.getFileIcon`
   la dentro — entao importar a logica pura de deteccao puxa o runtime junto, e
   o `index.js` do Electron lanca se o binario nao existir. Por isso o CI
   instala o Electron (com cache) mesmo nunca abrindo janela. Tornar esse
   require preguicoso deixaria a logica testavel sem o runtime; e mudanca em
   codigo de producao do desktop que nao da para verificar num runner Linux,
   entao ficou anotada, nao feita.

## Auditoria de seguranca (26/08/2026) — o que foi corrigido e o que ficou

Varredura de caixa-branca do gateway, das permissoes, do convite e dos
cabecalhos. Cinco achados foram corrigidos; o que sobrou esta listado como
limitacao logo abaixo, porque tem custo real e nao dava para resolver junto.

### Corrigido

1. **Rate limit do chat era contornavel abrindo mais sockets.** `messages.ts`
   chaveava o balde por `socket.id`, e nada limita quantas conexoes uma pessoa
   abre com o mesmo cookie — cada socket novo estreava com o balde cheio. Pior:
   `forget()` no disconnect fazia de reconectar um jeito de zerar o limite. A
   chave agora e o `userId` e nao ha `forget` no disconnect; o limitador
   descarta sozinho as chaves cheias e paradas. `tests/unit/rate-limit-chave.test.ts`
   e uma guarda de fonte que quebra se alguem reintroduzir `take(socket.id)`.

2. **`voice:join`, `presence:game`, `presence:set` e `server:join` nao tinham
   limite nenhum.** `voice:join` e o evento mais caro do gateway — tres idas ao
   Postgres e a EMISSAO DE UM TOKEN do SFU a cada chamada — e `presence:game`
   amplifica: uma mensagem que entra vira uma emissao por amigo e por servidor
   em comum. Os quatro passaram a ter balde proprio, checado antes de tocar no
   banco.

3. **Corrida no `maxUses` do convite.** A checagem lia fora da transacao e o
   incremento nao reconferia: duas pessoas resgatando ao mesmo tempo um convite
   de uso unico liam `uses = 0` as duas e entravam as duas. O consumo virou um
   `UPDATE ... WHERE uses < maxUses` feito ANTES de criar o membro, o que faz a
   linha do convite ser o ponto de serializacao da transacao inteira.
   `scripts/verify-seguranca.mjs` prova nos dois sentidos: reproduz o bug com o
   codigo antigo (`uses = 2` num convite de 1) e mostra o novo deixando so um
   passar.

4. **Token do LiveKit valia 6 horas**, com um comentario no codigo que dizia
   "curto de proposito". Nao era. E o SDK manda o token na QUERY STRING da URL
   do websocket, entao ele fica no log de rede do navegador de quem transmite.
   Caiu para 1h — ver a limitacao sobre isso abaixo.

5. **Nao havia Content-Security-Policy.** Os quatro cabecalhos que ja existiam
   cobrem sniffing, enquadramento e referer; nenhum diz PARA ONDE a pagina pode
   falar. Agora ha uma. A origem do gateway sai de `NEXT_PUBLIC_REALTIME_URL`,
   e faltar essa variavel em build de producao e ERRO DE BUILD: politica com
   origem faltando nao avisa nada, so bloqueia o websocket no navegador de quem
   usa. O LiveKit entra por curinga (`*.livekit.cloud`) porque `LIVEKIT_URL`
   nao existe na Vercel e nem deve existir — quem emite o token do SFU e o
   gateway no Fly. Ver a limitacao sobre isso abaixo.

### O que a auditoria NAO encontrou (verificado, nao suposto)

- Toda escrita revalida permissao no evento, direto do banco — `authorizeChannel`
  nao confia em nada guardado no socket desde o handshake.
- Escalada de cargo esta barrada na construcao: `desired = (bits mantidos) |
  (bits adicionados & permissoes de quem edita)`. Nao ha caminho para conceder
  bit que voce nao tem.
- Nao existe `dangerouslySetInnerHTML` em lugar nenhum do app.
- Nao existe preview de link, embed nem webhook — a superficie classica de SSRF
  simplesmente nao esta construida.
- Upload confere bytes magicos alem do MIME declarado, e o unico bucket publico
  guarda icone de servidor, que e publico por natureza.
- Senha e scrypt; token de recuperacao e guardado como hash e vale uma vez.
- Cookie de sessao e httpOnly + sameSite lax + secure em producao; o gateway em
  outro dominio usa ticket JWT de 5 min, consumido uma unica vez via Redis, e
  fail-closed quando o Redis nao responde.
- `/internal/*` do gateway compara o segredo em tempo constante.
- `NEXT_PUBLIC_*` tem exatamente duas variaveis, as duas URLs publicas.

### Limitacoes que ficaram

- **`'unsafe-inline'` em `script-src`.** O App Router injeta script inline com
  os dados de hidratacao em toda pagina; tirar isso exige nonce via middleware,
  e nonce forca renderizacao dinamica em TODA rota. Entao, na pratica, o CSP
  **nao protege contra XSS de script** hoje — o que protege e o React escapar
  por padrao e nao haver `dangerouslySetInnerHTML` no app. O que o CSP entrega
  mesmo assim e a exfiltracao fechada (`connect-src`), `base-uri`, `form-action`
  e `object-src`.

- **O token do SFU ainda vale 1h, e nao 5 minutos.** O SDK do LiveKit
  reapresenta o MESMO token ao reconectar e o cliente nao implementa refresh;
  com TTL de minutos, qualquer oscilacao de rede no meio de uma call derrubaria
  a pessoa de vez. Para descer mais e preciso reemitir pelo gateway em
  `RoomEvent.Disconnected`. Ate la, um token vazado da 1h de acesso aquela sala
  de voz com os grants de publicacao de quem o gerou.

- **A CSP libera `*.livekit.cloud`, nao so o nosso projeto.** A alternativa
  era duplicar `LIVEKIT_URL` na Vercel so para montar o cabecalho — duas
  copias de uma configuracao que precisa bater, e que ao divergir mataria a
  call em producao calada. O curinga e um canal de exfiltracao ruim (exigiria
  controlar um projeto LiveKit e escrever dados por handshake de sala), entao a
  troca compensa. Se um dia o app web precisar da URL por outro motivo, da para
  fechar o curinga.

- **Os limites do gateway vivem no processo.** Sao `Map` em memoria: com uma
  instancia funcionam, com duas cada uma tem o seu e o limite efetivo dobra. O
  ticket ja usa Redis; estes ainda nao. Mesma limitacao ja anotada na FASE 7c-1.

- **Nao ha teto de sockets por usuario.** A troca de chave tirou o ganho de
  abrir varias conexoes para furar rate limit, mas abrir mil conexoes ainda
  consome memoria e handshake do gateway. Um teto por `userId` no
  `connection` resolveria; nao foi feito nesta rodada.

- **`AUTH_SECRET` faz dois trabalhos**: assina a sessao e autentica o
  `/internal/*` do gateway. Foi decisao consciente (uma variavel a menos para
  configurar errado), mas significa que vazar o segredo interno tambem vaza a
  capacidade de forjar sessao. Separar em duas variaveis e melhoria pendente.

- **A auditoria nao cobriu o app de desktop a fundo.** O que foi verificado
  ali: o `.env` nao vai no pacote e o renderer nao recebe segredo. Ficaram sem
  varredura o auto-updater (assinatura do pacote) e o IPC do modulo nativo.

## Limitacoes conhecidas da FASE 7c-1 (rate limit distribuido e ticket)

Pronto: o rate limit do app web e o consumo unico de ticket do gateway agora
funcionam com Redis quando `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`
estao definidos, e caem para memoria quando nao estao — do mesmo jeito que o
LiveKit e opcional no gateway desde a fase 4.

Uma correcao ao levantamento da fase 7a: eu havia listado o **rate limit do
gateway** como divida de Redis. Nao e. Ele e chaveado por `socket.id`, e um
socket vive em exatamente uma instancia — o balde ja e naturalmente local e
continua correto com N maquinas. Distribuir seria trabalho sem efeito.

Por que HTTP (REST do Upstash) e nao um cliente Redis: o app web roda em
funcoes SERVERLESS. Conexao TCP persistente ali estoura o pool a cada cold
start. A API REST e stateless. Nenhuma dependencia nova entrou — a chamada e
por `fetch`, mesmo estilo do `storage.ts` e do `realtime-notify.ts`.

Os dois usam script Lua, e nao sequencia de comandos, porque as duas operacoes
precisam ser ATOMICAS: com comandos separados, duas requisicoes concorrentes
leem o mesmo estado antes de qualquer uma escrever — a corrida exata que um
limite de tentativas e um consumo unico existem para impedir.

- **As duas falhas tem politicas OPOSTAS, de proposito.** Rate limit com Redis
  fora do ar **libera** (fail-open): e defesa em profundidade, e derrubar o
  login inteiro por causa de um cache seria pior que o risco. Consumo de
  ticket **recusa** (fail-closed): responder "acho que nao foi usado" abriria
  a janela de replay que o mecanismo existe para fechar, e o custo de recusar
  e so uma reconexao.
- **Sem as variaveis, o furo da fase 1 continua aberto em producao.** O codigo
  esta pronto, mas ate o Upstash ser provisionado e as variaveis subirem, a
  Vercel segue com contador por instancia — ou seja, quase nenhuma protecao
  contra forca bruta no login.
- **A semantica da janela deslizante no Redis nao e testada de verdade.** Os
  doze testes de `rate-limit-redis.test.ts` dublam o `fetch` e cobrem o
  CONTRATO (um EVAL atomico, prefixo de chave, autenticacao, e as tres formas
  de falha). O algoritmo em si e testado contra a implementacao em memoria,
  que espelha a mesma regra. Um duble que interpretasse Lua estaria testando o
  duble.
- **`rateLimit()` virou assincrona.** Os cinco pontos de chamada ganharam
  `await`. O custo de uma ida ao Redis por tentativa de login e irrelevante
  perto do scrypt que vem logo depois.
- **Presenca, ocupacao de voz e o adapter do Socket.IO continuam em memoria.**
  E a 7c-2, e e a parte que de fato destrava a segunda maquina de gateway. O
  `fly.toml` segue com `min_machines_running = 1` por isso.
- **Nada disso foi exercitado contra um Redis real ainda** — nao ha instancia
  provisionada. O caminho sem Redis (o de hoje) esta coberto pelos testes e
  pela regressao de integracao.

## Limitacoes conhecidas da FASE 7b (revalidacao de sessao e recalculo de salas)

Pronto: o gateway revalida periodicamente (30s) a linha `Session` de cada
socket aberto e derruba quem foi deslogado, revogado ou expirou — antes disso
o handshake conferia sessao uma unica vez e valia para sempre. E uma segunda
rota interna, `/internal/resync-rooms`, que recalcula as salas de canal de
todo mundo presente num servidor sem tirar ninguem dele; ligada em
`updateRoleAction`, `deleteRoleAction`, `assignRoleAction`,
`unassignRoleAction`, `createChannelAction`, `updateChannelAction` e
`setChannelAccessAction` — tudo que muda o que alguem PODE VER sem mudar se
ele CONTINUA membro. `leaveServerAction` ganhou o `evictFromGateway` que ja
existia para kick/ban e nunca tinha sido ligado nela — sair do servidor tinha
exatamente o mesmo furo que expulsar tinha antes da fase 6b.

- **30s de janela para a revalidacao de sessao.** Quem faz logout continua
  com o socket funcional por ate meio minuto. Escolhido de proposito: mais
  apertado martelaria o Postgres por uma consulta que, no dia a dia, quase
  nunca teria o que fazer.
- **Recalculo de salas e server-wide, nao por usuario.** Mudar um cargo
  resincroniza TODO MUNDO presente no servidor, nao so quem tem aquele cargo.
  Mais simples e mais barato do que rastrear, em cada ponto de chamada, quem
  o cargo ou o overwrite alcança — o custo e uma consulta a mais por pessoa
  conectada, que so acontece quando um admin mexe em cargo ou canal.
- **A mudanca de leitura continua silenciosa para quem perde acesso.** Tirar
  VIEW_CHANNEL de alguem para de entregar o canal pelo socket na hora, mas a
  arvore de canais que a interface mostra (renderizada pelo layout do Next,
  nao pelo socket) so atualiza no proximo refresh ou navegacao — mesma
  limitacao de "leitura pode ficar velha" que a fase 3 ja documentava, agora
  com o buraco de seguranca fechado e so a tela sobrando desatualizada.
- **`createRoleAction` nao resincroniza.** Cargo recem-criado nasce com as
  mesmas permissoes de um membro comum e ainda nao foi atribuido a ninguem —
  nao ha o que recalcular no momento em que ele nasce.
- **`moveChannelAction`, `deleteChannelAction`, `deleteCategoryAction`,
  `renameCategoryAction` e `createCategoryAction` tambem nao resincronizam**,
  de proposito: nenhum deles muda quem enxerga o que. Excluir canal deixa uma
  sala vazia e inerte no adapter do Socket.IO ate o socket cair — sem risco,
  so memoria residual insignificante.
- **Se o gateway estiver fora do ar, a acao no banco vale mesmo assim** — a
  mesma filosofia do `evictFromGateway` desde a fase 6: quem foi afetado
  sente o efeito ao reconectar, e nao vale a pena travar uma acao ja
  concluida esperando o gateway responder.
- **Sem teste para os pontos de chamada dentro das Server Actions.** O novo
  `scripts/verify-phase7b.mjs` testa a rota interna do gateway direto (como o
  verify-phase6 ja fazia para `/internal/evict`), nao as Server Actions que a
  chamam — elas nao se chamam de fora do navegador.

## Limitacoes conhecidas da FASE 7a (testes unitarios)

Pronto: Vitest na raiz, 77 testes em 7 arquivos, sem dependencia de servico no
ar. A suite ja pagou o custo dela: encontrou um caminho em que
`verifyPassword()` aceitava QUALQUER senha quando o hash guardado tinha salt e
hash vazios (`scrypt$16384$8$1$$`) — o scrypt derivava um buffer de comprimento
zero e `timingSafeEqual` de dois buffers vazios e verdadeiro. Nao era alcancavel
pelo fluxo normal, porque `hashPassword()` sempre gera 16 bytes de salt e 64 de
hash; passava a ser com um registro truncado, um seed errado ou um futuro
usuario sem senha. Corrigido.

- **E suite unitaria, e so isso.** Nao toca banco, HTTP, WebSocket nem
  interface. Cobertura de ponta a ponta continua sendo dos `verify-phase*.mjs`,
  que seguem sendo rodados a mao.
- **`canActOnUser` roda com o Prisma dublado.** Os testes cobrem o RAMO DE
  DECISAO da hierarquia (dono intocavel, dono age sobre todos, os demais so
  sobre cargo estritamente abaixo), nao a consulta em si. Se o `include` dos
  cargos mudar de forma, o teste continua verde e quem pega e o verify-phase2.
- **Handlers do gateway e server actions nao tem teste unitario.** Os dois
  dependem de socket e de request reais; testa-los exigiria dublar Socket.IO ou
  o runtime do Next, e um duble desses e mais codigo de mentira do que de
  verdade. Ficou de fora por decisao, nao por esquecimento.
- **`clientKey()` nao e testavel** fora do escopo de request do Next. O stub de
  `next/headers` lanca erro se alguem tentar, para a lacuna nao virar teste
  falso-verde.
- **Sem medicao de cobertura.** Nenhum relatorio configurado; o que existe foi
  escolhido a dedo, nao guiado por percentual.
- **A suite ainda nao roda em CI** — isso e a fase 7e. Hoje depende de alguem
  lembrar de rodar `npm test`.
- **O contrato do rate limit esta testado, a protecao continua furada.** Os
  testes fixam o comportamento do algoritmo em memoria; em producao, na Vercel,
  cada instancia serverless tem o proprio contador, entao o bloqueio de forca
  bruta no login vale muito menos do que a fase 1 documentou. Fecha na 7c.
- **Com aba do app aberta, a fase 3 roda com 40 de 42 assercoes.** As duas de
  presenca ("ficar online", "fechar a ULTIMA aba") sao puladas e nomeadas. Os
  scripts 4, 5 e 6 apenas avisam: neles nenhuma assercao quebra
  comprovadamente por conexao alheia, mas 4 e 5 contam ocupacao de voz e 6
  conta sockets despejados, entao o aviso existe para o dia em que o resultado
  parecer estranho.
- **`fechar UMA aba nao marca o usuario como offline` fica vacuo** quando ha
  cliente alheio conectado: e uma assercao negativa, e nesse cenario ela nao
  teria como falhar. Continua rodando porque passa pelo mesmo caminho, mas nao
  prova nada ali.

## Limitacoes conhecidas da FASE 6

Pronto: expulsar, banir com motivo e duracao, revogar banimento, o despejo em
tempo real que isso exigia, a tela do log de auditoria, e a moderacao de voz
(silenciar, ensurdecer e mover entre canais).

- **O despejo depende do gateway estar no ar.** Se ele nao responder, a
  expulsao vale no banco (que e a fonte de verdade) mas o socket da pessoa so
  cai quando ela recarregar. Preferimos degradar assim a desfazer uma acao de
  moderacao ja concluida.
- **Banimento vencido nao e apagado por rotina.** Ele sai da lista de ativos
  pela consulta e continua na tabela como historico; nao ha processo de
  limpeza rodando.
- **Silenciar e imposto no SFU; ensurdecer nao.** O mudo do servidor desliga a
  faixa de audio na propria infraestrutura, entao um cliente reescrito nao
  contorna. Ja o ensurdecer e aplicado no navegador de quem foi ensurdecido:
  nao ha como o SFU impedir alguem de OUVIR sem tambem cortar o video que ele
  recebe. Quem reescrever o proprio cliente ainda consegue ouvir.
- **Moderar exige que a pessoa esteja em um canal de voz.** O estado vive na
  memoria do gateway, entao nao ha como pre-silenciar quem esta offline, e a
  moderacao se perde se o gateway reiniciar.
- **Mover ignora o limite do canal**, de proposito: moderador colocando alguem
  num canal cheio e caso legitimo.
- **O log nao tem filtro nem busca.** E uma lista cronologica com "carregar
  mais"; achar um evento antigo especifico exige rolar.
- **Acao sem descritor aparece com o nome cru** (ex.: `member.mute`), em vez de
  virar frase. Some quando o bloco 6b registrar esses eventos.
- **Excluir mensagem de terceiro** (`MANAGE_MESSAGES`) ainda nao existe.
- **Sair do servidor** continua sem botao, apesar de a action existir desde a
  fase 2.

---

## Limitacoes conhecidas da FASE 5

Compartilhamento de tela publicado pelo SFU, com destaque, miniaturas, tela
cheia e picture-in-picture.

- **Qualidade nao tem trava artificial.** Sao tres perfis (Leitura, Equilibrado,
  Movimento) que mudam resolucao, quadros e sobretudo o `contentHint` — que
  decide o que sacrificar quando a banda aperta: nitidez ou fluidez. O teto real
  e o seu upload, a CPU e o plano do SFU.
- **Audio do sistema depende da superficie escolhida e da chave no seletor.**
  No Windows o navegador oferece "compartilhar tambem o audio do sistema" para
  ABA e TELA INTEIRA, mas nao para uma janela avulsa. Sem audio, o video vai
  sozinho — nao e erro, e um aviso.

  **`getDisplayMedia` e TUDO-OU-NADA com audio.** Nao existe "som se der, mas
  nao falhe": quando o sistema recusa abrir a captura de som ("Could not start
  audio source" — outro programa segurando o audio em modo exclusivo, driver,
  ou o proprio navegador), o pedido INTEIRO falha, video junto.

  Ate 22/08/2026 o codigo lidava com isso tentando de novo sem audio, o que
  REABRIA o seletor nativo do Chrome (agora sem a opcao de som). Corrigido em
  duas partes:

  1. A escolha "levar o som do sistema" agora e uma chave no menu de
     compartilhar, decidida ANTES do seletor abrir. Quando o sistema recusa o
     som, ela e desligada e LEMBRADA — a proxima tentativa ja sai sem som e
     funciona de primeira, sem seletor repetido.
  2. A captura acontece UMA vez. O video e publicado primeiro e o audio e
     melhor-esforco: perder o som nunca derruba a transmissao, que era o que
     acontecia antes.

  Consequencia aceita: quem tem o som bloqueado pelo sistema descobre na
  primeira tentativa, com uma mensagem explicando, e precisa clicar de novo.
  Preferimos isso a um segundo seletor aparecendo sem aviso.

  **Ha maquinas onde o som da TELA simplesmente nao funciona, e nao ha o que
  o app faca.** Verificado em 22/08/2026 num Windows com Brave: a chamada CRUA
  `navigator.mediaDevices.getDisplayMedia({video:true, audio:true})`, sem uma
  linha de codigo nosso no caminho, falha com
  `NotReadableError / Could not start audio source`. O loopback de audio do
  sistema depende de WASAPI, driver e navegador — nada disso passa por aqui.

  O caminho que funciona nessas maquinas e compartilhar uma ABA do navegador:
  captura de aba usa outro mecanismo de audio, independente do loopback do
  sistema. A mensagem de erro aponta para isso.

  Diagnostico util quando alguem reclamar: peca para rodar a chamada crua no
  console. Se ela falhar, o problema esta fora do app e nenhuma mudanca de
  codigo resolve.
- **Sem controle de volume por transmissao.** O audio da tela toca junto com o
  resto da sala.
- **Nao ha limite de quantas pessoas transmitem ao mesmo tempo.** O grid
  aguenta, a banda de quem assiste talvez nao.
- **Trocar de canal encerra a transmissao** — a faixa pertence a sala anterior.
- **Sem gravacao** e sem historico de quem transmitiu (fase 6, junto do log).

---

## Limitacoes conhecidas da FASE 4

Audio confirmado funcionando entre dois clientes: entrar, falar, ouvir, mutar,
ensurdecer e sair.

- **So funciona em localhost por enquanto.** O LiveKit Cloud faz o relay da
  midia, mas o app (Next e gateway) roda na sua maquina. Usar com outras
  pessoas exige deploy — e a fase 7.
- **Sem seletor de dispositivo.** Usa o microfone padrao do sistema; trocar de
  entrada ou de saida exige mexer no sistema operacional.
- **Sem volume por usuario** e sem mute administrativo — o `serverMuted` do
  `VoiceState` existe e e sempre falso.
- **Sem indicador de qualidade de conexao** (ping, perda de pacote).
- **Compartilhamento de tela ainda nao existe**, mas o token ja autoriza a
  fonte `screen_share` para quem tem a permissao. E a fase 5.
- **Reconexao do SFU nao foi exercitada** em queda real de rede; o LiveKit
  reconecta sozinho, mas isso nao foi testado aqui.
- **Uma sala por canal, uma instancia de gateway.** A conta do LiveKit Cloud
  tem limites de banda; video consome bem mais que voz.

---

## Limitacoes conhecidas da FASE 3

Pronto: gateway autenticado, presenca em tempo real, **chat de texto** e
**ocupacao de canal de voz** (quem entrou aparece sob o canal, para todos).

- **Ninguem ouve ninguem.** A voz da fase 3 e ocupacao e sinalizacao: entrar,
  sair, mutar, ensurdecer, e o indicador de quem esta falando. Nao existe
  WebRTC, nao existe transporte de audio, ninguem escuta ninguem — isso e a
  fase 4.
- **O microfone e aberto, mas so localmente.** Para acender a bordinha de "esta
  falando" o navegador precisa ouvir voce, entao ele pede permissao de
  microfone ao entrar numa call. O sinal e analisado na sua maquina
  (`AnalyserNode`, energia RMS) e o que sai pelo socket e **um booleano**. O
  audio nao e transmitido, nem gravado, nem guardado. Negar a permissao nao
  quebra nada: a call continua, so a bordinha nao acende.
- **Editar e excluir mensagem nao existem.** O modelo tem `editedAt` e
  `deletedAt`, o historico ja respeita o soft delete, mas nao ha evento de
  socket nem interface. Ficou fora deste bloco por decisao de escopo.
- **Canal temporario ainda nao some ao esvaziar.** O gateway ja sabe quando o
  ultimo saiu; falta o evento que atualiza a arvore de canais no cliente.
- **Aviso sonoro de entrada e saida de call** e sintetizado no navegador
  (osciladores Web Audio), nao e arquivo de audio. Nao existe controle de
  volume nem opcao de desligar alem de ficar ensurdecido.
- **Sem indicador de nao-lido.** O socket ja recebe mensagens de todos os
  canais visiveis, entao o dado existe — falta contar e mostrar.
- **Sem "esta digitando".**
- **Mensagem que falha nao tem botao de reenviar** — ela fica marcada com o
  erro, e reenviar significa copiar e colar.
- **Presenca e voz vivem na memoria do gateway.** Reiniciar o processo zera
  quem esta online e quem esta em call ate os clientes reconectarem. E de
  proposito: esses dados sao efemeros. O `User.status` do banco guarda so a
  PREFERENCIA (a pessoa escolheu DND), nao quem esta conectado.
- **Uma instancia so.** O estado em memoria nao e compartilhado entre
  processos; escalar horizontalmente exige o adapter de Redis do Socket.IO.
  Mesma conversa do rate limit.
- **Sala nao se recalcula sozinha.** Se um cargo mudar enquanto voce esta
  conectado, as salas em que o socket ja esta continuam como estavam ate
  reconectar ou trocar de servidor. Escrita permanece protegida (revalida
  sempre, a cada mensagem); o que pode ficar velho e a leitura. Correcao
  prevista para a fase 7, junto com a revalidacao de sessao em conexao aberta.
- **Ainda nao existe seletor de status na interface.** O evento
  `presence:set` funciona e persiste, mas nenhum botao o dispara.

---

## Limitacoes conhecidas da FASE 2

- **Reordenar canal e por setas**, nao arrastar e soltar. A coluna `position`
  ja suporta DnD; so muda a forma de calcular o destino.
- **Reordenar cargos ainda nao existe** na interface. A hierarquia funciona
  (position), mas so muda quando um cargo e criado.
- **Canal temporario** guarda a flag e mostra o selo `tmp`, mas so sera
  removido ao esvaziar na fase 3 — quem sabe se um canal esvaziou e o gateway.
- **Overwrite por membro** existe no banco e no calculo de permissoes, mas a
  interface so expoe overwrite por cargo.
- **Sem realtime**: dois navegadores abertos nao veem a mudanca um do outro sem
  recarregar. Isso e exatamente o que a fase 3 resolve.
- **Excluir canal e definitivo** e a confirmacao e um `window.confirm`.

---

## Limitacoes conhecidas da FASE 1

- **Presenca e sempre OFFLINE.** O campo existe no banco, mas quem atualiza e o
  gateway da fase 3.
- **Botoes de microfone/audio** guardam apenas preferencia local; nao abrem
  dispositivo nenhum. Nao existe audio simulado em lugar algum do codigo.
- **Compartilhamento de tela** esta desabilitado (fase 5).
- ~~Canais e cargos sem CRUD~~ — resolvido na fase 2.
- **Rate limit em memoria**: funciona com uma instancia. Ao escalar
  horizontalmente precisa migrar para Redis (a interface ja isola isso).
- ~~Upload de icone de servidor~~ — resolvido (ver secao propria abaixo).
- **Upload de avatar de usuario** ainda nao existe; o campo esta no banco e a
  UI cai no avatar gerado por iniciais.
- **Sem testes automatizados** ainda (fase 7).
