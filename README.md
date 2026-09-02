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
| 7 | Performance, reconexao, seguranca, testes, deploy | em andamento (7a, 7b, 7c-1, 7c-2, 7d prontos) |

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

## Redesign visual (OpenDesign) — em andamento

O OpenDesign gerou uma releitura visual do AETHER como HTML/CSS/SVG isolados
(pasta `design-redesign/`, fora do repo). A migracao para a arquitetura real
e feita em estagios, cada um com regressao verde:

| Estagio | O que muda | Estado |
| --- | --- | --- |
| 1 | Tokens em `globals.css`: accent **AETHER Blue `#2f88ff`** (era blurple), `--color-signal-isolate`, rampa de superficies, raios `5/8/11/15`, motion, `--glow-speak` | ✅ |
| 2 | `components/ui/aether-icon.tsx` — sprite de icones do OpenDesign (`<AetherIcon>` + `<AetherIconSprite>`), montado em `app/app/layout.tsx` | ✅ |
| 3 | Area de voz: cards de participante (`voice-stage.tsx`), dock (`control-bar.tsx`), faixa de conexao, **botao de supressao de ruido ao vivo**, faixa de teste de microfone | ✅ |
| 4 | Shell (trilho, sidebar, membros, banner) migrado para `AetherIcon` | ✅ |
| 5 | `components/aether-v2/` REMOVIDO (codigo morto); `microphone-test.tsx` movido para `voice/` | ✅ |

### Limitacoes conhecidas do redesign

- **Icones lucide fora da area de voz.** Chat, premium, `server-settings`,
  `friends`, `auth` e as abas do `app-settings-modal` seguem em `lucide-react`.
  A migracao da cauda longa (~30 arquivos) e um PR proprio. O app roda com as
  duas familias ao mesmo tempo sem conflito.
- **Botao de ruido do dock so expoe o RNNoise (on/off).** As tres chaves
  nativas do navegador (cancelamento de eco, ganho automatico, supressao
  nativa) seguem so em Configuracoes: muda-las exige re-publicar a faixa de
  microfone no meio da call, o que o botao rapido nao faz.
- **Faixa de teste de microfone e v1.** Aciona/para e mostra o medidor; nao
  tem selecao de dispositivo inline (isso fica em Configuracoes). O audio NAO
  e transmitido — `mic-level.ts` abre um stream local proprio.
- **Glow de fala nao acompanha o RMS por participante.** Respira pela animacao
  `aether-breathe`; ligar `--vl` ao nivel real de cada remoto exigiria o
  detector expor volume por participante (hoje so expoe `speaking` booleano).
- **Painel de membros: grupo "Na chamada" nao implementado.** O redesign abre
  a lista com "Na chamada — N"; o painel segue agrupando por cargo. Adicionar
  o grupo derivado e trabalho de um proximo estagio.
- **Sem verificacao E2E local nesta entrega.** `typecheck`, `vitest` (364) e
  `next build` passam; os `verify-phase*.mjs` e o teste manual da call (mute,
  camera, tela, teste de mic, ruido, 2+ participantes) precisam de banco +
  gateway + LiveKit e ficam para o ambiente do time.

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

### Reconexao depois do notebook dormir (tela preta/cinza)

O SINTOMA RELATADO: com o Aether e o Discord abertos ao mesmo tempo, depois
de o notebook dormir e acordar (ou a rede cair por um tempo), o Discord se
reconectava sozinho; o Aether ficava com a tela preta ou cinza, sem se
recuperar.

O socket do tempo real JA tenta se reconectar sozinho
(`reconnectionAttempts: Infinity`, em `realtime-provider.tsx`) — o problema
nao e falta de dado chegando de volta. A explicacao mais provavel e um bug
conhecido do Chromium/Electron: o compositor de GPU nao volta a desenhar
sozinho depois que o sistema suspende o processo. A tela fica presa no
ULTIMO QUADRO desenhado antes de dormir, e nada no app pedia um redesenho.

O CONSERTO, em `apps/desktop/src/main.js`: o processo principal escuta
`powerMonitor.on("resume", ...)` (o sistema acordou) e
`webContents.on("render-process-gone", ...)` (o renderer morreu de verdade —
falta de memoria, driver de GPU) e, nos dois casos, espera a ORIGEM
(`aether-mocha-phi.vercel.app`) responder a um `HEAD` antes de recarregar a
janela — nunca recarrega direto: acordar do standby nao significa que o
Wi-Fi ja reconectou, e recarregar contra uma rede ainda fora do ar trocaria a
tela preta por uma tela de erro do Chromium, que e pior porque nao sai
sozinha quando a rede volta. Ate 10 tentativas, a cada 3s.

- **NAO E UMA CAUSA CONFIRMADA linha a linha.** E o reparo padrao para esse
  sintoma exato em apps Electron, registrado como tal em vez de apresentado
  como certeza — o defeito nao foi reproduzido nesta maquina para confirmar
  que a causa e mesmo o compositor de GPU e nao outra coisa.
- **Sem log de campo ainda.** `registrar()` (`apps/desktop/src/log.js`) grava
  cada tentativa e o desfecho em `aether.log`, na pasta de dados do app — a
  proxima vez que o sintoma aparecer, esse arquivo diz se o reparo disparou e
  o que aconteceu.
- **Nao verificado em maquina real** dormindo e acordando com o app aberto —
  so checado sintaticamente (`node --check`) e por leitura.

#### O log de campo chegou, e o sintoma era o REPARO disparando demais

Uso real relatou: depois desta atualizacao, o app passou a "cair toda hora" —
tanto apontando para producao quanto para localhost. Como as duas pontas
mudam so o SERVIDOR, e o sintoma se repetia nas duas, a causa nao podia estar
do lado do backend: so sobrava o processo principal do Electron, o mesmo em
qualquer endereco.

**Suspeito principal: `powerMonitor.on("resume")` disparando sem o notebook
dormir de verdade.** E um comportamento conhecido do Windows com *Modern
Standby* (energia baixa "conectada"): o sistema faz transicoes de suspensao e
volta o tempo todo, inclusive com a tampa aberta e a tela acesa, e o
`powerMonitor` do Electron acompanha essas transicoes — nao so o sono de
verdade. Sem cooldown nenhum, CADA disparo desses virava um `reload()`
completo: a conexao caia, quem estava numa call saia dela, e a experiencia
era "o app cai toda hora" — em qualquer servidor, porque a causa vive no
cliente.

**O CONSERTO: um cooldown de 2 minutos entre recargas** (`COOLDOWN_MS` em
`main.js`). Um disparo de `resume` ou `render-process-gone` que chega antes
do cooldown acabar e IGNORADO (e registrado como
`reconexao:ignorada-cooldown`, com o tempo desde a ultima recarga) em vez de
recarregar de novo. Sono de verdade nao se repete a cada poucos minutos, entao
a primeira tentativa continua cobrindo o caso original; a sequencia de
disparos falsos do Modern Standby e que para de virar uma sequencia de
recargas.

- **TAMBEM NAO E CAUSA CONFIRMADA linha a linha** — mesma ressalva do reparo
  original. E o ajuste padrao para esse tipo de disparo espurio relatado em
  hardware Windows, nao uma causa provada neste caso especifico.
- **Nao filtra por CORRELACAO com um `suspend` real.** O Electron tambem
  emite `powerMonitor.on("suspend")`; dava para exigir que um `resume` so
  contasse se um `suspend` tivesse acontecido pouco antes. Nao fizemos: o
  proprio Modern Standby dispara os DOIS em pares espurios, entao essa
  correlacao nao filtraria o problema — so o cooldown, que e independente da
  causa exata do lado do Windows, resolve.
- **2 minutos e um numero escolhido, nao medido.** Sem o `aether.log` de
  quem relatou o sintoma (as linhas `reconexao:tentando` mostrariam o
  intervalo real entre disparos), nao ha como saber se o valor certo e maior
  ou menor — alto o bastante para cobrir a chatice do Modern Standby, baixo o
  bastante para nao atrasar a recuperacao de um sono de verdade.
- **Ainda nao verificado na maquina que relatou o sintoma.** So checado
  sintaticamente (`node --check`) e por leitura, como o reparo original.

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
- **A versao do Electron esta FIXA** (`44.0.0`, sem `^`) em
  `apps/desktop/package.json`. Com workspaces o binario fica na raiz, e o
  electron-builder so descobre a versao se ela estiver fixa ali. A entrada
  correspondente no `allowScripts` da raiz (`electron@44.0.0`) precisa
  acompanhar essa versao: com o par errado o npm bloqueia o postinstall do
  Electron e o binario nunca baixa — os testes que carregam `apps/desktop`
  falham com "Electron failed to install correctly".
- **`electron-winstaller` esta NEGADO no `allowScripts` da raiz** (`false`, e
  nao ausente). Ele chega como peer transitivo do
  `electron-builder-squirrel-windows`; o build aqui e `nsis`, entao o Squirrel
  nunca roda e o script de instalacao dele tambem nao precisa. `false` registra
  a decisao e cala o aviso do `npm ci` — apagar a linha traz o aviso de volta.
- **`overrides` na raiz forcam `postcss ^8.5.26` e `sharp ^0.35.4`.** O `next`
  15.5 fixa `postcss@8.4.31` (quatro CVEs de path-traversal no source map) e
  arrasta `sharp@0.34.5` (CVEs do libvips); o `@tailwindcss/postcss` e o `vite`
  ja usavam a versao corrigida, entao o override so alinha o resto. Subir o
  `next` de major para o mesmo efeito seria mudanca bem maior. Sobram 4 avisos
  `high` no `npm audit`, todos em `deepmerge-ts`/`effect` sob o **CLI do
  Prisma** — ferramenta de migracao, nao vai para producao; o unico "fix" e
  regredir o `prisma` de major.
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
- **Musica do Spotify: fase A pronta** (ver secao propria abaixo). Status
  personalizado e jogo por SDK continuam de fora.
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

## Spotify — o que a pessoa esta ouvindo (fase A)

"Ouvindo no Spotify" no cartao de atividade e no painel "Ativo agora", como o
Discord faz. **Funciona no navegador E no desktop** — diferente da deteccao de
jogo, que so roda no desktop: quem descobre a musica e o Spotify, pelo token
que a pessoa autorizou, nao a maquina dela.

### O caminho

```
1. a pessoa clica "Conectar Spotify" nas config -> OAuth (scope minimo:
   user-read-currently-playing) -> callback troca o code por tokens
2. tokens guardados CIFRADOS (AES-256-GCM, chave derivada do AUTH_SECRET)
3. o GATEWAY tem um poller: para cada pessoa online com conta ligada, consulta
   `currently-playing` a cada 15s e anuncia pela presenca quando a faixa muda
```

- **O `client_secret` vai so para web e gateway** (troca do code / refresh do
  token), nunca para bundle nenhum — mesma regra do `TWITCH_CLIENT_SECRET` do
  IGDB. Sem `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET`, o poller e no-op e a
  seccao das config nem aparece.
- **Poll, e nao push.** O Spotify nao tem webhook de playback. 15s de
  defasagem na TROCA de faixa; a barra de progresso animada (que extrapola o
  `progress_ms` no cliente) e a fase B.
- **Uma instancia de gateway observa so os usuarios conectados A ELA.** Com
  duas maquinas, cada uma cuida dos seus, e o anuncio ja atravessa instancia
  pelo adapter de Redis (fase 7c-2).
- **"Invisivel" zera a musica no que sai**, igual ao jogo (`entryVisivel` em
  `handlers/presence.ts`). E a chave "Exibir no perfil" (`showOnProfile`)
  desligada faz o poller anunciar `null` — o dado nao sai do gateway.
- **A capa vem como URL** (`i.scdn.co`, liberado no `img-src` do CSP), nao
  embutida — mesma escolha da capa do IGDB.
- **O que passa pela presenca e sanitizado** (`safeMusicActivity` /
  `safeSpotifyArt` em `packages/shared/src/events.ts`): sem titulo nao ha
  atividade; a capa so passa do CDN do Spotify; o link so passa se for uma
  faixa do `open.spotify.com`; titulo e artistas gigantes sao cortados.

### Onde fica

- `packages/db/prisma/schema.prisma` — modelo `SpotifyAccount` (PK `userId`)
- `packages/db/src/secret-box.ts` — cifra dos tokens
- `packages/access/src/spotify.ts` — OAuth + chamadas a API (web e gateway)
- `packages/access/src/spotify-account.ts` — guardar, `tokenDeAcesso` (renova +
  persiste), desconectar
- `apps/web/src/app/api/spotify/{connect,callback,state}/route.ts`
- `apps/web/src/components/settings/spotify-section.tsx` — a seccao das config
- `apps/realtime/src/spotify/poller.ts` — o poller
- `packages/shared/src/events.ts` — `MusicActivity` + `listening` em
  `PresenceEntry`

### Limitacoes conhecidas (fase A)

- **`showAsStatus` ("Exibir o Spotify como seu status") ainda nao faz nada.**
  A chave existe e e guardada; substituir o texto de status por "Ouvindo
  Spotify" e a fase B.
- **Sem barra de progresso.** So titulo, artistas e capa. A barra (com pausa e
  extrapolacao) e a fase B.
