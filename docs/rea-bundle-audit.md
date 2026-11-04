# Aether — auditoria do que é distribuído, com REA (01/11/2026)

Complementa [aether-audit.md](aether-audit.md). Lá os pontos do desktop saíram
da leitura do código-fonte; aqui eles foram conferidos **no artefato que o
usuário de fato recebe**, com o REA 6.8.0 (MCP `rea`). Gravidade no mesmo
critério de [aether-roadmap.md](aether-roadmap.md) (P0 crítico · P1 essencial ·
P2 experiência/defesa em profundidade · P3 higiene).

Tudo é **análise estática**: nada foi executado, nada de Frida/CDP/captura, nada
tocou o banco. Ghidra/IDA/JADX/Kuna não estão instalados (de propósito); por isso
o módulo nativo `aether_loopback.node` **não** foi desmontado.

Legenda: **[fato]** = observado no artefato, com arquivo/offset ·
**[hipótese]** = inferência que o REA não prova.

---

## 0. O que foi analisado

| Artefato | Caminho | Identidade |
| --- | --- | --- |
| App instalado (0.1.30) | `%LOCALAPPDATA%\Programs\Aether\` | `Aether.exe` sha256 `be57b65a…f0f1a9` (244 776 448 B) |
| `app.asar` instalado | `…\Aether\resources\app.asar` | sha256 `22593c1c…29b761` |
| `app.asar` do build local | `apps/desktop/dist/win-unpacked/resources/app.asar` | **mesmo sha256** — o instalado é este build |
| Instalador | `apps/desktop/dist/Aether-Setup.exe` | sha256 `59106c2a…a6ad02` (111 739 158 B), `latest.yml` 0.1.30, 14/09/2026 |
| Build web | `apps/web/.next` | **build de desenvolvimento**, não de produção (ver §3) |

- **[fato]** Os 11 arquivos de `src/` extraídos do asar pelo REA (`extract_artifact`,
  268 arquivos, cobertura `complete`) são **byte a byte iguais** a
  `apps/desktop/src` no `master` (`diff -rq` sem saída; último commit em
  `apps/desktop/src`: `659283c`, 14/09). Ou seja: os números de linha de
  `main.js` citados em `aether-audit.md` valem para o binário distribuído.
- **[fato]** Versões embutidas no `Aether.exe`: `Electron/44.0.0`,
  `Chrome/152.0.7977.54` (strings no binário).
- **[fato]** O asar contém só `src/`, `native/index.js`,
  `native/build/Release/aether_loopback.node`, `package.json` e o
  `node_modules` de produção do `electron-updater@6.8.9` (16 pacotes).

---

## 1. Achados por gravidade

### P0

**P0-A. Auto-update baixa e executa instalador sem nenhuma verificação de assinatura.** *(confirma §4 item 3 / roadmap P0-4)*
- **[fato]** `Aether.exe` e `Aether-Setup.exe` não têm
  `IMAGE_DIRECTORY_ENTRY_SECURITY` (REA `inspect_pe_certificates`, cobertura
  `complete`, 0 entradas). Não há Authenticode embutido.
- **[fato]** `resources/app-update.yml` instalado tem só
  `owner: ryanrn / repo: aether-releases / provider: github /
  updaterCacheDirName` — **sem `publisherName`**.
- **[fato]** No `electron-updater` distribuído,
  `node_modules/electron-updater/out/NsisUpdater.js:84-99`
  (`verifySignature`): se `publisherName == null`, retorna `null` = "ok" e a
  checagem de assinatura é **pulada**. A única proteção que sobra é o
  `sha512` do `latest.yml`, que vem **do mesmo release** que o `.exe` —
  quem publica um, publica o outro.
- **[fato]** `src/updater.js:77-78`: `autoDownload = true`,
  `autoInstallOnAppQuit = true`; checa 8 s após abrir e a cada 6 h
  (`:24-26`, `:205-206`). O instalador é NSIS per-user, então roda sem UAC.
- **Consequência [hipótese, mas direta]:** quem obtiver escrita em
  `github.com/ryanrn/aether-releases` (token vazado, conta sem 2FA, CI
  comprometido) executa código em **todas** as máquinas com o app no próximo
  fechamento, sem prompt. É o caminho de maior alcance de todo o produto.
- **Correção (já no roadmap P0-4):** certificado + `publisherName`; até lá,
  no mínimo 2FA/fine-grained token só para o repo de releases e
  `autoInstallOnAppQuit = false`.

### P1

**P1-A. `shell.openExternal` aceita qualquer esquema.** *(confirma §2.2 item 4 / §4 item 4)*
- **[fato]** `src/main.js:630-633` (`setWindowOpenHandler` → `openExternal(url)`
  sem filtro), `:635-639` (`will-navigate`), `:652-656` (`will-redirect`), e
  **um quarto ponto que a auditoria não listou**: `:868-871`, o
  `setWindowOpenHandler` da janela de OAuth.
- **[fato]** Mitigação parcial no web: links em mensagem só viram `<a>` para
  `http(s)://` (`apps/web/src/components/chat/texto-de-mensagem.tsx:6-7`).
  Então **mensagem de chat sozinha não dispara** `file:`/`ms-msdt:`/`search-ms:`.
