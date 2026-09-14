"use strict";

const {
  app,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pickSource, disableAudioPreference } = require("./picker");
const { instalarLoopback, encerrarLoopback } = require("./loopback-ipc");
const {
  criarVigia,
  definirCatalogoDaComunidade,
  listarCandidatos,
} = require("./game-detect");
const { instalarAtualizador } = require("./updater");
const { registrar } = require("./log");
const {
  caminhoDoDeepLink,
  deepLinkNosArgs,
  registrarProtocolo,
} = require("./deep-link");

/**
 * Casca desktop do Aether.
 *
 * Ela NAO empacota o site: carrega o app que ja esta publicado. O Next roda no
 * servidor (Server Actions, SSR), entao nao existe versao estatica para
 * embutir — e mesmo que existisse, embutir significaria reinstalar a cada
 * correcao. Assim uma correcao publicada chega sem ninguem baixar nada.
 *
 * O que o desktop acrescenta, e que o navegador nao da:
 *  - captura de audio do sistema por LOOPBACK, um caminho de codigo diferente
 *    do getDisplayMedia do navegador (que falha em algumas maquinas Windows);
 *  - janela propria, com icone e atalho.
 */

/**
 * Tira o IPv6 do WebRTC — so deste processo, so enquanto o app roda.
 *
 * POR QUE: o no de midia do LiveKit em Sao Paulo anuncia IPv4 e IPv6 na mesma
 * porta. Medido de uma rede residencial em SP (05/09/2026):
 *
 *   147.15.30.223                        ->   4 ms  (10 saltos, tudo no Brasil)
 *   2603:c021:c006:a500::d83e:8bba:1765  -> 115 ms  (sai do pais na entrada
 *                                                    da rede IPv6 da Oracle)
 *
 * O ICE escolhe par por PRIORIDADE DE TIPO, nao por latencia (RFC 8445:
 * host=126 > prflx=110). O candidato IPv6 e `host` e o IPv4 chega como
 * `prflx`, entao o Chromium fixa no de 115 ms com o de 7 ms parado ao lado —
 * e a chamada inteira roda com ~117 ms de ping sem precisar.
 *
 * A correcao de verdade e do LiveKit (nao deveria anunciar um IPv6 com rota
 * transcontinental) e vale tambem para quem usa pelo navegador, onde nao ha
 * como fazer isto. Aqui, no desktop, a linha de comando e nossa.
 *
 * `WebRTC-IPv6Default/Disabled/` foi MEDIDO, nao suposto: uma sonda que junta
 * candidatos ICE contra um STUN publico devolveu 4 candidatos IPv6 sem o
 * switch e 0 com ele, mantendo os 3 IPv4 (inclusive o `srflx`).
 *
 * NAO mexe em nada do sistema — o IPv6 do Windows continua ligado, e so o
 * WebRTC deste processo que para de juntar candidato IPv6.
 *
 * A TRAVA: quem esta numa rede SO IPv6 ficaria sem candidato nenhum e sem
 * conseguir entrar em chamada. Por isso o switch so entra quando existe IPv4
 * utilizavel. E `AETHER_WEBRTC_IPV6=1` desfaz tudo, para quando o LiveKit
 * corrigir ou se aparecer rede em que isto atrapalhe.
 */
function desligarIpv6DoWebrtc() {
  if (process.env.AETHER_WEBRTC_IPV6 === "1") {
    registrar("webrtc:ipv6", { acao: "mantido", motivo: "AETHER_WEBRTC_IPV6=1" });
    return;
  }

  const temIpv4 = Object.values(os.networkInterfaces())
    .flat()
    .some(
      (i) => i && !i.internal && (i.family === "IPv4" || i.family === 4),
    );

  if (!temIpv4) {
    registrar("webrtc:ipv6", { acao: "mantido", motivo: "rede sem IPv4" });
    return;
  }

  app.commandLine.appendSwitch(
    "force-fieldtrials",
    "WebRTC-IPv6Default/Disabled/",
  );
  registrar("webrtc:ipv6", { acao: "desligado" });
}

desligarIpv6DoWebrtc();

// Dono do esquema `aether://` — antes de tudo, para o relançamento pelo
// protocolo (app fechado) ja encontrar o registro.
registrarProtocolo();

/** Origem oficial. Tudo fora daqui abre no navegador do sistema, nunca aqui. */
const APP_ORIGIN =
  process.env.AETHER_APP_URL ?? "https://aether-mocha-phi.vercel.app";

/**
 * Deep link recebido antes de a pagina ter um ouvinte pronto.
 *
 * Cobre dois momentos: (1) o app abriu do zero por causa do link e a pagina
 * ainda esta carregando; (2) o app ja estava aberto mas o bundle e velho
 * demais para ter o ouvinte. A pagina pergunta por
 * `desktop:deep-link-pendente` ao montar; e ha um fallback de `loadURL` se
 * ninguem confirmar o `desktop:deep-link` a tempo.
 */