- **Nao testado em call/OAuth real nesta maquina** — precisa das credenciais
  do app Spotify nas variaveis da Vercel e do Fly. O que esta provado: o
  parser e a cifra por teste unitario (8 casos), o typecheck, o build.
- **Podcast e anuncio sao ignorados** (`currently_playing_type !== "track"`).
- **Cota do Spotify:** o app nasce em "development mode", limitado a 25
  usuarios autorizados. Passar disso exige pedido de extensao a Spotify.
- **O poller e por instancia e em memoria.** Uma queda nao-graciosa do gateway
  (OOM) deixa a pessoa "ouvindo" na tela dos outros ate o proximo ciclo de
  presenca. Mesma classe da limitacao ja documentada da fase 7c-2.

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
- **Riot** tem o mesmo problema da Epic — sem convencao de pasta. O VALORANT
  da maquina de teste estava em `D:/Riot Games/VALORANT/live`, e nao no
  `C:\Riot Games` padrao. Ela escreve `product_install_full_path` num YAML por
  produto, em `C:/ProgramData/Riot Games/Metadata/<produto>/`, e e a **unica
  loja que deixa um `.ico` pronto** ao lado.
- **Ubisoft** e **GOG** guardam a biblioteca no REGISTRO, lido com `reg query`
  — nao com dependencia nativa, que custaria rebuild a cada versao de Electron.
  A Ubisoft da so o caminho, mas ali a pasta ja e o nome de marca
  (`D:/Tom Clancy's Rainbow Six Siege/`, com o apostrofo que na Steam so
  existe dentro do manifesto); o GOG da caminho e `gameName` na mesma
  sub-chave.
- **Xbox** instala em `<disco>:/XboxGames/<Nome do Jogo>/`, e ali a pasta e o
  nome. Nao lemos `WindowsApps`: e protegida por ACL e listar dela exigiria
  elevacao, que um app de bandeja nao deve pedir.

Isso cobre qualquer jogo dessas lojas, inclusive os instalados depois.

**Por que nao olhamos o nome do executavel.** Seria o caminho obvio para o
VALORANT (`VALORANT-Win64-Shipping.exe`) e e uma armadilha: exige uma tabela
`executavel -> jogo` mantida a mao, que so cobre o que alguem cadastrou e
envelhece a cada lancamento. Perguntar a loja onde ela instalou cobre a
biblioteca inteira de graca, hoje e daqui a um ano.

**Nenhum LAUNCHER casa, e isso e o que segura o caso do VALORANT.** Os
catalogos apontam para pastas de JOGO, e o launcher mora fora delas. O Riot
Client fica aberto o tempo todo em quem joga VALORANT; se ele casasse, a
pessoa apareceria "jogando" sem ter aberto jogo nenhum. Ele se exclui sozinho,
sem lista negra: tem `Riot Client.settings.yaml`, e nao
`.product_settings.yaml` — exigir o sufixo de produto ja o deixa de fora.
Verificado na maquina real com o cliente de pe e o jogo fechado: nenhum jogo
detectado.

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

**Ao acrescentar assercao em `verify-game-activity.mjs`, use `respirar()` antes
de cada anuncio.** A presenca e limitada a rajada de 10 e recarga de 1/s por
usuario, e o script ja dispara 12 `presence:game`. Sem cadencia ele estoura o
balde no meio e os eventos seguintes somem em silencio — o sintoma sao falhas
que MUDAM DE LUGAR a cada rodada, sempre com `undefined`, e a primeira rodada
passando enquanto as seguintes falham (o balde vazio e herdado). Quem esta
irreal ali e o script: o app anuncia no maximo uma vez a cada 15 segundos.

### Jogo com anti-cheat: por que so o caminho nao bastava

O VALORANT nao aparecia, e a causa nao era a Riot: era o VANGUARD. O anti-cheat
de kernel protege o processo do jogo, e o Windows passa a devolver caminho
VAZIO para ele. Medido nesta maquina com o jogo aberto:

```
11936 VALORANT                    (Path vazio)
20228 VALORANT-Win64-Shipping     (Path vazio)
12876 vgc                         (Path vazio)
```

Nem `wmic process get ExecutablePath` nem `(Get-Process).Path` trazem esses
tres. Como TODA a deteccao era por caminho, o jogo mais jogado da maquina era
justamente o unico invisivel — e o sintoma nao apontava para lugar nenhum,
porque nao havia erro: a lista simplesmente nao continha o jogo.

O NOME do processo o Vanguard nao esconde. Entao existe uma segunda passada,
`jogosPorNomes`, que cruza os nomes dos processos com o catalogo de jogos
INSTALADOS. Nao e uma tabela `executavel -> jogo` mantida a mao (que so cobre o
que alguem lembrou de cadastrar): e o cruzamento de "o que a loja instalou" com
"o que esta rodando".

As duas passadas rodam em paralelo, entao o custo em tempo e o da mais lenta.
Caminho continua sendo o caminho principal — e dele que sai o icone do
executavel, e ele cobre jogo fora do catalogo (Steam, pela convencao de pasta).

O casamento por nome aceita PREFIXO, para pegar o sufixo de motor que quase
todo jogo carrega (`VALORANT-Win64-Shipping`, `FortniteClient-Win64-Shipping`),
com um piso de 5 caracteres: sem ele, um jogo chamado "Rust" faria qualquer
`rustdesk.exe` anunciar que a pessoa esta jogando Rust.

Verificado de ponta a ponta com o jogo aberto, dentro do Electron: nome
`VALORANT` e icone vindo do `.ico` que a propria Riot deixa em
`ProgramData/Riot Games/Metadata`.

### Biblioteca de jogos da comunidade (parte 1: fila e revisao)

A deteccao so conhece jogo que alguma LOJA declarou ter instalado. Jogo fora de
loja nao tem quem responda "onde voce esta" — entao as pessoas respondem: quem
abre um jogo que o app nao reconheceu pode ensina-lo, e a equipe revisa antes
de aquilo valer para a base inteira.

**O QUE VIAJA E O EXECUTAVEL, NUNCA O CAMINHO.** Duas razoes, cada uma bastando
sozinha: o caminho carrega o nome de usuario do Windows quase sempre
(`C:/Users/fulano/...`), e uma biblioteca compartilhada o exporia para todo
mundo, para sempre; e ele nem funcionaria, porque cada pessoa instala em disco
e pasta diferentes, enquanto o nome do executavel e o mesmo em toda maquina.

Barra e dois-pontos sao RECUSADOS pelo schema, e nao apenas desencorajados —
sao exatamente o que transforma nome de arquivo em caminho.

**A revisao existe porque um jogo aprovado vale para todo mundo.** Sem ela,
bastaria uma pessoa sugerir `chrome.exe = Google Chrome` para a base inteira
aparecer jogando Chrome, e nada no sistema teria como saber que esta errado.

**O contador conta PESSOAS, nao cliques.** O par (jogo, pessoa) e unico no
banco. Contador inflavel seria pior que contador nenhum: faria "dez pessoas
pediram" parecer sinal forte quando e uma pessoa clicando dez vezes.

`User.equipe` e administracao GLOBAL, e nao tem relacao com dono de servidor —
sao eixos diferentes de proposito, para que ter um servidor nao de a ninguem
poder de escrever no catalogo dos outros. Concede-se por
`scripts/definir-equipe.mjs`, e a regra de leitura mora em `@aether/access`.

- **O icone que abre a revisao some para quem nao e equipe, mas isso e
  CORTESIA.** Quem barra sao as actions, que rechecam no servidor e respondem
  como se a funcionalidade nao existisse — 404, e nao 403, pela regra de nao
  revelar existencia de recurso. Ver "Painel da equipe" abaixo para onde essa
  revisao mora hoje.
**No desktop (parte 2):** a aba Atividade ganha "Nao esta vendo seu jogo?
Adicione-o", e o catalogo aprovado desce da pagina para o processo principal.

A PAGINA busca o catalogo e repassa por IPC — o processo principal nao o busca
sozinho porque a sessao vive no renderer, e dar-lhe credencial propria seria
criar um segundo lugar com segredo para resolver o que a pagina ja resolve. Uma
copia fica em disco (`jogos-comunidade.json`) para valer ja na primeira
deteccao, 8 segundos depois de abrir, antes de a pagina carregar.

O CASAMENTO DA COMUNIDADE E POR IGUALDADE EXATA, ao contrario do catalogo das
lojas, que aceita prefixo. A diferenca tem razao: na loja a chave e o NOME DO
JOGO e o executavel costuma ser o nome mais um sufixo de motor; aqui a chave JA
E o executavel, entao prefixo faria `sot` casar com qualquer
`sotqualquercoisa.exe`.

A comunidade entra por ULTIMO na deteccao: o que uma loja declarou e informacao
de primeira mao, o que as pessoas ensinaram e de segunda — e so a loja traz
icone.

- **A tela de adicionar ENFRAQUECE, de proposito, o invariante de que a pagina
  nunca ve a lista de processos.** O que o torna aceitavel: acontece so quando
  a pessoa abre aquela tela, nunca continuamente; o processo principal recusa
  se a deteccao estiver desligada; e o que desce sao NOMES, jamais caminhos.
  Ainda assim, e a unica tela do app em que a pessoa ve a propria lista de
  programas, e ela diz isso na propria tela.
- **O filtro de ruido do sistema e curto e do obvio.** Ele nao tenta adivinhar
  o que e jogo — adivinhar erraria para os dois lados, e quem sabe se aquilo e
  um jogo e a pessoa que esta olhando. Medido numa maquina real: 45 candidatos,
  com o ruido do Windows fora.
- **Nao ha faxina do catalogo em disco.** Um jogo que a equipe RECUSAR depois
  de ter aprovado continua no arquivo de quem ja baixou, ate a proxima
  sincronizacao — que acontece a cada carregamento da pagina.
- **As duas normalizacoes sao implementacoes SEPARADAS.** O desktop e
  JavaScript puro e nao importa `@aether/shared`; o que as mantem iguais e um
  teste que compara as duas caso a caso. Se divergirem, um jogo aprovado deixa
  de casar com o processo que o originou — sem erro, so o jogo continuando
  invisivel.
- **Nao ha limite de sugestoes por pessoa.** Alguem determinado enche a fila de
  lixo. O par unico impede inflar o contador, e a sugestao guarda quem a fez,
  mas nao ha rate limit nem bloqueio automatico ainda.

### Explorar comunidades

Uma bussola no trilho abre a vitrine: cards com banner, icone, nome, descricao,
membros e quem esta online, filtros por categoria e busca.

**ENTRAR NA VITRINE PASSA POR APROVACAO.** A primeira versao era um booleano
`publico` que o dono ligava e pronto — e como qualquer pessoa cria conta e
servidor, isso abria a vitrine para spam e, pior, para alguem criar um servidor
chamado "AETHER OFICIAL" e ficar ao lado do nosso. O selo protege o nome, mas
muita gente nao olha selo. Foi corrigido para a mesma regra da biblioteca de
jogos: o que aparece para todo mundo passa por revisao.

O estado e um enum, e nao um booleano: `PRIVADO` (padrao), `PENDENTE` (o dono
pediu), `APROVADO` (aparece), `RECUSADO`. Ligar leva a PENDENTE; DESLIGAR vale
na hora e nao passa por ninguem, porque sair da vitrine e direito do dono.

**MUDAR NOME OU DESCRICAO DE UM SERVIDOR LISTADO O DEVOLVE A FILA.** Sem isso a
revisao seria facil de driblar: aprova-se "Comunidade de Xadrez" e renomeia-se
depois. Quem esta privado edita a vontade — so quem esta na vitrine paga por
uma nova leitura. Trocar so a categoria nao devolve.

`oficial` continua eixo separado, marcado por `definir-servidor-oficial.mjs`, e
faz duas coisas: fixa no topo e mostra o selo. Aprovado e "pode aparecer";
oficial e "e nosso".

Entrar pela vitrine NAO usa convite: sao autorizacoes diferentes — o convite
prova que alguem de dentro chamou, a vitrine prova que a comunidade quer ser
encontrada.

- **A contagem de online pode faltar.** Vem de uma rota interna do gateway (a
  unica que existe para RESPONDER, e nao para avisar), porque a presenca vive
  so na memoria dele. Sem resposta, o campo vem NULO e o card mostra so o
  total. Zero seria afirmar que ninguem esta numa comunidade cheia.
- **O banner e um gradiente derivado do id**, e nao imagem enviada. Todo
  servidor tem banner desde o primeiro dia, sem upload e sem bucket novo.
- **Nao ha rate limit de pedidos.** Alguem determinado enche a fila; a
  aprovacao segura o que aparece, mas nao o que chega.
- **Duas contas com o mesmo `displayName` confundem, mesmo com o `@usuario` na
  tela.** A barra inferior JA mostra os dois (nome em cima, `@usuario`
  embaixo), e ainda assim uma sessao na conta errada custou uma investigacao
  inteira: o botao de configuracoes "sumiu" porque aquela conta nao era dona do
  servidor. Nao ha o que corrigir no codigo — fica anotado como armadilha de
  ambiente de teste, para a proxima vez que algo "sumir" a primeira pergunta
  ser "em qual conta estou?".
- **Os dois `catch` que viravam 404 agora registram o motivo.** Eram vazios, e
  por isso sessao expirada, erro do Prisma e coluna nova num cliente velho
  davam a MESMA tela de "nao existe" — impossivel de diagnosticar.