- **[hipótese]** Vetores restantes: (1) XSS ou deploy comprometido na origem;
  (2) a janela de OAuth carrega páginas de **terceiros** (Spotify/Twitch…),
  que não têm guarda de `will-navigate` e cujo `window.open` cai em
  `openExternal` sem filtro (`:868`); (3) qualquer open redirect na origem
  passando pelo `will-redirect`.
- **Correção (roadmap P1-11):** um `abrirFora(url)` único que só aceita
  `https:`/`http:`/`mailto:`, usado nos quatro pontos.

**P1-B. Nenhum handler de IPC valida o remetente.** *(item novo; reforça P1-11)*
- **[fato]** REA `analyze_javascript_application` sobre o asar: 24 handlers no
  main, 28 canais literais, 2 `contextBridge` com **38 membros expostos**,
  `sender_validation_observations: 0`. `grep senderFrame` no `src/`: 0.
- **[fato]** Canais e o que fazem (`preload.js` → `main.js`/`loopback-ipc.js`/`updater.js`):

  | Canal | Efeito no main | Validação de argumento |
  | --- | --- | --- |
  | `desktop:loopback-start` | **liga captura do áudio do sistema** e manda PCM à página a cada tick (`loopback-ipc.js:91-151`) | só `typeof deviceId` |
  | `desktop:iniciar-com-windows-set` | grava autostart no registro (`main.js:527-538`) | `=== true` |
  | `desktop:game-detection-set` / `desktop:jogos-candidatos` | liga leitura de processos / devolve nomes (`:540-546`, `:495-502`) | `=== true` |
  | `desktop:jogos-catalogo-set` | grava JSON arbitrário em `userData/jogos-comunidade.json` (`:476-480`) | nenhuma (tamanho livre) |
  | `desktop:conexao-connect` | abre janela com a **sessão compartilhada** (`:842-905`) | regex estrita `^/api/(spotify/connect\|conexoes/[a-z]+/connect)$` ✔ |
  | `desktop:atualizacao-instalar` / `-verificar` | `quitAndInstall` / checa update (`updater.js:167-195`) | — |
  | `desktop:audio-capture-failed`, `deep-link-*`, `game-*`, `atualizacao-*` (leitura) | estado/leitura | — |

- **[fato]** O `preload` só roda no frame principal (sem
  `nodeIntegrationInSubFrames`), e `contextIsolation: true` — iframes não
  alcançam a ponte. Por isso a ausência de `senderFrame` hoje **não** é
  explorável por um iframe de terceiro.
- **[hipótese]** O risco real é o mesmo do P1-A: qualquer script rodando na
  origem (XSS, dependência comprometida no bundle web, deploy indevido) ganha
  **captura silenciosa do som do sistema** (`loopback-start` não exige que o
  seletor tenha sido aberto, e o Windows não mostra indicador para loopback),
  autostart e enumeração de processos. A validação `senderFrame.url` contra
  `APP_ORIGIN` é barata e fecha o caso "página fora da origem chegou a rodar
  na janela".
- **Correção:** helper `deOrigemConfiavel(evento)` checando
  `new URL(evento.senderFrame.url).origin === APP_ORIGIN` em todo handler;
  `loopback-start` só depois de uma escolha com áudio no seletor; limite de
  tamanho em `jogos-catalogo-set`.

**P1-C. `sandbox: false` — e a justificativa no comentário não procede.** *(confirma §2.2 item 10 / §4 item 4)*
- **[fato]** `src/main.js:598`, janela principal. O comentário (`:589-593`)
  diz que com sandbox o preload "roda num contexto sem `require`". O próprio
  asar mostra o contrário: `src/picker/preload.js:3` usa
  `require("electron")` (`contextBridge`, `ipcRenderer`) numa janela **sem**
  `sandbox` explícito (`picker.js:241-245`) — portanto sandboxada pelo padrão
  do Electron ≥ 20 — e funciona. Preload sandboxado tem `require` limitado
  que inclui exatamente esses módulos.