let deepLinkPendente = null;

/** A janela viva. O atualizador precisa dela para avisar da versao pronta. */
let janelaPrincipal = null;

/** Manda o deep link para a pagina — ou guarda para ela buscar ao carregar. */
function entregarDeepLink(caminho) {
  if (!caminho) return;
  registrar("deep-link:recebido", { caminho });

  const janela =
    janelaPrincipal && !janelaPrincipal.isDestroyed() ? janelaPrincipal : null;
  if (!janela) {
    deepLinkPendente = caminho;
    return;
  }

  if (janela.isMinimized()) janela.restore();
  janela.focus();

  deepLinkPendente = caminho;
  janela.webContents.send("desktop:deep-link", caminho);

  /**
   * Fallback: se a pagina nao confirmar (`desktop:deep-link-ack`) em 2s, ela
   * provavelmente nao tem o ouvinte (bundle antigo). Ai navegamos na marra —
   * recarrega a janela, mas o convite nao se perde.
   */
  const alvo = caminho;
  const aoConfirmar = () => {
    clearTimeout(prazo);
    ipcMain.removeListener("desktop:deep-link-ack", aoConfirmar);
    if (deepLinkPendente === alvo) deepLinkPendente = null;
  };
  const prazo = setTimeout(() => {
    ipcMain.removeListener("desktop:deep-link-ack", aoConfirmar);
    if (deepLinkPendente === alvo && !janela.isDestroyed()) {
      registrar("deep-link:fallback-loadurl", { caminho: alvo });
      void janela.webContents.loadURL(`${APP_ORIGIN}${alvo}`);
      deepLinkPendente = null;
    }
  }, 2000);
  ipcMain.on("desktop:deep-link-ack", aoConfirmar);
}

function isAllowedUrl(rawUrl) {
  try {
    const target = new URL(rawUrl);
    const allowed = new URL(APP_ORIGIN);
    return target.origin === allowed.origin;
  } catch {
    return false;
  }
}

/**
 * Janelas com uma reconexao ja em andamento, para nao empilhar duas.
 *
 * `resume` (o sistema acordou) e `render-process-gone` (o renderer morreu)
 * podem disparar quase juntos — dormir o notebook e frequentemente o que
 * derruba o processo. Sem a guarda, os dois comecariam a checar a origem em
 * paralelo e, se ambos vencessem a corrida, a janela recarregaria duas vezes
 * seguidas.
 */
const reconectandoAgora = new Set();

/**
 * Quando a ULTIMA recarga de verdade aconteceu (`webContents.reload()`),
 * para o cooldown abaixo. `0` significa "nenhuma ainda".
 */
let ultimaRecargaEm = 0;

/**
 * Tempo minimo entre duas recargas desse mecanismo.
 *
 * NASCEU DE UM DEFEITO RELATADO: em notebook Windows com Modern Standby
 * (energia baixa "conectada"), o sistema faz transicoes de suspensao e volta
 * o tempo todo — inclusive com a tampa aberta e a tela acesa — e o
 * `powerMonitor` do Electron dispara `resume` a cada uma delas, nao so
 * quando o notebook dorme de verdade. Sem cooldown, cada disparo falso virava
 * um `reload()` completo: a conexao caia, quem estava numa call saia dela, e
 * o sintoma era "o app cai toda hora" — em producao e local igual, porque a
 * causa e o processo principal do Electron, nao o servidor para onde ele
 * aponta.
 *
 * 2 minutos: alto o bastante para nao reagir a uma sequencia de disparos
 * falsos do Modern Standby (que se repetem em minutos, as vezes segundos), e
 * baixo o bastante para o notebook dormindo de verdade — que nao se repete
 * nesse intervalo — continuar sendo coberto na primeira tentativa.
 *
 * NAO E VERIFICAVEL COM CERTEZA SEM O HARDWARE QUE RELATOU O SINTOMA — mesma
 * ressalva do reparo original: e o ajuste padrao para esse tipo de disparo
 * espurio, registrado como tal em vez de apresentado como causa confirmada.
 * `aether.log` (`reconexao:tentando` / `reconexao:ignorada-cooldown`) e o que
 * prova se o disparo era mesmo frequente.
 */
const COOLDOWN_MS = 2 * 60_000;