### Painel da equipe: pagina propria, e nao mais aba de configuracoes

As filas — jogos sugeridos e pedidos de vitrine — moravam numa aba escondida
dentro de "Configuracoes", visivel so para quem e equipe. A primeira medida
real mostrou o custo disso: **3 jogos e 1 pedido parados**, nenhum deles
conhecido, porque ninguem tinha motivo para abrir aquela aba sem saber que
ela existia.

Dois problemas com a mesma causa — a revisao fica junto de ajuste pessoal de
conta, em vez de ser o que e: trabalho de moderacao. Ambos corrigidos juntos:

1. **Aviso.** Adicionado primeiro, ainda dentro das configuracoes: um
   marcador com a SOMA das duas filas. A soma e o rotulo (`totalDeRevisoes`,
   `rotuloDeRevisoes`, com o teto em `9+`) vivem em `@aether/shared`, com
   teste cobrindo a fronteira e o caso de uma fila vazia com a outra cheia.
2. **Lugar proprio.** O marcador provou que faltava aviso, mas nao resolvia
   estar escondido — so avisava que havia algo escondido. A revisao ganhou
   pagina dedicada, `/app/equipe` (`equipe-panel.tsx`), fora de qualquer
   servidor especifico (mesmo raciocinio de "Explorar comunidades": e
   trabalho que nao pertence a um servidor so). A entrada e um icone de
   escudo na TRILHA lateral — visivel, e nao mais um item de menu dentro de
   outro menu — que so aparece para quem e equipe, com o mesmo marcador
   agora ali.

- **So a equipe consulta a contagem.** Para quem nao e, a chamada nem sai do
  navegador: a action responderia "Nao encontrado" de qualquer forma, e uma
  consulta por sessao de todo mundo para receber recusa seria carga sem
  contrapartida.
- **NAO e tempo real, de proposito.** Busca ao montar a trilha e ao voltar
  para a aba, com um minuto de intervalo minimo. Nada aqui e urgente, e um
  `setInterval` batendo no banco o dia inteiro para mostrar um numero quase
  sempre zero custaria caro por nada; alt-tab de jogo dispara `focus` varias
  vezes por minuto, dai a janela.
- **O numero baixa junto com a fila.** As duas abas do painel devolvem a
  contagem fresca depois de cada decisao, em vez do marcador continuar
  dizendo "1 esperando" para algo que voce acabou de aprovar.
- **A checagem de equipe virou uma so** — `sessaoDaEquipe`, em
  `apps/web/src/server/guards.ts`. Eram duas copias locais (jogos e
  comunidades), e a pagina nova ia criar a terceira. NAO se chama
  `requireEquipe` porque os outros `require*` lancam, e devolver `null` aqui
  e o certo: a action responde "Nao encontrado", nao "voce nao pode". A
  PAGINA usa `ehEquipe` direto (precisa do `notFound()` de pagina, nao do
  `fail()` de action).

- **Quem fica com a janela aberta sem trocar de aba nao ve o pedido chegar.**
  O marcador so reavalia no proximo foco ou navegacao. E aviso passivo: nao
  ha notificacao, som, e-mail nem badge no icone do desktop.
- **Nao verificado com login de equipe.** Typecheck, testes (com mutacao na
  soma e na fronteira do `9+`), build de producao (a rota `/app/equipe`
  aparece na lista de rotas geradas) e a regressao da fase 2 passaram; ver o
  painel de verdade — o icone na trilha, o recorte por aba, os dois
  numerinhos — exigiria uma sessao logada como equipe, que esta rodada nao
  fez.

### Limitacoes conhecidas da deteccao de jogo

- **O icone do VALORANT vem da Riot, e nao do executavel.** Nao ha escolha:
  `app.getFileIcon` precisa abrir o programa, e o Vanguard nao deixa. Para
  jogos com anti-cheat cuja loja NAO entrega `.ico` pronto, a atividade fica
  com nome e sem icone.
- **O casamento por nome depende de o jogo estar no catalogo de uma loja.**
  Jogo com anti-cheat instalado fora de loja continua invisivel: sem caminho
  legivel e sem entrada de catalogo, nao ha o que cruzar.
- **Battle.net, EA e jogos avulsos ainda nao sao detectados.** A Battle.net
  guarda o catalogo num `product.db` BINARIO (protobuf), que e trabalho de
  outra ordem — nao um YAML de dois campos. A EA nao foi feita porque nao ha
  instalacao dela nesta maquina para verificar contra, e escrever o parser as
  cegas seria demonstracao, nao codigo de producao. Jogo avulso, fora de
  qualquer loja, nao tem quem responda "onde voce instalou": a saida ali seria
  uma tela de "adicionar jogo" manual.
- **GOG e Xbox foram escritos, mas NAO verificados contra uma instalacao
  real.** Nenhum dos dois esta instalado na maquina de teste: o que existe e
  teste de unidade sobre a saida do `reg query` e sobre o formato de pasta.
  Se o formato real divergir, a loja simplesmente nao devolve jogo — falha
  fechada, sem quebrar as outras (`Promise.allSettled`, e nao `all`). Riot e
  Ubisoft, sim, foram verificados contra as instalacoes desta maquina.
- **A leitura do registro quebra em `\r?\n`, e nao em `\n`.** Nao e detalhe: o
  `reg` termina cada linha em CRLF, e o `\r` que sobrava impedia o `$` do
  regex de casar (`.` nao casa `\r`). O efeito era silencioso e pior que um
  erro — a chave era encontrada, o bloco existia, e a lista de valores vinha
  vazia, entao a loja inteira ficava sem jogo nenhum. Um teste de fixture
  escrito a mao, com `\n`, teria passado; quem pegou foi rodar contra o
  registro de verdade.
- **Um jogo instalado por DUAS lojas conta como Steam.** A regra da Steam e
  avaliada primeiro; e caso raro e o nome sai igual de qualquer jeito.
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

  **Excecao: a Riot entrega um `.ico` pronto**, e ele ganha do icone do
  executavel. Duas razoes — e arte de verdade em vez dos 48x48 embutidos no
  programa, e existe em disco mesmo com o jogo FECHADO, o que importa em jogo
  com anti-cheat, cujos processos nem sempre podem ser lidos. Ele e
  redimensionado para 48px de proposito: o `.ico` tem varias resolucoes, e
  esse data URL nao fica na maquina — viaja para o gateway e de la para todo
  mundo que ve o cartao, a cada troca de jogo.

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

  **E o GATEWAY desfazia esse conserto, em silencio.** O `setGame` comparava
  so o nome — "o icone acompanha o jogo, nao muda sozinho" — entao o desktop
  reanunciava o icone bom e o gateway descartava por ser "o mesmo jogo". O
  desktop fazia o trabalho e ninguem via o resultado. Medido: anunciar o mesmo
  jogo trocando so o icone gerava ZERO eventos para os outros. Hoje o icone
  conta como mudanca; carimbo e capa continuam presos ao NOME, porque so o
  icone ter melhorado nao reinicia a sessao nem justifica buscar a arte de
  novo. Coberto por duas assercoes em `verify-game-activity.mjs`.

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

### Excluir o canal que voce esta vendo nao pode virar 404 de tela inteira

O SINTOMA: excluir um canal de texto excluia de verdade, mas jogava quem
estava vendo aquele canal num 404 de PAGINA INTEIRA — sidebar, barra de
controles, tudo trocado pela tela generica de "este link nao existe".

A CAUSA e o mecanismo logo acima: `deleteChannelAction` chama
`revalidatePath`, e o gateway ainda avisa todo mundo por `server:changed` —
as duas coisas fazem o Next re-executar a pagina do canal que acabou de
sumir. Ela chama `notFound()` (o `if (!channel) notFound()` de
`c/[channelId]/page.tsx`, que ja existia e esta certo: o canal de fato nao
existe mais), e sem um limite PROPRIO deste segmento, o 404 subia ate o
`app/not-found.tsx` global.

O CONSERTO nao mexeu em nenhuma das duas causas — as duas continuam certas
por conta propria. Foi dar um `not-found.tsx` PROPRIO ao segmento
`c/[channelId]`: ele redireciona (`router.replace`, para o "voltar" do
navegador nao devolver a URL morta) para a raiz do servidor, um componente
estatico sem checagem nenhuma (`ServerHomePage`), mantendo o layout do
servidor — sidebar e barra de controles — montado por cima. So o painel do
canal troca.

COBRE OS DOIS LADOS pelo mesmo caminho: tanto quem excluiu quanto qualquer
outra pessoa que estivesse com aquele canal aberto quando ALGUEM MAIS o
excluiu chegam a este boundary do mesmo jeito, porque os dois tem a mesma
pagina re-executada sob os pes pelo `server:changed`.

- **Cobre tambem perda de permissao de VER o canal**, nao so exclusao — e o
  mesmo `notFound()` da pagina, causa generica.
- **Nao verificado com dois clientes reais simultaneos** (um excluindo, outro
  olhando) nesta rodada — so o caminho do proprio autor da exclusao.

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

## Transferencia de posse e exclusao de servidor

A "zona de risco" que a aba Geral das configuracoes do servidor prometia e
nunca tinha: transferir o servidor para outro membro, e apaga-lo para sempre.
As duas so aparecem para quem e o DONO de verdade — nunca para quem tem
MANAGE_SERVER por cargo (um Administrador, por exemplo). Confundir as duas
coisas seria escalada de privilegio: gerenciar nao e a mesma coisa que ser
dono, e um Administrador transferindo o servidor para si mesmo teria exatamente
esse efeito.

**As duas pedem a senha da CONTA de quem esta agindo**, reconfirmada no
servidor contra o `passwordHash` de verdade — a sessao ja aberta sozinha nao
prova que quem esta na frente da tela agora e o dono, e nao alguem que achou o
notebook destravado. Pedido do proprio dono do produto para a transferencia;
estendido para a exclusao porque e ainda mais dificil de desfazer — na
verdade, impossivel.

### O bug que a transferencia evita: o cargo "Dono" e separado do `ownerId`

`isOwner`, no calculo de permissao (`loadMemberAccess`), olha SO
`Server.ownerId` — nao o cargo. Mas o cargo "Dono" (criado com
`ALL_PERMISSIONS`, marcado `isOwner: true` no schema) fica ATRIBUIDO a quem
criou o servidor via `MemberRole`, como qualquer outro cargo.

Se a transferencia so trocasse `ownerId`, o dono antigo deixaria de contar
como dono no calculo — mas continuaria com o cargo "Dono" preso a ele, e esse
cargo sozinho ja vale `ALL_PERMISSIONS`. Resultado: administracao total
disfarçada de "membro comum", exatamente o tipo de permissao divergente que a
regra de arquitetura deste projeto existe para evitar.

O conserto e a transacao mover o `MemberRole` do cargo "Dono" junto com o
`ownerId`: sai de quem estava, entra em quem recebeu. Verificado contra o
Postgres de verdade (nao so a decisao dublada) em
`scripts/verify-server-ownership.mjs` — cria um servidor descartavel, transfere,
confere que o cargo saiu de um lado e entrou no outro, transfere de volta
(prova que o `upsert` nao quebra quando o alvo ja teve o cargo antes) e so
depois testa a exclusao.

### Exclusao: a ordem importa por causa do cascade

`Server` tem `onDelete: Cascade` para tudo que depende dele — membros, cargos,
categorias, canais, mensagens, convites, banimentos e ate o proprio log de
auditoria. Isso resolve a limpeza inteira sozinho, mas cria uma ordem
obrigatoria do lado do gateway: ele precisa saber quais canais o servidor
tinha para tirar cada socket das salas certas, e essa consulta so funciona
ANTES do cascade acontecer. Por isso `deleteServerAction` chama
`notifyServerDeleted` (nova rota `/internal/server-deleted`, que reaproveita o
mesmo `evict()` do kick/ban — um por membro, so trocando o motivo mostrado)
e SO DEPOIS apaga a linha do banco.

### Como testar

```bash
npx dotenv -e .env -- node scripts/verify-server-ownership.mjs
```

Na interface: aba **Geral** das configuracoes do servidor, como dono. A
secao "Zona de risco" so aparece ali.

### Limitacoes conhecidas

- **Nao ha log de auditoria da exclusao.** `AuditLog.serverId` faz cascade a
  partir de `Server` — gravar "servidor excluido" e apagar o servidor na
  sequencia apagaria o proprio registro junto. Nao ha como esse log
  sobreviver ao que ele descreveria; documentado aqui em vez de fingir um
  rastro que a propria exclusao sempre levaria embora. A transferencia de
  posse tem log normal (`server.transfer_ownership`), porque o servidor
  continua existindo depois dela.
- **Nao pede para digitar o nome do servidor**, so a senha. Foi uma escolha
  deliberada para nao inflar o pedido original (so a senha foi pedida) — se
  a exclusao acidental vier a ser um problema real, esse e o proximo reforço
  natural.
- **A exclusao vira uma chamada HTTP por membro conectado** para o gateway
  (`evict()` reaproveitado, nao uma rota bulk dedicada). Aceito porque um
  servidor deste produto tem poucas dezenas de pessoas; a alternativa seria
  uma segunda versao da mesma logica so para poupar uma consulta que ja e
  rapida.