- **[fato]** O `preload.js` principal só usa `contextBridge`, `ipcRenderer`,
  `process.env` e `process.platform` — todos disponíveis no preload
  sandboxado. **[hipótese]** `sandbox: true` deve funcionar sem mudar o
  preload; precisa de um teste manual.
- **[fato, menor]** `preload.js:20` lê `process.env.npm_package_version`;
  essa variável só existe quando o app sobe via `npm`. **[hipótese]** No app
  instalado, `aetherDesktop.version` é sempre `"0.1.0"`.

**P1-D. Fuses do Electron todos no padrão de fábrica.** *(item novo; reforça P1-11)*
- **[fato]** REA `inspect_electron_fuses`, `Aether.exe`, sentinela no
  offset `198292568` (0xBD1B758), wire v1, 9 fuses, completo:

  | Fuse | Estado | Implicação |
  | --- | --- | --- |
  | `RunAsNode` | **ligado** | `ELECTRON_RUN_AS_NODE=1 Aether.exe x.js` vira um `node.exe` |
  | `EnableNodeOptionsEnvironmentVariable` | **ligado** | `NODE_OPTIONS=--require …` injeta código |
  | `EnableNodeCliInspectArguments` | **ligado** | `--inspect` abre depurador no main |
  | `EnableEmbeddedAsarIntegrityValidation` | desligado | asar alterado carrega normal |
  | `OnlyLoadAppFromAsar` | desligado | aceita `resources/app/` solto |
  | `EnableCookieEncryption` | **desligado** | cookie de sessão do Aether fica em claro no `Cookies` do `userData` |
  | `GrantFileProtocolExtraPrivileges` | ligado | — |

- **[hipótese]** Como a instalação é **per-user** (pasta gravável pelo
  próprio usuário) e o binário não é assinado, qualquer processo do usuário
  pode trocar o `app.asar` e herdar as permissões já concedidas (microfone,
  tela). O cookie em claro facilita roubo de sessão por infostealer. Nada
  disso exige privilégio, mas também exige já ter código na máquina — por
  isso P1 e não P0.
- **Correção:** `@electron/fuses` no `afterPack` do electron-builder:
  `RunAsNode`, `NodeOptions`, `NodeCliInspect` desligados;
  `EnableCookieEncryption`, `EnableEmbeddedAsarIntegrityValidation`,
  `OnlyLoadAppFromAsar` ligados.

**P1-E. Electron 44.0.0 (Chrome 152.0.7977.54).** *(confirma §2.2 item 10)*
- **[fato]** Strings no binário e `apps/desktop/package.json:16` fixando
  `"electron": "44.0.0"` (sem `^`).
- **[hipótese]** Como o app carrega conteúdo remoto, cada correção de V8/Blink
  publicada depois do 44.0.0 vale para ele; não consultei a lista de CVEs
  (fora do escopo estático). A versão `.0` do major é a de maior chance de
  ter correções pendentes.

### P2

**P2-A. CSP da janela principal depende 100% do site.** *(neutro em relação à auditoria)*
- **[fato]** O main não injeta CSP (`onHeadersReceived` ausente). A CSP efetiva
  é a do Next (`connect-src` restrito, segundo `aether-audit.md` §4). Não
  conferido no artefato: o build web local não é de produção (§3).
- **[fato]** A janela do seletor tem CSP própria e restritiva
  (`src/picker/index.html:10-13`: `default-src 'none'; img-src data:;
  style-src 'unsafe-inline'; script-src 'self'`). ✔

**P2-B. Permissões de mídia concedidas sem prompt.**
- **[fato]** `main.js:763-805`: `media`, `display-capture`, `fullscreen`
  liberados para a origem (`isAllowedUrl` confere origem exata), todo o resto
  negado. Bem feito; só registra que o modelo de confiança é "tudo que a
  origem pedir de mídia", o que amplifica P1-A/P1-B.

**P2-C. `AETHER_APP_URL` troca a origem confiável.**
- **[fato]** `main.js:105-106`: a variável de ambiente redefine `APP_ORIGIN`,
  e com ela a lista de permissões e o alvo do `isAllowedUrl`.
- **[hipótese]** Exige controle do ambiente do usuário (equivalente a já ter
  código local). Somado ao `RunAsNode`/`NODE_OPTIONS` (P1-D), é o mesmo
  vetor. Vale desligar no app empacotado (`app.isPackaged`).

### P3