/**
 * Recarrega a janela assim que a ORIGEM voltar a responder — nunca antes.
 *
 * O SINTOMA QUE ISTO CORRIGE: o app fica com a tela preta ou cinza depois de
 * o notebook dormir (ou a rede cair por um tempo) e voltar, enquanto o
 * Discord, aberto ao lado, se recupera sozinho. A causa mais provavel e um
 * bug conhecido do Chromium/Electron: o compositor de GPU nao volta a
 * desenhar sozinho depois que o sistema suspende o processo. O socket do
 * tempo real ja tenta se reconectar por conta propria
 * (`reconnectionAttempts: Infinity`, em `realtime-provider.tsx`) — o problema
 * visivel nao e falta de dado chegando, e a PAGINA que parou de se redesenhar.
 * `reload()` e o mesmo remedio de fechar e abrir o app de novo, so que
 * automatico.
 *
 * NAO E VERIFICAVEL COM CERTEZA SEM REPRODUZIR O DEFEITO — este e o reparo
 * padrao para esse sintoma em apps Electron, e nao uma causa confirmada linha
 * a linha neste código. Fica registrado como tal.
 *
 * POR QUE ESPERA A ORIGEM RESPONDER, e nao recarrega na hora: acordar do
 * standby nao significa que o adaptador de rede ja reconectou — pode levar
 * alguns segundos. Recarregar contra uma rede ainda fora do ar trocaria a
 * tela preta por uma tela de erro do Chromium, que e pior: aquela ao menos
 * sai sozinha quando a rede volta.
 */
function recarregarQuandoAOrigemResponder(window, motivo) {
  if (window.isDestroyed() || reconectandoAgora.has(window)) return;

  const desdeAUltima = Date.now() - ultimaRecargaEm;
  if (ultimaRecargaEm !== 0 && desdeAUltima < COOLDOWN_MS) {
    registrar("reconexao:ignorada-cooldown", {
      motivo,
      desdeAUltimaMs: desdeAUltima,
    });
    return;
  }

  reconectandoAgora.add(window);
  registrar("reconexao:tentando", { motivo });

  const MAX_TENTATIVAS = 10; // ~30s de tentativas antes de desistir
  const INTERVALO_MS = 3000;
  let tentativas = 0;

  const tentar = async () => {
    if (window.isDestroyed()) {
      reconectandoAgora.delete(window);
      return;
    }
    tentativas += 1;
    try {
      // Qualquer resposta HTTP — mesmo erro do servidor — prova que a rede
      // ja chega la. So uma excecao (DNS, TCP, timeout) significa "ainda nao".
      await fetch(APP_ORIGIN, {
        method: "HEAD",
        signal: AbortSignal.timeout(4000),
      });
      registrar("reconexao:origem-respondeu", { motivo, tentativas });
      if (!window.isDestroyed()) {
        ultimaRecargaEm = Date.now();
        window.webContents.reload();
      }
      reconectandoAgora.delete(window);
    } catch (erro) {
      if (tentativas >= MAX_TENTATIVAS) {
        registrar("reconexao:desistiu", {
          motivo,
          tentativas,
          erro: String(erro),
        });
        reconectandoAgora.delete(window);
        return;
      }
      setTimeout(tentar, INTERVALO_MS);
    }
  };

  setTimeout(tentar, INTERVALO_MS);
}

/**
 * Entrega a fonte de captura de tela, depois de PERGUNTAR qual.
 *
 * A versao anterior pegava `sources[0]` e ja compartilhava. A aposta era que
 * `useSystemPicker: true` faria o Windows abrir o seletor nativo antes de
 * chegar aqui — nesta combinacao de Electron e Windows isso nao acontece, e o
 * "plano B" virou o comportamento de sempre. O sintoma era compartilhar a tela
 * inteira direto, sem perguntar nada.
 *
 * Agora abrimos um seletor proprio, com miniaturas — o mesmo caminho que o
 * Discord usa. Sem `useSystemPicker`: com ele ligado o Electron poderia
 * resolver a escolha sozinho e nunca chamar este handler.
 *
 * O `loopbackWithSilence` e o motivo principal de existir a versao desktop.
 * No navegador, pedir audio junto e tudo-ou-nada: se o sistema recusa abrir o
 * som, a captura inteira falha. Aqui a captura passa por implementacao propria
 * do Electron, que e outro caminho de codigo.
 */