- **Nao verificado com login de dono de verdade na interface.** Typecheck,
  os 348 testes unitarios existentes e a verificacao contra o Postgres real
  (`verify-server-ownership.mjs`, exercitada via SQL direto no projeto
  Supabase nesta rodada, ja que o ambiente nao tinha `.env` com a senha do
  banco) passaram; falta abrir a tela como dono, transferir para um membro de
  verdade e confirmar que o modal, o redirecionamento e o aviso de socket
  (`server:evicted`) aparecem como esperado.
- **`server:evicted` nao mostra o motivo na tela.** O evento carrega
  `reason` (mensagens diferentes para expulsao/banimento e para exclusao de
  servidor), mas o cliente hoje so usa isso para decidir redirecionar — o
  texto em si nao aparece em lugar nenhum. Continua correto (a pessoa sai da
  tela do jeito certo), so nao é tao informativo quanto podia ser.

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

### Emoji no que voce esta digitando

O mesmo seletor tambem abre pelo botao de carinha no campo de mensagem, e
insere o emoji NO CURSOR — nao no fim. Quem edita no meio da frase espera o
emoji ali; jogar no fim obrigaria a recortar e colar. Com texto selecionado,
substitui a selecao, como qualquer editor.

O cursor volta para depois do emoji e o foco volta para o campo, num EFEITO e
nao logo apos gravar o texto. A primeira versao usava `requestAnimationFrame` e
o cursor ia parar no fim — medido: inserir em "bom |dia" deixava o cursor na
posicao 9 em vez de 6. O rAF corre antes de o React comitar, e o commit do
campo controlado empurra o cursor para o fim depois; um efeito roda DEPOIS do
commit.

O seletor FICA ABERTO entre escolhas, como no Discord: escolher varios seguidos
e o uso comum, e reabrir a cada um seria um clique a mais por emoji. Sai
clicando fora ou com Esc.

Isso so e aceitavel porque ele abre ACIMA do campo e nao o cobre — medido: o
seletor termina 10px antes de onde o campo comeca. Se cobrisse, ficar aberto
esconderia o que a pessoa acabou de escrever, e ela nao veria o resultado do
proprio clique.

### Limitacoes

- **Nao da para ver QUEM reagiu.** A lista de nomes nao viaja: numa mensagem
  com trinta reacoes seriam trinta usuarios completos por emoji a cada
  carregamento de historico, para desenhar um numero.
- **Sem emoji personalizado do servidor.** So os do Unicode.
- **Sem reacao em conversa direta pela tela** — o caminho do servidor funciona
  e o gateway trata os dois, mas a DM ainda nao foi verificada de ponta a ponta.

## Reordenar arrastando (canais e servidores)

`dnd-kit` nos dois lugares. As setas ao lado do canal continuam funcionando —
arrastar nao substituiu nada, so acrescentou.

### A distancia de ativacao e o que faz isto funcionar

`activationConstraint: { distance: 6 }` no `PointerSensor`. Sem ela, QUALQUER
clique vira o comeco de um arrasto e o canal para de navegar — o item mais caro
da funcionalidade seria ter quebrado o clique. 6px separa "cliquei" de "puxei"
sem exigir precisao.

### Ordem dos servidores e POR PESSOA

`ServerMember.position`, e nao `Server.position`. A ordem do trilho e
preferencia de quem olha: guardar no servidor faria arrastar um icone
reordenar a tela de todo mundo que e membro dele.

A coluna nasce com 0 para todos, e o desempate continua sendo `joinedAt` — o
criterio unico ate aqui. Sem o desempate, a ordem que as pessoas ja viam
viraria indefinida da noite para o dia.

### O canal recalcula a CATEGORIA INTEIRA

`reorderChannel` reescreve as posicoes do destino como 0..n em vez de deslocar
vizinhos. Deslocar exige posicoes sem buracos e sem empates, e elas nao estao:
canais nascem com `position` default e duas criacoes simultaneas empatam.
Reescrever e idempotente e conserta, de passagem, qualquer bagunca que ja
exista.

A categoria de destino e conferida contra o servidor: o id chega do navegador,
e sem isso daria para mandar um canal para a categoria de OUTRO servidor — onde
ele sumiria dos dois lados.

### So quem pode editar arrasta

`useSortable({ disabled: !canEdit })` — `disabled`, e nao "nao chamar o hook",
que quebraria a regra de hooks quando a permissao mudasse no meio da sessao (e
ela muda: cargo editado ja recalcula a arvore de quem esta conectado).

Sem isso, um membro comum arrastaria, veria o canal se mover, e a action seria
recusada no servidor — a tela voltaria atras sozinha, o que parece defeito e
nao "voce nao pode".

### Um contexto so para a arvore inteira

Arrastar ENTRE categorias so funciona se as duas pontas viverem no mesmo
`DndContext`. Cada lista e um `SortableContext` com `useDroppable` proprio — e
o droppable existe pela categoria VAZIA: sem area soltavel propria nao haveria
sobre o que soltar ali, e mover um canal para uma categoria sem canais seria
impossivel. Que e justamente o caso em que arrastar bate as setas.

### Dois bugs de "a tela pula" que isto causou

Achados por video de uso, e os dois eram desta rodada:

1. **O canal TREMIA ao arrastar.** `setNodeRef` estava no `<Link>` e o
   `transform` no `<li>`. O dnd-kit MEDE o no do `setNodeRef` e eu movia outro:
   mover o pai desloca o filho medido, a medicao muda, o transform recalcula, e
   move de novo — um laco de realimentacao que na tela e tremor.

   Quem mede e quem se move tem de ser o mesmo no. A alca de arrasto e outra
   coisa, e para ela existe `setActivatorNodeRef` — que e o que o `<Link>` usa
   agora, deixando os botoes de mover/editar/excluir livres.

2. **A conversa inteira descia de uma vez ao conectar.** A fileira de reacoes
   era renderizada sempre que se PODIA reagir, com o botao escondido por
   `opacity-0` — e invisivel ainda ocupa altura. Como `podeReagir` depende do
   socket, que comeca nulo, a pagina carregava compacta e ao conectar TODA
   mensagem ganhava uma faixa junto. Repetia a cada reconexao.

   Agora a fileira so existe quando ha reacao de verdade, e o botao de reagir e
   `absolute` — fora do fluxo, entao ligar ou desligar nao move nada.
   Verificado com 30 amostras de altura ao longo de 6s durante o carregamento:
   722px em todas.

### Limitacoes

- **Categorias nao se reordenam** arrastando; so canais e servidores.
- **A categoria de ORIGEM nao e recalculada** ao mover um canal para fora, entao
  ela pode ficar com buracos (0, 2, 3). Inofensivo — a ordem e relativa — mas
  nao e limpo.
- **Sem toque:** o `PointerSensor` cobre mouse e caneta; celular nao foi
  verificado.

## Midia avancada: codec da tela e tratamento do microfone

Em Configuracoes > Voz e video, no fim da aba.

### Codec: por que NAO e `setCodecPreferences`

A API crua do WebRTC manda mexer no transceiver da `RTCPeerConnection`. Aqui
isso seria errado: quem cria e possui essa conexao e o LiveKit, e ele a recria
a cada reconexao, renegociacao e mudanca de publicacao. Uma preferencia posta
por fora seria desfeita no primeiro desses eventos — em SILENCIO, com a call
seguindo no codec errado. E mexer no transceiver no meio da negociacao do SDK
quebra a call inteira em vez de degradar.

O LiveKit decide na PUBLICACAO (`publishTrack({ videoCodec })`), que e onde a
escolha pertence: ele monta a oferta com esse codec e o mantem atraves das
renegociacoes.

A lista de opcoes vem do proprio SDK (`videoCodecs` do `livekit-client`:
vp8, h264, vp9, av1, h265). Uma lista nossa ofereceria na tela algo que o SDK
recusaria na hora de usar.

### A deteccao usa o SENDER, nao o receiver

`RTCRtpSender.getCapabilities("video")`, e nao `RTCRtpReceiver`. A pergunta e
"consigo CODIFICAR isto para mandar", nao "consigo decodificar o que chegar" —
sao listas diferentes. Quase todo navegador ABRE H.265 e quase nenhum o GERA;
com o receiver, a opcao apareceria disponivel e a transmissao falharia.

O que o navegador nao codifica fica desabilitado, com o motivo escrito na
opcao. Conferido por mutacao: removendo h265 e av1 da resposta do navegador, as
duas opcoes ficam cinza e ganham o aviso.

### Tratamento do microfone: a novidade e poder DESLIGAR

Supressao de ruido, cancelamento de eco e ganho automatico ja estavam ligados,
sempre, sem opcao. Continuam ligados por padrao — o que muda e a chave.

Isso nao e capricho. Os tres processadores do navegador mexem no som para
favorecer FALA, e destroem quem toca ou canta: a supressao corta sustentacao e
reverberacao, o cancelamento de eco corta o que julga vir do alto-falante (a
base que voce toca junto), e o ganho automatico bombeia — sobe nas pausas e
abaixa no ataque.

### Limitacoes

- **Vale na proxima vez.** O codec entra na proxima transmissao e o tratamento
  na proxima entrada em call; nada disso troca no meio.
- **Vale na proxima entrada em call**, como as outras chaves de audio.

## Planos pagos — a fundacao

O comeco do AETHER+ e do AETHER Pro. **Esta fase e so a fundacao**: existe o
plano, existe quem le, e existe como conceder. Nada e barrado ainda.

### Plano NAO e permissao de servidor

Por isso `plans.ts` fica ao lado de `permissions.ts` e nao dentro dele. Os bits
sao POR SERVIDOR e concedidos por cargo — o dono decide quem modera. O plano e
da PESSOA e vale em todo lugar. Se virasse bit, um dono de servidor poderia
distribuir "premium" para quem quisesse.

### A tabela de limites mora em `packages/shared`

Uma so, lida por web, gateway e `@aether/access`. Duas copias divergem na
primeira vez que alguem mexe num lado — e divergencia aqui nao e defeito de
tela: e alguem pagando por 1080p e recebendo 720.

| | Aether | AETHER+ | AETHER Pro |
| --- | --- | --- | --- |
| tela | 720p 30fps | 1080p 60fps | 1440p 60fps |
| bitrate | 2,5 Mbps | 6 Mbps | 10 Mbps |
| telas ao mesmo tempo | 1 | 2 | 3 |
| envio | 25 MB | 250 MB | 1 GB |

### O vencimento e decidido na LEITURA

Nao ha job que vire linhas. Um trabalho agendado que falha, atrasa ou nunca
sobe deixaria a pessoa premium para sempre — e o defeito e silencioso, porque
favorece quem tem. Lendo, a conta expira sozinha no segundo exato, com o resto
do sistema parado.

A linha continua no banco com o tier antigo depois de vencer, de proposito: o
historico permite oferecer renovacao. `expiraEm` nulo significa SEM VALIDADE,
para concessao a mao (equipe, teste, cortesia).

Diante de data corrompida a leitura cai para GRATUITO, e nao para o tier
guardado: errar para menos custa uma reclamacao, errar para mais entrega de
graca e ninguem avisa.

### Comparacao por ESCADA, nunca por igualdade

`planoAtende(a, b)` existe para ninguem escrever `tier === "PLUS"` por ai —
essa comparacao esquece o PRO, e quem paga mais receberia menos. E um erro
facil de escrever e dificil de ver numa revisao.

### Agnostica de provedor

`provedor` e `idExterno` existem e ninguem os preenche. Hoje o plano e
concedido a mao:

```bash
npx dotenv -e .env -- node scripts/definir-plano.mjs ryan PRO 30
npx dotenv -e .env -- node scripts/definir-plano.mjs ryan FREE
```

Quando entrar Stripe ou Mercado Pago, o webhook escreve NESTAS MESMAS colunas
e o resto do sistema nao muda.

### Chaves: dar VIP para quem voce quiser

O jeito de conceder acesso sem cobranca nenhuma — sorteio, parceiro, brinde,
amigo. Vai continuar existindo depois que houver pagamento, porque cobranca nao
resolve o caso de dar de presente.

```bash
npx dotenv -e .env -- node scripts/gerar-chave.mjs PRO 30
npx dotenv -e .env -- node scripts/gerar-chave.mjs PLUS 30 --usos 50 --validade 7 --motivo "sorteio"
npx dotenv -e .env -- node scripts/gerar-chave.mjs --listar
npx dotenv -e .env -- node scripts/gerar-chave.mjs --revogar <id>
```

A pessoa cola o codigo em **Configuracoes -> Plano**.

**O CODIGO NAO FICA GUARDADO.** So o sha256, do mesmo jeito que o token de
recuperacao de senha: chave e credencial ao portador, e um vazamento do banco
viraria plano de graca para quem lesse a tabela. Ele aparece uma vez, na
criacao. Perdeu, revogue e gere outra.

**Alfabeto sem `0 O 1 I L`.** Chave se le em voz alta e se digita a mao, e esses
cinco sao onde o erro acontece. O resgate tambem aceita minusculas e ignora
hifen e espaco — recusar quem colou com espaco no fim seria recusar quem tem a
chave certa.

**Revogar nao tira de quem ja resgatou**, so impede novos resgates. A linha
tambem nao e apagada: o historico precisa dizer que existiu e foi cancelada.

#### Como soma com o que a pessoa ja tem