**P3-A. Sem segredos no asar.** *(fato positivo)*
- **[fato]** Varredura por `secret|api_key|token|password|PRIVATE KEY|AKIA…|ghp_…|sk_…`
  em `src/` e `native/index.js`: só ocorrências em comentários
  (`updater.js:16-17`, `picker/index.html:16`). Única URL embutida:
  `https://aether-mocha-phi.vercel.app` (`main.js:106`). O desenho
  "repo de releases público, sem token no cliente" está cumprido.

**P3-B. Source maps de dependência no asar.**
- **[fato]** `node_modules/builder-util-runtime/out/*.js.map` (e afins do
  `electron-updater`) estão empacotados. São de bibliotecas open-source; só
  peso. Nenhum `.map` de código próprio.

**P3-C. `console.log` do `securityOrigin` e do runtime.**
- **[fato]** `main.js:326-330`, `:742-746`. Só visíveis com terminal; sem
  impacto.

---

## 2. Itens de `aether-audit.md` §2.2 e §4: confirmado ou derrubado

| Item da auditoria | Resultado no artefato | Ref. aqui |
| --- | --- | --- |
| §2.2 #4 — `shell.openExternal` sem validar protocolo (`main.js:631,638,655`) | **Confirmado**, e há um 4º ponto (`:868`, janela OAuth). Gravidade efetiva **reduzida** pelo filtro `http(s)` do chat web | P1-A |
| §2.2 #10 — Electron 44.0.0 | **Confirmado** (`Electron/44.0.0`, `Chrome/152.0.7977.54` no `.exe`) | P1-E |
| §2.2 #10 — `sandbox: false` (`main.js:598`) | **Confirmado**; e a razão alegada no comentário é **derrubada** pelo próprio picker sandboxado | P1-C |
| §4 #3 — instalador sem assinatura + auto-update automático | **Confirmado e agravado**: além de sem Authenticode, o updater **pula** a verificação por falta de `publisherName` e instala no fechamento | P0-A |
| §4 #4 — `openExternal` / `sandbox` / Electron — P1 | **Confirmado**; acrescentar fuses (P1-D) e `senderFrame` (P1-B) ao mesmo pacote P1-11 | P1-A…E |
| §4 "CSP com `connect-src` restrito" | **Não verificável** no artefato: não existe build web de produção local | §3 |
| §4 #1, #2, #5, #6, #7 (Google, `AUTH_SECRET`, bloqueio, scrypt/RLS, gateway) | Fora do alcance do REA: são do servidor, não do que é distribuído | — |

Nada da auditoria foi derrubado como achado; um argumento (o comentário de
`sandbox: false`) foi derrubado.

---

## 3. Build web (`apps/web/.next`)

- **[fato]** O `.next` local é de **`next dev`**: `build-manifest.json` lista
  `static/development/_buildManifest.js`, chunks `webpack.js`/`main-app.js` não
  hasheados, `noop-turbopack-hmr`, e não há `BUILD_ID`. Data: 14/09/2026.
  Não representa o que a Vercel serve; analisar tamanho de chunk ou vazamento
  de caminho aqui daria número errado.
- **[fato]** 0 arquivos `.map` em `.next/static`.
- **Não feito, de propósito:** `next build` (usa o `.env` de produção) e
  captura do site no ar (fora do escopo estático).
- **Próximo passo sugerido:** `analyze_web_bundle` do REA contra a produção
  num Chromium aberto com `--remote-debugging-port`, com `fetch_source_maps:
  true`, para responder (a) se a Vercel publica source maps, (b) CSP efetiva
  nos headers, (c) maiores chunks. É leitura passiva de página pública, mas é
  tempo de execução — pedir o ok antes.

---

## 4. Limitações desta análise

- `aether_loopback.node` (módulo nativo de captura WASAPI) não foi
  desmontado — sem Ghidra/Rizin instalado. Foi tratado como caixa-preta; só o
  `loopback-ipc.js` que o chama foi lido.
- Fuses e assinatura são fatos do arquivo; não provam comportamento em
  execução (ex.: SmartScreen/Mark-of-the-Web, que dependem de como o
  download chega).
- `sandbox: true` funcionando com o preload atual é hipótese (P1-C) até um
  teste manual.
- O grafo do REA cobriu os 7 JS próprios; os 176 arquivos de `node_modules`
  ficaram fora (só `NsisUpdater.js` foi lido à mão).
- Evidence IDs do REA, para reabrir: fuses
  `ev_94c064fb…c19b`, PE certs `.exe` `ev_55434030…264d`, Setup
  `ev_202405c5…4cb`, desktop inventory `ev_a0d7cd66…db9a`, JS graph
  `ev_42fdf8c9…f7e`. (Ficam só na sessão do MCP; não foram exportados.)