function installDisplayMediaHandler(targetSession) {
  targetSession.setDisplayMediaRequestHandler((request, callback) => {
    /**
     * `audioRequested` diz o que o RENDERER pediu — que nao e a mesma coisa
     * que a chave do nosso seletor.
     *
     * Sao duas decisoes: o app web chama getDisplayMedia com a caixinha dele,
     * e o seletor tem a propria. Se elas divergirem e o Chromium ignorar o
     * audio que devolvemos, a chave do seletor viraria enfeite. Logar isto e
     * o que torna essa divergencia visivel em vez de silenciosa.
     *
     * Visivel so em `npm run dev:desktop`: no app instalado nao ha console
     * ligado, a menos que se rode o .exe por um terminal.
     */
    console.log("[display-media] pedido do renderer:", {
      audioRequested: request.audioRequested,
      videoRequested: request.videoRequested,
      securityOrigin: request.securityOrigin,
    });

    /**
     * A janela principal, para o seletor abrir como modal em cima dela.
     *
     * NAO derivamos de `request.frame`: aquilo e um WebFrameMain, e
     * `BrowserWindow.fromWebContents` espera um WebContents — passar o tipo
     * errado LANCA, o handler morre antes de abrir qualquer coisa, e o
     * getDisplayMedia fica sem resposta. Foi exatamente esse o sintoma:
     * clicar em compartilhar e nao acontecer nada.
     *
     * Como este app tem uma janela principal so, pegar a primeira e correto e
     * nao tem como dar errado.
     */
    const parent =
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows()[0] ??
      null;

    void pickSource(parent)
      .then((choice) => {
        // Cancelar nao e erro: `{}` vira NotAllowedError no cliente, o mesmo
        // que o navegador devolve quando alguem fecha o seletor nativo.
        if (!choice) {
          callback({});
          return;
        }
        /**
         * A chave `audio` e OMITIDA quando nao ha som, em vez de ir como
         * `undefined`: o Electron valida o campo e recusa undefined com
         * "audio must be a WebFrameMain, loopback or loopbackWithMute" — e
         * ai a captura inteira morre, inclusive o video.
         *
         * O valor e `loopback`, o unico aceito no Windows para som do
         * sistema. (`loopbackWithSilence` nao existe; foi um chute meu que
         * o proprio Electron recusou.)
         */
        const response = { video: choice.source };
        if (choice.withAudio && process.platform === "win32") {
          response.audio = "loopback";
        }
        callback(response);
      })
      .catch((error) => {
        console.error("[picker] falhou:", error);
        callback({});
      });
  });
}

/* -------------------------------------------------------------------------
 * Deteccao de jogo
 *
 * Comeca DESLIGADA e so liga quando a pessoa pede nas configuracoes. Ler a
 * lista de programas abertos de alguem nao e coisa que se faz por padrao.
 *
 * O casamento acontece todo aqui, no processo principal: a pagina recebe
 * apenas o NOME do jogo ja identificado, nunca a lista de processos.
 * ------------------------------------------------------------------------- */

function prefsDeJogo() {
  return path.join(app.getPath("userData"), "game-prefs.json");
}

function lerDeteccaoLigada() {
  try {
    const bruto = fs.readFileSync(prefsDeJogo(), "utf8");
    // Padrao DESLIGADO: so vale como ligada se estiver escrito que sim.
    return JSON.parse(bruto).enabled === true;
  } catch {
    return false;
  }
}

function salvarDeteccaoLigada(enabled) {
  try {
    fs.writeFileSync(prefsDeJogo(), JSON.stringify({ enabled }), "utf8");
  } catch {
    // Disco cheio ou pasta sem permissao: a escolha vale so nesta execucao.
  }
}

/**
 * O catalogo da comunidade guardado em disco.
 *
 * EXISTE PARA A PRIMEIRA DETECCAO. A deteccao roda 8 segundos depois de abrir;
 * a pagina so manda a lista depois de carregar e autenticar. Sem a copia em
 * disco, toda abertura teria uma janela em que jogo da comunidade nao seria
 * reconhecido — e quem tem um jogo desses acharia que o recurso e intermitente.
 *
 * E so cache: se o arquivo sumir ou vier corrompido, a lista fica vazia ate a
 * pagina mandar a de verdade. Nunca e a fonte da verdade.
 */
function arquivoDoCatalogo() {
  return path.join(app.getPath("userData"), "jogos-comunidade.json");
}

function salvarCatalogoDaComunidade(lista) {
  try {
    fs.writeFileSync(arquivoDoCatalogo(), JSON.stringify(lista ?? []), "utf8");
  } catch {
    // Sem disco, o catalogo vale so nesta execucao.
  }
}

function carregarCatalogoSalvo() {
  try {
    const lista = JSON.parse(fs.readFileSync(arquivoDoCatalogo(), "utf8"));
    return definirCatalogoDaComunidade(lista);
  } catch {
    return 0;
  }
}

let vigiaDeJogo = null;