Duas regras, e as duas erram para o lado do cliente de proposito:

- o **tier** fica o mais alto entre o que ela tinha e o que a chave da —
  resgatar chave menor nunca rebaixa ninguem;
- os **dias somam** ao que restava. Verificado na tela: quem tinha ate 27/set
  resgatou 90 dias e ficou com 26/dez, e nao com 90 dias a partir de hoje.

Numa troca que a pessoa fez de propria vontade, errar para menos gera
reclamacao e desconfianca; errar para mais custa alguns dias.

#### As duas corridas, e como cada uma e barrada

| corrida | o que impede | verificado |
| --- | --- | --- |
| duas PESSOAS na mesma chave de 1 uso | `updateMany` com `usos < maxUsos` no WHERE | 1 ganhou, 1 recusado, `usos 1/1` |
| a MESMA pessoa duas vezes numa chave de 50 usos | par unico `(keyId, userId)` | recusado, e sem gastar uso |

E o mesmo formato do resgate de convite, que ja documenta por que a checagem
lida fora da transacao nao basta.

### Como a pessoa sabe que tem o plano

**Configuracoes -> Plano** mostra o selo, ate quando vale, e a tabela inteira —
nao so o plano atual. Mostrar so o que a pessoa tem transformaria a tela num
recibo; quem esta no gratuito precisa ver o que ganha, e quem assina precisa
ver o que ainda nao tem.

O `SeloPlano` existe desde ja porque metade do valor de um plano cosmetico e
SOCIAL: sem o selo, o assinante paga e ninguem nota, e a proxima pessoa nao tem
motivo para assinar. **Gratuito nao recebe selo** — marcar quem nao paga com um
rotulo de ausencia e humilhacao de graca.

### Como o plano chega ate a tela de OUTRA pessoa

O plano viaja dentro do `PublicUser`, ja resolvido (vencimento aplicado). Quem
monta esse objeto e `toPublicUser`, e quem pede os campos ao banco e
`SELECT_USUARIO_PUBLICO` — os dois em `@aether/shared`, num lugar so.

Antes disso, **nove consultas** repetiam a mesma lista de campos a mao.
Enquanto era so o perfil basico, copiar custava pouco. Com o plano entrando,
cada copia virava uma chance de um lugar mostrar assinatura vencida como ativa
— e esse defeito nao aparece como erro, so como um selo a mais que ninguem
questiona, porque favorece quem tem.

`plano` e campo OBRIGATORIO de `PublicUser`, e nao opcional, de proposito: o
compilador enumera quem esqueceu, em vez de o selo sumir de uma tela so.

**A licao que custou caro:** o seletor e objeto literal (nao pode importar
Prisma — `@aether/shared` tambem roda no navegador), e literal nenhum e
conferido contra o schema. A primeira versao pediu `subscription`; a relacao em
`User` se chama `assinatura`. Compilou limpo nos tres workspaces e so falhou ao
rodar de verdade. Por isso existe, em `packages/db`, uma atribuicao
`Prisma.UserSelect` que nao gera codigo e transforma essa divergencia em erro
de `npm run typecheck`.

O nome e **Olimpo** (`OLIMPO` / `OLIMPO PRO`), e mora em `rotulo`, separado do
`tier`. A separacao ja provou o valor: o nome passou por "AETHER+", "VIP" e um
terceiro antes de virar Olimpo, e nenhuma dessas trocas encostou no banco —
o enum continua `FREE/PLUS/PRO`.

Por que Olimpo: Aether e um deus primordial grego, e o Olimpo e onde ficam os
deuses — mesma familia do nome do app, e legivel na hora em portugues.

Duas coisas descartadas por motivo, e nao por gosto: um nome de elemento da
tabela periodica nasceria parecendo copia do Nitro do Discord — e o elemento
cogitado e material de bomba, que nao e a associacao que se quer vender;
**Prisma** casaria com os beneficios cosmeticos, mas o projeto USA o Prisma
como ORM e ficariam dois no mesmo repositorio.

O selo e um chip pequeno em maiusculas — nome longo nao cabe ali. Vale lembrar
disso no dia de trocar de novo.

### Limitacoes que ficaram — leia antes de vender

- **NADA e barrado ainda.** Esta fase entrega o plano e a leitura; os presets
  de tela continuam livres e o limite de envio nao existe. Cobrar hoje seria
  vender o que nao esta trancado.
- **O gate da TELA nao pode ser so na interface, e isso e trabalho de verdade.**
  A qualidade e escolhida no cliente (`screenShareEncoding` no `publishTrack`),
  e o token do LiveKit controla QUEM publica e quais fontes — nao bitrate nem
  resolucao. Esconder o preset na tela seria decorativo: bastaria editar o
  `localStorage`. O enforcement real exige o gateway receber o webhook
  `track_published`, ler a resolucao publicada e derrubar quem excede — com uma
  janela de alguns segundos ate isso acontecer.
- **"Envio premium" nao tem o que limitar.** Nao existe anexo em mensagem no
  app: os unicos uploads sao icone de servidor e avatar. Os 25/250/1024 MB da
  tabela nao governam nada hoje — anexos sao uma fase inteira antes de virarem
  recurso pago.
- **"Som da tela" esta LIVRE nos tres planos, de proposito.** Foi pedido como
  exclusivo de premium, mas hoje todo mundo tem. Tirar de quem ja usa e
  decisao de produto com custo real de confianca, e nao passa por um commit
  silencioso.
- **"Multiplas transmissoes" tambem nao existe.** Uma pessoa transmite uma tela
  de cada vez; o numero na tabela e o teto de quando o recurso existir.
- **O selo nao aparece na VOZ nem na tela de amigos.** Esta na lista de
  membros, no autor da mensagem e no cartao de perfil; o painel de voz e a
  lista de amigos ja recebem o dado (vem no mesmo `PublicUser`), mas nao o
  desenham. Faltou escopo, nao dado.
- **Dono do servidor com plano PRO mostra duas coroas.** A do plano e a de
  dono usam o mesmo icone. O selo e uma pilula com borda e a de dono e um
  icone solto, o que separa os dois papeis, mas lado a lado ainda compete.
- **Sem cobranca e sem tela de assinatura.** Nao ha como comprar: so chave e
  concessao a mao.
### Cosmeticos: moldura de avatar e avatar animado

O CATALOGO DE MOLDURAS MORA EM CODIGO (`packages/shared/src/cosmeticos.ts`), e
o banco guarda so o id escolhido (`User.molduraId`). Mesmo desenho de `PLANS`:
a escada e codigo, a assinatura e banco. Guardar CSS em linha de banco faria o
visual do app virar dado editavel, com tudo que isso traz.

O VISUAL fica separado, em `apps/web/src/components/ui/molduras.ts`, e a razao
e concreta: o Tailwind so gera classe que encontra escrita nos arquivos que
varre, e ele NAO varre `packages/shared`. Classe declarada la nao existiria no
CSS final, e o defeito apareceria como "a moldura nao aparece", sem erro nenhum
para seguir. Verificado depois: as cinco classes de gradiente estao no CSS
servido.

O anel fica ATRAS do avatar e um pouco maior. O miolo e coberto pela propria
imagem, entao so a beirada aparece — assim a moldura nunca corta nem deforma a
foto, e gradiente sai de graca. Acompanha os DOIS formatos, porque o app usa
`rounded-md` na maioria das telas e `rounded-full` so em amigos.

MOVIMENTO E DECIDIDO PELOS BYTES, nunca pela extensao. Travar apenas o GIF
deixaria o buraco: WEBP anima pela flag ANIM do bloco VP8X e PNG anima como
APNG (bloco `acTL`). Quem nao paga subiria um WEBP animado e a exclusividade
viraria enfeite, sem erro nenhum. GIF conta como animado sempre, inclusive de
um quadro so — contar quadros exigiria um parser que, errando, erra para o lado
de liberar.

**PERDER O PLANO TRATA OS DOIS IGUAL: tira o que era do plano, sem destruir
nada.** A moldura para de desenhar e a escolha fica guardada; o avatar para de
animar e o arquivo animado fica. Reativar devolve os dois, sem novo envio.

Para o avatar isso exigiu um GEMEO PARADO, gerado no envio (`sharp`, primeiro
quadro, PNG) e guardado em `avatarEstaticoUrl`. A leitura escolhe entre os
dois, no mesmo `toPublicUser` onde a moldura ja resolvia.

Por que gerado no ENVIO e nao na leitura: converter a cada exibicao custaria
CPU por pessoa que abre uma lista de membros, e a conversao nao muda nunca
depois que o arquivo existe.

A primeira versao era assimetrica — o avatar seguia animando. Foi corrigido
porque cosmetico que nao expira nao e cosmetico de assinatura: seria assinar um
mes, enviar o GIF e cancelar. E apagar o arquivo, a outra saida, destruiria
dado da pessoa por causa de uma cobranca vencida.

- **Gerar o gemeo pode falhar sem derrubar o envio.** Se o `sharp` falhar, o
  avatar animado ja esta no ar e continua funcionando; o que se perde e a
  regra, nao o upload. Quem cair nesse caso segue animando sem plano ate
  reenviar.
- **O `sharp` agora e dependencia DECLARADA de `apps/web`.** Ele ja estava
  instalado, mas de carona — ninguem o declarava. Depender de hoisting faria o
  recurso quebrar em silencio no dia em que a dependencia de origem mudasse.
- **O bucket precisa concordar com o codigo.** O Supabase recusa tipo e tamanho
  NA ORIGEM: sem `scripts/configurar-buckets.mjs`, aceitar GIF de 10 MB no
  servidor nao adianta nada e o sintoma nao aponta para o bucket. `avatars` vai
  a 10 MB com GIF; `server-icons` fica em 2 MB sem GIF, porque ninguem pediu
  icone animado e ele aparece na barra lateral o tempo todo.
- **A troca so aparece para os outros no proximo carregamento deles.** Mesma
  limitacao ja anotada da foto de perfil: `revalidatePath` vale por sessao e
  nao ha evento de socket para isso. Vale para a moldura tambem.
- **Nao ha faxina do avatar antigo.** Trocar de foto deixa a anterior no bucket
  para sempre. Ja valia antes; com GIF de ate 10 MB, passa a custar mais.
- **Banner e badge nao existem.** A estrutura esta pronta — catalogo, resolucao
  por plano e o campo no `PublicUser` sao genericos —, mas nenhum foi
  construido.

### Recorte de avatar (zoom e posicao)

Antes, a foto ia direto para o servidor e o corte era o que o CSS
(`object-fit: cover`) decidisse — sempre o centro geometrico exato, sem
escolha nenhuma. Numa foto de retrato tirada na vertical, o centro geometrico
raramente e o rosto.

`account-tab.tsx` agora abre um passo de ajuste (`avatar-cropper.tsx`) entre
escolher o arquivo e enviar: arrasta para posicionar, um controle desliza o
zoom, e "Usar esta foto" desenha o que ficou dentro do quadro num canvas
512x512, virando o arquivo que de fato sobe. Sem biblioteca nova — Pointer
Events (mouse, caneta e toque de um jeito so) mais um `input[type=range]`.

A MATEMATICA DO RECORTE mora em `avatar-cropper-math.ts`, separada do
componente e sem tocar DOM: e o unico ponto facil de errar por um sinal
trocado — mover a foto para a direita na TELA precisa **subtrair** do centro
em espaço da imagem, nao somar, porque o ponto que fica no centro do quadro
recua para o lado oposto do centro da propria foto. Um sinal invertido nao
quebraria nada visivelmente durante o arrasto (a foto se move do jeito
esperado na tela); o arquivo salvo e que mostraria o lado errado da imagem.
So um teste percebe — `tests/unit/avatar-cropper-math.test.ts`, mutado a mao
trocando o sinal para confirmar que a suite de fato acusa.

**SO PARA IMAGEM PARADA.** Um avatar animado (GIF, ou WEBP/APNG animado —
`ehImagemAnimada`, movida para `@aether/shared` porque agora o CLIENTE
precisa da mesma resposta que o servidor, e nao so o storage) pula o recorte e
sobe do jeito que sempre subiu: um canvas so enxerga um quadro, e recortar
destruiria a animacao. E uma limitacao aceita, nao esquecimento — recortar
preservando animacao pediria decodificar e recodificar cada quadro, um
recurso bem maior que "deixar posicionar a foto".

A saida do recorte e sempre **JPEG a 92%**, nunca PNG: o peso de um PNG cresce
com o detalhe da imagem, e uma foto de verdade em 512x512 podia flertar com o
teto de 2MB. JPEG fica previsivelmente pequeno, e a perda e imperceptivel
neste tamanho.

- **Nao verificado com login de verdade.** Typecheck, build de producao e a
  suite (com mutacao no sinal do recorte) passaram; o gesto de arrastar e o
  resultado visual nao foram conferidos numa sessao logada nesta rodada.
- **Reabrir "Ajustar" comeca do centro, e nao de onde a pessoa deixou.** O
  botao reabre o recorte sobre a foto ORIGINAL (para nao recortar um recorte
  e perder nitidez a cada rodada), mas zoom e posicao nao sao lembrados entre
  aberturas.

### Sobre trocar o Supabase por S3

Para anexos, o custo que explode nao e guardar: e EGRESS, porque todo mundo
baixa o arquivo dos outros. Supabase cobra egress, e a S3 da Amazon tambem, e
caro. **Cloudflare R2 tem egress zero e API compativel com S3** — para este
caso e melhor que S3 ou Oracle.

A troca so faz sentido QUANDO os anexos existirem. Hoje o storage guarda icone
de servidor e avatar, que sao poucos e pequenos; migrar agora seria trabalho
sem retorno.

## Celular: a gaveta de navegacao

O app nasceu de tres colunas fixas, e num telefone isso nao fecha conta:

| coluna | largura |
| --- | --- |
| trilha de servidores | 64px |
| arvore de canais | 220px |
| **sobra para a conversa** | **91px** numa tela de 375 |

Nao e problema que se resolva apertando as colunas — tres paineis nao cabem.
O que muda e QUANTOS aparecem por vez: no celular as duas barras viram uma
GAVETA sobreposta, como no Discord.

O truque e `fixed`: tirando as duas do fluxo, o conteudo passa a ocupar a tela
inteira sozinho, sem precisar mexer no layout de desktop. Medido em 375px —
antes 91px para a conversa, agora 375.

**As duas metades usam o MESMO deslocamento** (`-284px`), e nao a largura de
cada uma. A trilha comeca em `left-0` e a arvore em `left-16`; deslocar cada
uma pela propria largura deixaria a borda direita da arvore exatamente em
64px, em cima da trilha. Elas nascem em ARQUIVOS DE LAYOUT DIFERENTES — a
trilha no layout de `/app`, a arvore no do servidor —, e por isso o estado
mora no `shell-store`: nao ha ancestral comum que seja componente de cliente.

Trocar de rota fecha a gaveta, preso ao `usePathname` em vez de a um `onClick`
por link: assim vale para canal, conversa e amigos, inclusive telas que ainda
nao existem.

Duas coisas que so apareceram medindo, e que a gaveta sozinha nao resolveria:

- **A barra de controles pedia 386px numa tela de 375** e saia 5px para cada
  lado, cortando o botao de camera. `w-max` cuida de nao esticar, mas nao de
  nao estourar. Com teto de largura, quem encolhe e o NOME (ja nascia com
  `min-w-0` e `truncate`) e os botoes ficam todos com os 32px — sao eles que
  se vem clicar ali.
- **Na tela de amigos, "Adicionar amigo" terminava em 495px**, 120 alem da
  tela. No celular o titulo sai (as abas ao lado ja dizem onde se esta) e o
  botao vira so o simbolo.

### Limitacoes que ficaram

- **A gaveta abre por botao, sem gesto de arrastar da borda.** E o que se
  espera num app de celular, e nao esta feito.
- **A tela de voz nao foi repensada para o celular.** Ela cabe, mas o palco de
  compartilhamento continua com proporcoes pensadas para tela larga — a
  miniatura fica pequena num telefone.
- **Testado em 375px e 1280px.** Entre 640 e 768 o layout ainda e o de
  celular, com a conversa em tela cheia; e uma escolha razoavel para tablet em
  pe, mas nao foi verificada num aparelho de verdade.

## Som da tela sem eco, e o botao de tela cheia

Duas regressoes do compartilhamento, com causas sem relacao entre si — e
nenhuma das duas no codigo que parecia culpado.

### O eco: o microfone da tela era o alto-falante inteiro

Quem assistia a uma tela compartilhada com som ouvia a propria voz voltando.

A causa nao era volume, mistura nem duplicacao de faixa: era **o que se
capturava**. `AUDCLNT_STREAMFLAGS_LOOPBACK` num endpoint captura tudo o que sai
daquele dispositivo — inclusive a call que o Aether esta tocando. Quem
compartilhava mandava de volta a voz das outras pessoas, atrasada. Nao ha
filtro que conserte isso; o que precisa mudar e a fonte.

O conserto e o loopback por PROCESSO do Windows 10 20H1 (build 19041), com
`PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE` apontando para o nosso
proprio PID. **A arvore importa, e nao so o processo**: no Chromium quem toca
audio e um utilitario FILHO do principal, entao excluir so o PID do main
deixaria o eco igualzinho.

Medido, e nao suposto — `apps/desktop/native/testar-exclusao.js` toca um WAV
num processo filho e compara duas janelas:

| modo | piso de silencio | com o WAV tocando | diferenca |
| --- | --- | --- | --- |
| exclusao (o certo) | 0,01386 | 0,01547 | **0,00162** |
| inclusao (contraprova) | 0,00000 | 0,07549 | 0,07549 |

A contraprova existe porque "capturar nada" tambem passaria num teste que so
olhasse o silencio. E `testar-sem-eco.js` cobre o outro lado: 4,00s continuos
de audio, com pico acima de zero — o som dos OUTROS programas continua indo.

**Recuo seguro:** falhando qualquer passo (Windows anterior ao 20H1, ativacao
recusada, aparelho escolhido a mao), voltamos ao loopback de dispositivo de
antes. O pior caso passa a ser o comportamento de hoje, nunca ficar sem som.
`format()` expoe `semEco` para o log dizer qual caminho pegou.

Duas armadilhas que custaram tentativa e ficaram anotadas no arquivo: a
ativacao por processo **nao pode acontecer duas vezes** (a segunda devolve
`0x8000FFFF`, com o `Start` respondendo sucesso e a captura entregando zero
bytes), e `ActivateAudioInterfaceAsync` mora em `mmdevapi.lib` — sem ela o
link falha com `LNK2001`.

### O eco que voltou, e o que ele ensinou

A primeira versao deste conserto passou em todos os testes e o eco continuou
em uso real. O motivo: os testes abriam UMA captura e fechavam.

O handler de ativacao pegava o cliente por `QueryInterface` e o destrutor nao
devolvia essa referencia. O objeto nunca morria, a ativacao por processo
ficava ocupada — e como o Windows so admite uma por processo, **da segunda
captura em diante** a exclusao falhava. Na versao com recuo silencioso, ela
caia no loopback de dispositivo, que devolve a call inteira.

Por isso o primeiro compartilhamento de cada sessao saia limpo e todos os
outros ecoavam, e por isso reiniciar o app "consertava": zerava a contagem.

`testar-repeticao.js` existe para isso — abre e fecha seis vezes e falha se
`semEco` cair em qualquer uma. Antes do conserto: 5 de 6 falhavam. Depois:
6 de 6 com exclusao.

**A licao vale alem deste arquivo:** um recurso que abre e fecha ao longo do
dia precisa de teste que ABRA E FECHE. Um teste de uma passagem so nao
distingue "funciona" de "funciona uma vez".

### A tela cheia: negada por uma lista, engolida por um `catch`

O botao parou de funcionar sem que o codigo dele mudasse uma linha — `git
log -L` na funcao mostra que ela esta intacta desde que foi escrita.

No Electron, o `Element.requestFullscreen()` da pagina passa pelo handler de
permissoes do processo principal como `"fullscreen"`. O handler foi apertado
junto com a correcao da camera e liberava so `media` e `display-capture`.
Negada, a promessa era rejeitada — e o botao fazia `.catch(() => undefined)`.

Sem erro, sem log, sem pista. **Silenciar um `catch` de API do navegador
economiza uma linha e custa a proxima investigacao inteira**; agora a recusa
vai para o `mediaLog`. A lista de permissoes virou uma constante usada pelos
DOIS handlers (o de pedido e o de verificacao), que respondem perguntas
diferentes sobre a mesma politica e divergiriam na proxima edicao.

### Limitacoes que ficaram

- **Sem a exclusao, NAO capturamos som nenhum.** O recuo para o loopback de
  dispositivo foi removido: ele mandava a call de volta para a call, e fazia
  isso em silencio. A tela vai muda e o app avisa. Entre tela sem som e
  conversa impossivel para todos, a escolha nao e dificil.
- **O eco entre duas pessoas foi confirmado em uso**, depois de duas rodadas:
  a primeira correcao passava nos testes e falhava na segunda captura de cada
  sessao (ver acima).
- **Windows anterior ao 20H1 continua com eco.** Ali nao existe loopback por
  processo, e o recuo e o comportamento antigo. Nao ha aviso na interface.
- **Escolher a saida de audio a mao desliga a exclusao.** A captura por
  processo nao e de um endpoint, entao as duas coisas nao se combinam: com
  aparelho escolhido, volta o loopback de dispositivo — e o eco junto.
- **A captura por processo ignora a saida padrao.** Isso e o esperado, mas
  muda o diagnostico antigo: trocar a saida do Windows deixa de influenciar o
  som da tela quando este caminho esta ativo.

## Supressao de ruido avancada (RNNoise)

Chave em Configuracoes > Voz e video, DESLIGADA por padrao: ela carrega ~1,9 MB
de WASM e roda um modelo a cada 10ms — cobrar isso de quem nao pediu seria
gastar bateria e banda por um problema que nem todos tem.

### Roda na THREAD DE AUDIO, nao na principal

O modelo executa dentro do `AudioWorklet`. A alternativa — worklet manda o
quadro para a pagina, ela processa e devolve — amarraria o audio ao event loop
do React: qualquer render longo viraria falha no som. E a defesa contra isso
seria um buffer grande, ou seja, latencia permanente cobrada de todo mundo para
proteger de um travamento ocasional.

Isso exigiu um passo de build (`npm run build:worklet`): `addModule` carrega
script CLASSICO, e o escopo do worklet nao tem `import`, `fetch` nem
`import.meta` — o pacote ESM do RNNoise nao carrega la dentro de jeito nenhum.
O esbuild monta um bundle autocontido com o WASM embutido, versionado em
`public/` para o dev e a Vercel nao dependerem de um passo extra.

### A escala de 16 bits e a parte que silencia tudo se errada

O RNNoise assume PCM de 16 bits; o WebAudio entrega float de -1 a 1. Passar o
float cru faz o modelo ver um sinal ~32000 vezes mais fraco, classificar tudo
como silencio e devolver silencio — o audio "funciona" e some, sem erro nenhum,
que e o modo de falha mais confuso possivel.

Por isso o teste nao e "carregou", e sim se ele DISCRIMINA. Medido em
`OfflineAudioContext`:

| sinal | atenuacao |
| --- | --- |
| parecido com voz (140Hz + harmonicos) | **-0,3 dB** |
| ruido branco | **-84,9 dB** |

84,6 dB de diferenca. Com a escala errada, os dois iriam a zero junto.

### Caminho de volta em toda falha

Se o worklet nao carregar, se o WASM for recusado, se o modelo falhar no meio:
`processedTrack` fica sem definir e o LiveKit publica o som CRU. O proprio
worklet tambem repassa a entrada intacta enquanto nao esta pronto. Perder a
supressao e um degrau; perder a voz e uma queda, e nenhuma melhoria de audio
vale calar alguem.

Usa `LocalAudioTrack.setProcessor` do proprio SDK, e nao troca de faixa na mao:
o LiveKit ja republica na reconexao e acompanha mudo e troca de aparelho —
fazer por fora obrigaria a reimplementar tudo isso, no trecho que ja custou
caro aqui (o caso do PRO X2).

### `wasm-unsafe-eval` na CSP

Foi preciso liberar, e vale saber o tamanho: `'wasm-unsafe-eval'` permite
COMPILAR WebAssembly e nada alem. Nao habilita `eval()`, `new Function()` nem
`setTimeout("string")` — para isso seria `'unsafe-eval'`, que continua fora de
producao. O unico binario que carregamos e o que empacotamos, do proprio
bundle; nao ha origem externa em `script-src` por onde entrar outro.

## Cara de aplicativo, e nao de pagina

O que mais denuncia "site" e a SELECAO DE TEXTO. Arrastar o mouse pintava de
azul o nome do canal, o rotulo da configuracao, o titulo da secao — coisas que
em nenhum app de desktop se selecionam. Discord e Fluxer nao fazem isso.

A interface inteira nasce `user-select: none`, e o CONTEUDO pede selecao de
volta com `select-text`. O contrario — marcar tudo que nao pode — daria errado
no primeiro componente novo que alguem escrevesse.

### O que continua copiavel, e por que

| o que | por que |
| --- | --- |
| texto da mensagem | e o unico jeito de citar alguem |
| `@nome-de-usuario` | **adicionar amigo aqui e por nome EXATO** — copiar e fluxo real, nao conveniencia |
| campo de digitar | sem isso nao da nem para corrigir o que se escreveu |

O nome de usuario e o caso que quase passou batido: num app onde a busca de
pessoas nao existe de proposito, tirar a copia do `@` quebraria o unico caminho
de adicionar alguem.

### Cursor

`cursor: default` no corpo — o cursor de texto (I) sobre um rotulo diz "isto e
um documento"; sobre um painel de configuracao, nao. Campo de digitar recupera
o cursor de texto, onde ele esta certo.

E botao e link passam a mostrar os DOIS a mao: o padrao do navegador da mao no
link e SETA no botao, dois controles clicaveis com cursores diferentes, o que
nao acontece em app nenhum.

Medido na tela: rotulo `none`/`default`, campo `text`/`text`, botao e link
`none`/`pointer`; e selecionar de verdade devolve texto na mensagem e no
usuario, e string vazia no nome de canal e de membro.

### Ctrl+K — trocador rapido

Pular para qualquer canal, servidor ou conversa sem tirar a mao do teclado. E
o atalho que mais faz o app parecer programa.