function instalarDeteccaoDeJogo() {
  // A copia em disco vale ja na primeira verificacao, antes de a pagina abrir.
  carregarCatalogoSalvo();

  vigiaDeJogo = criarVigia((jogo) => {
    for (const janela of BrowserWindow.getAllWindows()) {
      if (!janela.isDestroyed()) {
        janela.webContents.send("desktop:game-changed", jogo);
      }
    }
  });

  ipcMain.handle("desktop:game-detection-get", () => lerDeteccaoLigada());

  // O que ja foi detectado, para a pagina que acabou de carregar nao ficar
  // esperando a proxima MUDANCA de jogo para saber do jogo que ja esta aberto.
  ipcMain.handle("desktop:game-current", () =>
    lerDeteccaoLigada() ? vigiaDeJogo.atual() : null,
  );

  /**
   * O catalogo da comunidade, entregue pela PAGINA.
   *
   * Vem de la, e nao e buscado aqui, porque a sessao vive no renderer: dar ao
   * processo principal uma credencial propria seria criar um segundo lugar
   * com segredo para resolver um problema que a pagina ja resolve.
   *
   * Guardado em disco tambem, para valer na primeira deteccao depois de abrir
   * — antes de a pagina carregar e mandar a lista.
   */
  ipcMain.handle("desktop:jogos-catalogo-set", (_evento, lista) => {
    const quantos = definirCatalogoDaComunidade(lista);
    salvarCatalogoDaComunidade(lista);
    return quantos;
  });

  /**
   * Os processos que a pessoa poderia sugerir.
   *
   * ISTO ENFRAQUECE, DE PROPOSITO, o invariante de que a pagina nunca ve a
   * lista de processos. A diferenca que o torna aceitavel: acontece SO quando
   * a pessoa abre a tela de adicionar jogo — nunca continuamente —, e o que
   * desce sao NOMES, jamais caminhos. Caminho carregaria o nome de usuario do
   * Windows, que e o dado que a biblioteca inteira foi desenhada para nao
   * tocar.
   *
   * Recusa quando a deteccao esta desligada: quem nao quis que lessemos a
   * lista de programas nao passa a querer por ter aberto um menu.
   */
  ipcMain.handle("desktop:jogos-candidatos", async () => {
    if (!lerDeteccaoLigada()) return [];
    try {
      return await listarCandidatos();
    } catch {
      return [];
    }
  });

  /**
   * Abrir junto com o Windows.
   *
   * QUEM GUARDA A PREFERENCIA E O SISTEMA, nao um arquivo nosso: o registro de
   * inicializacao do Windows e a fonte da verdade. Ler de la em vez de manter
   * copia evita o caso em que a caixa aparece marcada e o app nao abre — a
   * pessoa pode ter tirado o Aether da inicializacao pelo Gerenciador de
   * Tarefas, e um valor nosso guardado continuaria dizendo que esta ligado.
   *
   * `openAsHidden` fica FALSO: abrir escondido junto com o sistema e o tipo de
   * coisa que faz a pessoa achar que o app nao abriu. Se um dia houver icone
   * na bandeja, ai vale reconsiderar.
   */
  ipcMain.handle("desktop:iniciar-com-windows-get", () => {
    try {
      return app.getLoginItemSettings().openAtLogin === true;
    } catch {
      // Plataforma sem suporte (ou politica bloqueando): responde desligado
      // em vez de derrubar a chamada.
      return false;
    }
  });

  ipcMain.handle("desktop:iniciar-com-windows-set", (_evento, ligar) => {
    const valor = ligar === true;
    try {
      app.setLoginItemSettings({ openAtLogin: valor, openAsHidden: false });
      // Devolve o que o SISTEMA passou a dizer, e nao o que pedimos: se ele
      // recusar, a tela precisa mostrar a verdade, nao a intencao.
      return app.getLoginItemSettings().openAtLogin === true;
    } catch (erro) {
      console.error("[inicio-automatico] falhou:", erro.message);
      return false;
    }
  });

  ipcMain.handle("desktop:game-detection-set", (_evento, ligada) => {
    const valor = ligada === true;
    salvarDeteccaoLigada(valor);
    if (valor) vigiaDeJogo.iniciar();
    else vigiaDeJogo.parar();
    return valor;
  });

  if (lerDeteccaoLigada()) vigiaDeJogo.iniciar();
}