O INDICE VEM DO SERVIDOR (`server/actions/navegacao.ts`), e nao do que a tela
conhece: o cliente so recebe a arvore do servidor ABERTO, e um trocador que so
enxerga onde voce ja esta nao serve para nada.

**A permissao e calculada canal a canal**, com a mesma `getChannelPermissionMap`
que monta a arvore. Nao e detalhe: `getChannelPermissionMap` devolve TODOS os
sete canais do servidor de teste para o joao, inclusive os dois que negam
`@everyone` — quem os remove e o filtro `VIEW_CHANNEL`. Sem ele bastaria
digitar parte do nome para descobrir que existe um canal que voce nao pode ver,
justo o que o 404 do resto do sistema evita. As conversas passam por
`loadDmList`, que ja aplica bloqueio e amizade.

A lista recarrega a cada abertura, e nao uma vez so: canal criado ou amizade
desfeita mudam o indice, e cache eterno mostraria destino que nao existe mais.

### Clique direito

No navegador o botao direito abre "Recarregar" e "Ver codigo fonte" — nada
denuncia mais rapido que a coisa e uma pagina. Canal e mensagem agora respondem
com o menu do proprio app (`components/ui/context-menu.tsx`).

**So substituimos onde temos o que oferecer.** Bloquear o menu nativo no app
inteiro deixaria a pessoa sem "copiar" e sem nada no lugar — pior do que o menu
do navegador.

O menu nao tem acao propria: chama o que os botoes de passar o mouse ja
chamavam e obedece as mesmas `canEdit` / `canDelete`. Uma segunda lista de
acoes seria uma segunda regra de permissao. Em mensagem, "Copiar" respeita o
trecho marcado — com selecao copia a selecao, sem selecao copia a mensagem
inteira —, porque era isso que o menu nativo fazia.

A conta de posicao saiu de `voice-member-menu.tsx` e virou peca, para o proximo
menu nao ser uma terceira copia. Medido numa janela de 1280x720: cursor em
(1277,717) poe o menu em (1064,502); no canto superior esquerdo ele para na
folga de 8px; no meio da tela fica onde o cursor estava.

### Limitacoes que ficaram

- **O trocador nao tem historico nem ordem por uso.** A lista sai na ordem da
  arvore, entao o canal em que voce vive nao sobe sozinho. Digitar duas letras
  resolve na pratica, mas nao e o que o Discord faz.
- **O indice e montado por servidor, em serie.** Sao duas consultas por
  servidor (`loadMemberAccess` e os canais visiveis) a cada abertura. Com os
  poucos servidores de hoje nao aparece; com dezenas, apareceria.
- **O menu de contexto ainda nao cobre tudo.** Icone de servidor, membro da
  lista e area vazia do chat continuam sem menu proprio — nesses o menu do
  navegador continua abrindo.
- **Sem navegacao por setas dentro do menu de contexto.** Esc fecha e Tab anda
  pelos itens, mas seta para baixo nao percorre como em menu nativo. O
  trocador, esse, anda com as setas.
- **`voice-member-menu.tsx` nao foi migrado para a peca nova.** Ele funciona e
  tem o slider de volume; migrar agora era risco sem ganho. Enquanto nao for,
  existem duas implementacoes da mesma conta de posicao — a antiga so naquele
  arquivo.

## Paleta v2 (superficies, tipografia e acento)

Troca dos valores do `@theme` em `globals.css` para uma paleta de superficies
mais frias, tipografia de contraste alto e acento indigo (`#5865f2`).

Nenhum componente estrutural foi tocado: os 56 arquivos das doze pastas usam
token, entao a paleta chega a todos por um arquivo so. O `--altura-barra`
ficou intacto de proposito — ele precisa casar com o `titleBarOverlay` do
`main.js`, e mexer ali desalinharia os botoes do Windows.

### O contraste foi MEDIDO, e nao estimado

Paleta nova e onde texto some sem ninguem notar. Razao de contraste sobre o
fundo principal, antes e depois:

| texto | antes | depois | |
| --- | --- | --- | --- |
| ink-200 | 11.3 | **12.2** | melhorou |
| ink-300 | 5.7 | 5.9 | igual |
| ink-400 | 3.7 | **4.4** | melhorou |
| ink-500 | 2.3 | **2.8** | melhorou |
| ink-100 | 16.5 | 14.8 | caiu, irrelevante nessa faixa |

Branco sobre o acento da nova paleta da 4.61 — acima do minimo de corpo (4.5).

`ink-500` e `ink-600` seguem abaixo do minimo de leitura, como antes: eles sao
placeholder e rotulo de secao, texto de baixa enfase por definicao. O que
importa e que nao PIORARAM.

### O `danger` mudou de comportamento, e isso limpou codigo meu

A variante saiu de discreta (fundo translucido, texto colorido) para vermelho
solido. O `ConfirmDialog` tinha uma sobrescrita justamente para gritar, com um
comentario dizendo que a global era discreta "porque vive dentro de listas".

Essa justificativa nao se sustentava: `variant="danger"` aparece em TRES
lugares, todos confirmacao deliberada — quem vive em lista e o `IconAction`,
que nunca usou a variante. Com a global solida, a sobrescrita virou pior que
redundante: ela apagava a sombra e o `active:` da variante nova. Removida.

### Limitacoes

- **`#6B7280` continua fixo em dois lugares** (`member-panel.tsx` e
  `roles-tab.tsx`), como cor de cargo sem cor definida. A diferenca para o
  `base-500` da paleta nova e deltaE 3.55 — visivel, mas na fronteira. Um dos
  dois GRAVA NO BANCO (e a cor padrao de cargo novo), entao trocar criaria
  cargos novos diferentes dos antigos por algo que quase ninguem enxerga.
- **O verde `#68af64` do botao de atualizar segue fixo**, por ser uma escolha
  explicita e nao um token de tema.

## Teste de microfone (design v2)

`components/aether-design-v2/microphone-test.tsx` — medidor segmentado com 20
barras inclinadas de altura crescente e botao de iniciar/parar ao lado.

Substituiu o medidor que vivia solto dentro de `voice-tab.tsx`: **-93 linhas
la, +7**. O teste de microfone virou componente com contrato proprio
(`deviceId`, `onDeviceListRefreshed`, `colorScheme`) em vez de estado espalhado
na aba de configuracoes.

Reusa `startMicLevel` e `listMicrophones`, que ja existiam — o que mudou foi a
casca, nao a captura. E os tokens sao os do `@theme`: `base-750`, `signal-*`,
`shadow-panel`. Nada de cor solta.

### Limitacoes

- **A pasta se chama `aether-design-v2`**, que envelhece mal: nao diz o que tem
  dentro, e as outras doze pastas de `components/` sao nomeadas por dominio
  (`chat`, `voice`, `settings`). Se entrarem mais pecas de design ali, vale
  mover para junto dos pares.
- **O medidor so foi verificado sem microfone.** O painel do navegador de teste
  bloqueia captura, entao o que ficou provado e a estrutura (20 segmentos,
  altura 8→24px, inclinacao, botao) e o CAMINHO DE ERRO — pedir o microfone,
  ser recusado, mostrar a mensagem sem derrubar a tela. A reacao a som real
  ficou para o teste de uso.

## Bordinha de "falando" instantanea, e o painel de Conexao

### A bordinha acende na hora agora

Com SFU, o "estou falando" vinha do `RoomEvent.ActiveSpeakersChanged` do
LiveKit — que o SFU calcula NO SERVIDOR, a cada ~400ms, com histerese, para
responder "quem e o falante dominante". Otimo para destacar; ruim para a
bordinha: atraso visivel, e falas curtas nem chegavam a contar.

Agora a fonte local e um analisador NO NAVEGADOR sobre a propria faixa
publicada (`apps/web/src/lib/voice/room.ts`, `iniciarDetectorLocal`) — o
MESMO audio que os outros ouvem, sem ida ao servidor. Como o
`socket.emit("voice:speaking")` que vai para o nosso gateway sai desse
detector, a bordinha acerta tambem para quem esta olhando um canal em que
nem entrou.

A decisao "falando / silencio" mora em `speech-gate.ts`, pura e testada
(`tests/unit/speech-gate.test.ts`):

- **ataque imediato** — abre na amostra em que a energia cruza o limiar,
  sem esperar N amostras de confirmacao (era isso que perdia as falas
  curtas);
- **piso de ruido adaptativo** em vez do limiar fixo `0,02` — que ficava bem
  em cima da voz normal (0,02–0,15 de RMS). O piso e aprendido so em
  silencio e nunca jogado fora;
- **release de 220ms** para nao piscar nas pausas entre palavras;
- **aquecimento** de ~6 amostras em que so aprende o ruido — na pratica ja
  passou quando a primeira palavra sai, porque o analisador roda desde que a
  pessoa entra na call.

O `ActiveSpeakersChanged` continua ligado como RESERVA: se o Web Audio nao
inicializar, ele volta a ser a fonte.

`voice-activity.ts` (caminho SEM SFU) foi reescrito para compor os mesmos
`mic-analyser.ts` + `speech-gate.ts` — a bordinha acende igual nos dois
caminhos.

### Painel de Conexao (ping)

Botao de sinal no cabecalho do canal de voz (so aparece para quem esta na
call). Abre um popover com regiao, ping medio, ultimo ping, perda de pacotes
enviados e um grafico das ultimas ~2 min.

- **Ping e perda vem de `LocalAudioTrack.getSenderStats()`** — que le o
  `remote-inbound-rtp`, ou seja, o que o SFU RELATA ter recebido de nos. E o
  RTT real da nossa midia ate o servidor.
- **Regiao:** `room.serverInfo.region`.
- **Qualidade** (excelente/boa/ruim): o julgamento do proprio LiveKit
  (`ConnectionQualityChanged`), que pesa mais coisas que so o ping.
- **"Depuracao"** liga o `?debug=media` que ja existia (recarrega com o log
  verboso do SFU).
- **"Copiar diagnostico"** poe um JSON (stats + user agent) no clipboard —
  nao ha endpoint para "enviar registros" ainda.

### Limitacoes

- **Nao e ponta a ponta.** A midia e cifrada no transporte (DTLS-SRTP) ate o
  SFU, que a decifra para reencaminhar. O painel diz "conexao criptografada",
  e nao "de ponta a ponta" — copiar o texto do Discord aqui seria mentira.
  E2EE de verdade exigiria `insertable streams` e troca de chave, que e obra
  a parte.
- **A bordinha nova nao foi verificada em call real nesta maquina** — nao ha
  gateway nem LiveKit local aqui, e o `.env` aponta para o banco de
  producao. O que esta provado: a porta de fala por teste unitario (8
  casos), o typecheck, o build, e o caminho de voz no CI de integracao
  (`verify-phase4/5`). A reacao a som real e a latencia percebida ficam para
  o teste de uso.
- **O detector local so mede a PROPRIA fala.** A bordinha dos outros
  participantes continua vindo do `voice:speaking` que CADA cliente emite —
  ou seja, todo mundo passa a ter o detector novo, mas um cliente antigo (ou
  o caminho de reserva) ainda dependeria do `ActiveSpeakersChanged`.
- **O ping e so da faixa de MICROFONE.** Sem microfone publicado (surdo, ou
  sem permissao de fala), o painel mostra so a regiao e a qualidade — RTT e
  perda ficam em branco.
- **A perda de pacotes e da janela de 2s entre amostras**, nao acumulada:
  uma rajada de perda entre duas amostras some do numero exibido, mas
  aparece no grafico como um pico de ping.

## CI (GitHub Actions)

`.github/workflows/ci.yml` roda a cada push no `master` e em todo PR, com dois
jobs:

- **`verificar`** — `npm ci`, `prisma generate`, os dois typechecks e os testes
  unitarios. ~80s, sem servico nenhum. E o job rapido, o candidato a "required"
  quando houver branch protection (fase 7e).
- **`integracao`** (fase 7d) — sobe Postgres, Redis e um proxy REST-Upstash
  como servicos, semeia, poe o gateway e o app web no ar e roda a bateria de
  `scripts/verify-*` inteira via `scripts/verify-all-ci.mjs`. Alguns minutos.

**Por que existe.** Os testes rodavam so quando alguem lembrava. Isso vale para
qualquer teste, mas doi mais em um: `tests/unit/rate-limit-chave.test.ts` existe
para quebrar se `take(socket.id)` voltar ao gateway. Um guard que depende de
memoria humana nao e um guard.

O job `verificar` nao ve segredo: os testes unitarios nao tocam banco e o
`prisma generate` so precisa da variavel DEFINIDA para ler o schema. O
`integracao` tambem nao — Postgres e Redis sao efemeros, o `AUTH_SECRET` e um
valor de teste, e o LiveKit e falso (o gateway assina o token de midia com uma
chave qualquer e o `verify-phase4` confere a assinatura com a MESMA chave; o
SFU real nunca entra no caminho).

### Como o `integracao` monta o cenario

- **`scripts/seed-ci.mjs`** roda depois do `db:seed` e acrescenta o que os
  scripts precisam e o seed minimo nao da: um terceiro usuario (`maria`), uma
  amizade `ryan`<->`joao` aceita, e um "Servidor Alheio" do qual `ryan` e
  `joao` nao sao membros. Sem isso, varios `verify-*` se auto-pulam em
  silencio — cobertura fantasma num CI.
- **`scripts/verify-all-ci.mjs`** orquestra: sobe gateway + web, roda cada
  script em ordem e, depois dos que MODERAM de verdade (`verify-phase6` e
  `verify-phase7b` expulsam/banem/trocam cargo do `joao`), chama
  `restore-fixture.mjs` antes de seguir.
- **`SESSION_GUARD_INTERVAL_MS`** (so no CI) baixa o ciclo do guarda de sessao
  de 30s para 3s — senao o `verify-phase7b` sozinho custaria 40s. Producao
  nunca define a variavel; o default e o de sempre.
- A migracao `20260823000000_rls_e_revoke` faz `REVOKE ... FROM anon,
  authenticated` — papeis que so o Supabase cria. O job os cria VAZIOS antes de
  migrar, e ai o REVOKE vira no-op.

### O que o CI ainda NAO cobre

- **O build do desktop.** O modulo nativo do som e C++ compilado contra os
  headers do Electron para Windows, e o runner e Linux. (fase 7e)
- **`verify-igdb-live` e os `*-live` com credencial externa.** O `verify-igdb`
  (sem `-live`) roda e cobre o fallback + o cache; a variante live precisa do
  par da Twitch.
- **Gateway em mais de uma instancia real.** O `verify-gateway-redis` prova o
  estado 7c-2 entre dois processos, mas as phases 3-7b rodam contra um gateway
  so. Dois gateways atras de um balanceador e a fase 7e.
- **`verificar-redis` depende do proxy `hiett/serverless-redis-http`.** Se o
  container do proxy ficar instavel, esse script e o unico que cai junto — os
  outros nao dependem dele.

### Falha conhecida: `verify-phase5` (2 assercoes)

O job de integracao roda o `verify-phase5`, mostra a saida inteira, mas **nao
derruba a build por causa dele** (lista `CONHECIDAS` em `verify-all-ci.mjs`).
Duas assercoes falham, as duas sobre um canal de voz com overwrite de
`deny: SCREEN_SHARE` no cargo padrao:

- "sem SCREEN_SHARE, o indicador NAO acende nem mentindo pelo socket"
- "trocar de canal encerra a transmissao"

**O que se sabe:** o MESMO overwrite de `SCREEN_SHARE` e barrado corretamente
no token do `verify-phase4` ("sem SCREEN_SHARE, a fonte de tela nao esta no
token" passa) — entao `getChannelPermissions` calcula certo, e o defeito esta
no caminho do handler `voice:streaming` (ou na leitura de `voiceLocation` logo
antes dele), nao no calculo de permissao. O script nunca tinha rodado em
ambiente automatizado (nao ha contagem dele no README nem no DEPLOY), entao
nao da para dizer se e regressao ou se sempre foi assim. Em investigacao.

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

## FASE 7c-2 — presenca e voz no Redis, e o adapter do Socket.IO

A divida que a propria 7c-1 ja apontava: "presenca, ocupacao de voz e o
adapter do Socket.IO continuam em memoria... e a parte que de fato destrava a
segunda maquina de gateway". Esta fase entrega essa parte — o CODIGO fica
pronto para mais de uma instancia; ligar de verdade (`fly scale count 2`)
continua sendo um passo manual, feito quando o Redis estiver provisionado em
producao.

### O desenho: uma interface, dois backends

`apps/realtime/src/state.ts` deixou de SER o estado e passou a ESCOLHER onde
ele mora: `state-memory.ts` (os `Map` de sempre, so com `async` na
assinatura) ou `state-redis.ts` (novo), conforme `REDIS_URL` estar
configurada. As duas implementam `StateStore`
(`apps/realtime/src/state-store.ts`), e o resto do gateway continua
importando `from "./state"` exatamente como sempre importou — so que agora
com `await`. **Sem `REDIS_URL`, o comportamento e IDENTICO ao de antes desta
fase**, nao uma versao degradada dele.

### Por que TCP (`ioredis`), e nao a API REST que o resto do projeto usa

`packages/shared/src/redis.ts` fala com o Upstash por HTTP porque o app web
roda em funcao SERVERLESS — conexao TCP persistente ali estoura o pool a
cada cold start. O gateway NAO tem esse problema: e processo de vida longa na
Fly. E ele PRECISA de TCP mesmo assim, porque REST nao da pub/sub, e o
adapter do Socket.IO (`@socket.io/redis-adapter`) e a propria forma de
`SADD`/`HSET` numa conexao persistente dependem disso. Por isso `REDIS_URL` e
uma variavel SEPARADA de `UPSTASH_REDIS_REST_URL`/`_TOKEN` — vem da aba
"Redis Connect" do Upstash, nao da aba "REST API", e so o gateway a usa.

### Onde Lua entrou, e onde nao entrou

So em DOIS lugares: entrar e sair de um servidor
(`JOIN_SERVER_LUA`/`LEAVE_SERVER_LUA` em `state-redis.ts`), porque so ali a
decisao "isto fez a pessoa FICAR PRESENTE agora" precisa ser atomica — duas
pessoas entrando no MESMO servidor ao mesmo tempo, em instancias diferentes,
e um caso real, e so um dos dois HINCRBY pode "ver" o contador virar 1. O
resto (trocar status, falar, mutar, mover) e sempre uma pessoa agindo sobre
si mesma ou um moderador agindo sobre UM alvo — a mesma serializacao que a
versao em memoria ja tinha de graca, so que aqui vem de nao haver dois
clientes mandando o mesmo evento no mesmo milissegundo, nao de o Redis
garantir isso sozinho. Documentado como risco aceito, no comentario de cada
funcao que faz GET+SET em vez de Lua.

### Tres lugares que dependiam de socket LOCAL, e paravam de funcionar com uma segunda maquina

`io.sockets.sockets.get(socketId)` e `io.sockets.adapter.rooms.get(sala)` so
enxergam sockets desta instancia — nunca eram um bug enquanto so havia uma
maquina, porque "local" e "todo mundo" eram a mesma coisa. Tres pontos
dependiam disso e foram corrigidos para os metodos do PROPRIO Socket.IO que
atravessam instancia (com o adapter de Redis, e sem ele tambem — degradam
para o mesmo comportamento local de sempre):

- **`evict()`** (`internal.ts`, kick/ban/exclusao de servidor) — trocou
  `socketIdsOf` + `sockets.get` por `io.in(room.user(id)).fetchSockets()` +
  `socketsLeave(...)`. Sem isso, expulsar alguem conectado na OUTRA maquina
  nao tirava a pessoa de lugar nenhum.
- **`resyncServerRooms()`** (`rooms.ts`, cargo editado/canal virou privado) —
  trocou a leitura direta do adapter por `io.in(sala).fetchSockets()`. Sem
  isso, so quem estivesse na MESMA maquina que processou a mudanca de
  permissao seria recalculado.
- **`voice:move`** (`handlers/voice.ts`, moderador move alguem de canal) —
  trocou a busca do socket alvo (`io.sockets.sockets.get`) por
  `io.to(room.user(alvo)).emit(...)`, usando o `PublicUser` que ja vinha
  gravado na propria ocupacao de voz em vez de o ler do socket. Sem isso,
  mover alguem conectado na outra maquina respondia "essa pessoa saiu da
  call" — falso.

### O que NAO tem: limpeza por TTL

Uma queda GRACIOSA (o `shutdown()` que ja existia, o que `fly deploy` faz
numa atualizacao normal) dispara o `disconnect` de cada socket e o Redis fica
limpo — mesma garantia de sempre. Uma queda NAO graciosa (OOM, `fly machine
kill`) deixava a memoria simplesmente sumir junto com o processo; no Redis,
a entrada fica para tras ate alguem notar. Nao implementado nesta rodada —
ficaria como TTL renovado a cada escrita, e exigiria decidir um numero sem
dado de producao para calibrar. Registrado aqui, nao escondido.

### Como testar

```bash
# unidade: state.ts sem Redis nenhum (o padrao, sem REDIS_URL no .env)
npx vitest run tests/unit/voice-activity.test.ts

# integracao: duas conexoes Redis + dois servidores Socket.IO de verdade,
# simulando duas maquinas de gateway. Sobe um Redis local por conta propria
# (`redis-server`) ou aponte REDIS_URL para um de teste — NUNCA para o de
# producao com dados reais.
npx tsx scripts/verify-gateway-redis.mts
```

O segundo prova, contra Redis real (nao dublado): presenca e voz escritas por
uma conexao aparecem na outra; a corrida de duas entradas simultaneas do
MESMO usuario no MESMO servidor resolve para exatamente uma "ficou presente";
`io.to(sala).emit()`, `fetchSockets()` e `socketsLeave()` atravessam duas
instancias de verdade. Rodado nesta sessao contra Redis local: 16/16.

Tambem verificado nesta sessao: o gateway sobe e responde `/health` nos dois
modos (com e sem `REDIS_URL`), typecheck limpo em todos os workspaces, e os
348 testes unitarios existentes continuam passando.

### Limitacoes conhecidas desta fase

- **Nao verificado contra DUAS MAQUINAS DE FLY DE VERDADE**, so contra dois
  processos locais falando com o mesmo Redis. O `fly.toml` continua com
  `min_machines_running = 1` — subir para 2 e um passo manual futuro, so
  depois de rodar assim em producao por um tempo com uma maquina so (para
  confirmar que nada regrediu) e so entao escalar.
- **Sem TTL/limpeza automatica**, como explicado acima — uma queda nao
  graciosa deixa fantasma no Redis ate reiniciar o processo (que hoje nao
  limpa o que sobrou de uma execucao anterior, so o que a PROPRIA execucao
  cria).
- **`presenceOf`/`voiceOfServer`/`presenceOfFriends` fazem uma consulta em
  pipeline por servidor/lista**, nao uma so para tudo — aceitavel na escala
  atual (grupo de amigos, nao milhares de pessoas por servidor), mas e o
  primeiro lugar a otimizar se isso crescer.
- **A revalidacao de sessao (`session-guard.ts`) continua olhando so os
  sockets LOCAIS de cada instancia** — e o comportamento CERTO (cada
  instancia so precisa revalidar quem esta conectado nela mesma), mas vale
  registrar que nao foi tocada nesta fase por nao precisar ser.
- **Nenhum numero de producao ainda.** Os testes provam a CORRETUDE do
  mecanismo; nao ha medicao de latencia real de `HGETALL`/pipeline num Redis
  do outro lado do Atlantico sob carga de uso de verdade.

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
- **A semantica do Lua so e provada pelo `scripts/verificar-redis.mts`.** Os
  doze testes de `rate-limit-redis.test.ts` dublam o `fetch` e cobrem o
  CONTRATO (um EVAL atomico, prefixo de chave, autenticacao, e as tres formas
  de falha). O algoritmo em si e testado contra a implementacao em memoria,
  que espelha a mesma regra. Um duble que interpretasse Lua estaria testando o
  duble — por isso a prova do interpretador ficou num script separado, que
  precisa de um Redis de verdade para rodar. E o mesmo desenho do R2: `fetch`
  de servidor ignora CORS, e la o teste em Node passava enquanto o navegador
  era bloqueado.
- **`rateLimit()` virou assincrona.** Os cinco pontos de chamada ganharam
  `await`. O custo de uma ida ao Redis por tentativa de login e irrelevante
  perto do scrypt que vem logo depois.
- **Presenca, ocupacao de voz e o adapter do Socket.IO continuam em memoria.**
  E a 7c-2, e e a parte que de fato destrava a segunda maquina de gateway. O
  `fly.toml` segue com `min_machines_running = 1` por isso.
- **O `redisEval` estava QUEBRADO desde a 7c, e ninguem podia saber.** Ele
  fazia `POST /eval` com o corpo `[script, numkeys, ...]`. O Upstash quer o
  comando na RAIZ, com `"EVAL"` como primeiro elemento do array, e responde
  aquela forma com `HTTP 400 ERR wrong number of arguments`. Ou seja: com o
  Upstash provisionado e sem esta correcao, todo login cairia no fail-open
  (nenhuma protecao, em silencio) e **nenhum handshake do gateway passaria**,
  porque o ticket e fail-closed. Um apagao.

  O teste dublado nao so deixou passar: ele FIXAVA a forma errada, afirmando
  `url === ".../eval"` com conviccao. Passou doze vezes sobre codigo que nunca
  funcionou. E o lembrete de que um duble confirma o que nos mandamos, nunca o
  que o servidor aceita.
- **`verificar-redis.mts` e `.mts`, e nao `.mjs` como os outros.** Foi
  deliberado: assim ele importa `limitarJanelaDeslizante` e
  `consumirTicketUnico` de `@aether/shared` e exercita o codigo que roda em
  producao, em vez de uma copia do Lua que divergiria na primeira mudanca.
  Roda por `tsx`, o mesmo que ja executa o gateway.
- **Verificado contra um Upstash real (sa-east-1), 10/10.** O Lua roda, o
  limite limita, a tentativa recusada nao entra no conjunto, a janela desliza,
  e dez consumos simultaneos do mesmo ticket deixam exatamente um passar.
  Confirmado tambem de ponta a ponta: o login grava `ratelimit:login:<ip>` e a
  fase 3 (43/0) consome os tickets pelo Redis, nao pela memoria.

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