function createWindow(caminhoInicial) {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: "#0a0a0c",
    // Sem flash branco: a janela so aparece quando ha o que mostrar.
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "build", "icon.png"),

    /**
     * Barra de titulo propria, desenhada pela pagina.
     *
     * `hidden` + `titleBarOverlay`, e nao janela sem moldura com botoes
     * proprios: assim o Windows continua desenhando minimizar/maximizar/fechar
     * de verdade. O que se ganha com isso nao e estetica, e comportamento —
     * Snap Layouts (o menu de layout ao pousar o mouse no maximizar), duplo
     * clique para maximizar, area de clique correta e alta densidade. Botao
     * proprio significa reimplementar tudo isso, e errar em algum.
     *
     * A pagina desenha o resto da faixa e informa onde da para arrastar.
     */
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0b0d10",
      symbolColor: "#8a8f98",
      height: 36,
    },
    webPreferences: {
      /**
       * As tres linhas que importam para seguranca. O app carrega conteudo
       * REMOTO; sem isolamento, um comprometimento do site viraria execucao de
       * codigo com privilegio de desktop na maquina de quem instalou.
       */
      contextIsolation: true,
      nodeIntegration: false,
      /**
       * `sandbox: false` porque o preload usa `require("electron")` para o
       * contextBridge — com o sandbox ligado, o preload roda num contexto sem
       * `require` e a ponte nunca e criada.
       *
       * O que protege aqui e o `contextIsolation`: o mundo do site e o do
       * preload sao separados, e o site so alcanca o que o contextBridge
       * publica de proposito. Nada de Node vaza para a pagina.
       */
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  window.once("ready-to-show", () => window.show());
  /**
   * `caminhoInicial` vem de um `aether://…` que abriu o app do zero. So aceita
   * caminho interno (comeca com `/`), nunca URL — quem valida o formato do
   * codigo e o `deep-link.js`, e o backend valida o convite de verdade.
   *
   * Sem deep link, o boot vai pra `/login`, NUNCA pra raiz (`/`) — a raiz e a
   * home de marketing do site, e o app desktop nao tem por que mostrar isso:
   * quem abre o .exe ja decidiu que quer entrar no AETHER. O `middleware.ts`
   * do site ja resolve os dois casos sozinho a partir daqui: com sessao
   * valida, redireciona pra `/app`; sem sessao, mostra o login.
   */
  const inicio =
    typeof caminhoInicial === "string" && caminhoInicial.startsWith("/")
      ? `${APP_ORIGIN}${caminhoInicial}`
      : `${APP_ORIGIN}/login`;
  void window.loadURL(inicio);

  // Devolvida para o atualizador poder avisar a pagina quando a versao nova
  // ficar pronta — o aviso agora e um botao dentro do app, nao caixa nativa.
  janelaPrincipal = window;

  /**
   * Link para fora abre no navegador do sistema, e nunca dentro do app. Sem
   * isto, um link em mensagem abriria uma janela Electron navegando para
   * qualquer lugar — com as permissoes de midia que a pessoa ja concedeu.
   */
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedUrl(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  /**
   * `will-navigate` so cobre a navegacao ORIGINAL — um redirect HTTP no meio
   * dela (302 do servidor) e outro evento, `will-redirect`. Sem isto, clicar
   * em "Continuar com Google" navegaria pra `/api/auth/google` (mesma
   * origem, passa no `will-navigate`), o servidor responderia 302 pra
   * `accounts.google.com`, e ESSE redirect seguiria direto pra dentro da
   * janela embutida — exatamente o que o Google recusa (webview embutida e
   * bloqueada por politica deles desde 2016, erro `disallowed_useragent`).
   * Aqui cai na mesma regra do `will-navigate`: fora da origem do app vai
   * pro navegador do sistema.
   */
  window.webContents.on("will-redirect", (event, url) => {
    if (isAllowedUrl(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  /**
   * O renderer morreu (falta de memoria, driver de GPU, crash do Chromium).
   * Sem isto a janela fica exatamente no ultimo quadro que desenhou — preta
   * ou congelada — para sempre, porque nada aqui pede para redesenhar
   * sozinho depois que o processo cai.
   */
  window.webContents.on("render-process-gone", (_evento, detalhes) => {
    registrar("renderer-caiu", detalhes);
    recarregarQuandoAOrigemResponder(window, "render-process-gone");
  });

  /**
   * Erros da camada de voz vao para o `aether.log`.
   *
   * O renderer instalado nao tem console, e "a call caiu e nao sei por que"
   * (bug relatado) precisa deixar rastro em algum lugar que a pessoa consiga
   * abrir — o app ja mostra o caminho do log. So as linhas `[voz ...]`
   * (`mediaWarn` na `lib/voice/debug.ts`): desconexao do SFU e o motivo,
   * reconexao, falha de dispositivo, recuperacao esgotada. O resto do console
   * nao entra, para o arquivo nao virar despejo.
   */
  window.webContents.on("console-message", (...args) => {
    // Electron 44 entrega um objeto `{ level, message, ... }`; versoes antigas
    // entregavam `(event, level, message, line, source)`. Cobre os dois.
    const detalhe = args[1];
    const mensagem =
      detalhe && typeof detalhe === "object" ? detalhe.message : args[2];
    const nivel =
      detalhe && typeof detalhe === "object" ? detalhe.level : args[1];
    if (typeof mensagem !== "string" || !mensagem.startsWith("[voz ")) return;
    registrar("voz", { nivel, mensagem: mensagem.slice(0, 500) });
  });

  return window;
}

/** Uma instancia so: a segunda foca a janela existente em vez de abrir outra. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  /**
   * Segunda instancia — no Windows e o que acontece quando o app JA esta
   * aberto e alguem clica num `aether://…`: o SO relança o .exe, o lock
   * redireciona para ca, e a URL vem em `argv`.
   */
  app.on("second-instance", (_evento, argv) => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
    entregarDeepLink(deepLinkNosArgs(argv));
  });

  /** macOS entrega o deep link por evento proprio (nao por argv). */
  app.on("open-url", (evento, url) => {
    evento.preventDefault();
    entregarDeepLink(caminhoDoDeepLink(url));
  });

  /**
   * O processo de GPU morreu (driver, falta de memoria, crash do Chromium) —
   * SEPARADO do renderer: `render-process-gone` (dentro de `createWindow`)
   * nao pega este caso, porque o RENDERER continua vivo; quem sumiu foi quem
   * desenha os quadros novos. Sem isto a janela fica travada no ultimo quadro
   * pintado — as vezes preto — para sempre, e so fechar e abrir o app de novo
   * resolve. E exatamente onde WebRTC (call de voz/video) mais derruba o
   * processo de GPU, porque e o uso mais pesado de composicao de video que o
   * app faz.
   */
  app.on("child-process-gone", (_evento, detalhes) => {
    if (detalhes.type !== "GPU") return;
    registrar("processo-gpu-caiu", detalhes);
    if (janelaPrincipal && !janelaPrincipal.isDestroyed()) {
      recarregarQuandoAOrigemResponder(janelaPrincipal, "child-process-gone:GPU");
    }
  });

  void app.whenReady().then(() => {
    /**
     * Versoes no boot. O suporte a captura por loopback mudou bastante entre
     * versoes do Electron/Chromium, entao esta linha e a primeira coisa a
     * pedir quando alguem relatar problema de som.
     */
    console.log("[runtime]", {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    });

    /**
     * Microfone, captura de tela e TELA CHEIA sao concedidos sem perguntar;
     * camera entrou quando o recurso passou a existir. Todo o resto e NEGADO,
     * porque permissao que nao se usa e superficie de ataque de graca.
     *
     * `fullscreen` estava faltando, e o sintoma era mudo: no Electron, o
     * `Element.requestFullscreen()` da pagina passa por AQUI como permissao
     * `"fullscreen"`. Negada, a promessa e rejeitada — e o botao da tela
     * engolia o erro num `.catch`, entao clicar simplesmente nao fazia nada.
     * O codigo do botao nunca mudou; quem mudou foi esta lista.
     *
     * A lista de permitidas fica numa constante so, usada pelos DOIS handlers
     * abaixo: eles respondem perguntas diferentes sobre a mesma politica, e
     * duas listas divergiriam na proxima vez que alguem mexesse em uma.
     */
    const PERMISSOES_LIBERADAS = new Set([
      "media",
      "display-capture",
      "fullscreen",
    ]);

    /**
     * Nao ha dialogo de permissao aqui de proposito: quem instalou um
     * aplicativo de voz ja consentiu em usar o microfone, e o Windows continua
     * mostrando o indicador de microfone em uso.
     */
    session.defaultSession.setPermissionRequestHandler(
      (webContents, permission, callback) => {
        const url = webContents?.getURL() ?? "";
        if (!isAllowedUrl(url)) {
          callback(false);
          return;
        }
        callback(PERMISSOES_LIBERADAS.has(permission));
      },
    );

    /**
     * O handler de VERIFICACAO, que e outro e nao pode faltar.
     *
     * O Chromium pergunta duas coisas em momentos diferentes: "posso PEDIR?"
     * (acima) e "esta permitido AGORA?" (aqui). O padrao do Electron nega o
     * segundo para camera vindo de conteudo remoto — e sem ele o microfone
     * funcionava e a camera nao, com um erro que nao explicava nada:
     *
     *   navigator.permissions.query({name:"camera"}) -> "denied"
     *   getUserMedia({video:true}) -> NotAllowedError: Permission denied
     *
     * A origem e conferida do mesmo jeito: so o app, nunca uma pagina
     * qualquer que consiga se carregar aqui dentro.
     */
    session.defaultSession.setPermissionCheckHandler(
      (webContents, permission, requestingOrigin) => {
        const url = webContents?.getURL() ?? requestingOrigin ?? "";
        if (!isAllowedUrl(url)) return false;
        return PERMISSOES_LIBERADAS.has(permission);
      },
    );

    installDisplayMediaHandler(session.defaultSession);

    /**
     * O renderer avisa aqui quando `getDisplayMedia` rejeitou por causa do
     * SOM (video teria funcionado). E o unico jeito de saber: o pedido de
     * loopback e feito por este processo, mas quem realmente tenta abrir o
     * dispositivo de audio e o Chromium, depois que o callback do handler ja
     * retornou — o main nunca veria a falha sozinho.
     */
    ipcMain.on("desktop:audio-capture-failed", (_evento, detalhes) =>
      disableAudioPreference(detalhes),
    );

    /**
     * OAuth de UMA CONEXAO numa janela DEDICADA.
     *
     * Antes a pagina navegava a janela principal para a rota de conectar — a
     * unica opcao possivel, porque o navegador do sistema nao tem o cookie de
     * sessao e a janela-filha do renderer cai no `setWindowOpenHandler` (que
     * manda tudo para fora). Navegar a janela principal recarrega o app
     * inteiro na volta, e isso derrubava a chamada de voz.
     *
     * Aqui a janela e criada pelo PROCESSO PRINCIPAL, entao nao passa pelo
     * `setWindowOpenHandler`, e usa `session.defaultSession` — o mesmo cookie
     * da janela principal. A janela principal nao navega; a call nem pisca.
     *
     * Fecha sozinha quando o callback termina (a pagina de callback, sem
     * `window.opener`, navega para `${APP_ORIGIN}/app?...`), ou por prazo, ou
     * se a pessoa fechar na mao.
     *
     * `caminho` vem da pagina e SO PODE ser uma rota de conectar do proprio
     * app — a checagem abaixo recusa qualquer outra coisa, para a pagina nao
     * conseguir abrir uma janela com sessao compartilhada apontando para
     * onde quiser.
     */
    function abrirOAuthDeConexao(caminho) {
      const rotaValida =
        typeof caminho === "string" &&
        /^\/api\/(spotify\/connect|conexoes\/[a-z]+\/connect)$/.test(caminho);
      if (!rotaValida) return Promise.resolve();

      return new Promise((resolve) => {
        const parent =
          janelaPrincipal && !janelaPrincipal.isDestroyed()
            ? janelaPrincipal
            : undefined;

        const oauth = new BrowserWindow({
          parent,
          width: 520,
          height: 760,
          title: "Conectar conta",
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            // Sem preload: aqui roda so o fluxo OAuth, nada do app.
          },
        });

        // Spotify nao abre janelas-filha, mas se abrisse: para o sistema.
        oauth.webContents.setWindowOpenHandler(({ url }) => {
          void shell.openExternal(url);
          return { action: "deny" };
        });

        let terminado = false;
        const terminar = () => {
          if (terminado) return;
          terminado = true;
          clearTimeout(prazo);
          if (!oauth.isDestroyed()) oauth.close();
          resolve();
        };

        const aoNavegar = (_evento, url) => {
          if (typeof url === "string" && url.startsWith(`${APP_ORIGIN}/app`)) {
            terminar();
          }
        };
        oauth.webContents.on("did-navigate", aoNavegar);
        oauth.webContents.on("did-navigate-in-page", aoNavegar);
        oauth.on("closed", () => {
          if (terminado) return;
          terminado = true;
          clearTimeout(prazo);
          resolve();
        });

        // Rede travada ou pessoa que desiste sem fechar: nao deixa orfa.
        const prazo = setTimeout(terminar, 5 * 60 * 1000);

        void oauth.loadURL(`${APP_ORIGIN}${caminho}`);
      });
    }

    ipcMain.handle("desktop:conexao-connect", (_e, caminho) =>
      abrirOAuthDeConexao(caminho),
    );
    /**
     * Canal antigo, para uma janela do app que ainda carregue bundle anterior
     * a fase 3 nos minutos ao redor de um deploy. Mesmo handler, caminho fixo.
     */
    ipcMain.handle("desktop:spotify-connect", () =>
      abrirOAuthDeConexao("/api/spotify/connect"),
    );

    /**
     * A pagina, ao montar, pergunta se ha um deep link esperando (cobre o
     * caso de o `desktop:deep-link` ter sido enviado antes de o ouvinte
     * existir, ou de o app ter aberto do zero pelo link). Devolver limpa.
     */
    ipcMain.handle("desktop:deep-link-pendente", () => {
      const caminho = deepLinkPendente;
      deepLinkPendente = null;
      return caminho;
    });

    instalarDeteccaoDeJogo();
    instalarLoopback();

    // Aberto do zero por um `aether://…`? A janela ja carrega no destino.
    createWindow(deepLinkNosArgs(process.argv));

    // Depois da janela: a verificacao nao pode atrasar a abertura do app.
    instalarAtualizador(janelaPrincipal);

    /**
     * O sistema acordou do modo de espera ou hibernacao.
     *
     * E O GATILHO MAIS COMUM do sintoma "tela preta depois que o notebook
     * dormiu com o app aberto": o mesmo minuto em que o adaptador de rede
     * tambem estava caindo e reconectando. Ver `recarregarQuandoAOrigemResponder`
     * para o porque do reload, e nao so um aviso.
     */
    powerMonitor.on("resume", () => {
      if (janelaPrincipal && !janelaPrincipal.isDestroyed()) {
        recarregarQuandoAOrigemResponder(janelaPrincipal, "resume");
      }
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    // No Windows e Linux, fechar a janela encerra o app.
    if (process.platform !== "darwin") app.quit();
  });

  /**
   * A thread de captura de som precisa morrer ANTES do processo.
   *
   * Sem isto, fechar o app durante um compartilhamento deixaria a thread
   * nativa segurando o dispositivo de audio — e o proximo `Initialize` no
   * WASAPI poderia falhar por recurso ocupado, num erro que pareceria vir do
   * nada na proxima abertura do app.
   */
  app.on("will-quit", () => encerrarLoopback());
}
