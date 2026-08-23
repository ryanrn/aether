"use strict";

const { app } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Deteccao de jogo em execucao.
 *
 * COMO FUNCIONA, e por que nao precisa de um banco de dados de jogos: cada
 * loja ja diz o que instalou, e cada uma diz de um jeito.
 *
 *  - STEAM: instala sempre em `steamapps/common/<Pasta do Jogo>/`, entao o
 *    caminho do processo ja identifica o jogo. O `appmanifest_*.acf` ao lado
 *    converte a pasta no nome oficial — e de la que sai o apostrofo certo de
 *    "Marvel's Spider-Man Remastered", que a pasta nao tem.
 *
 *  - EPIC: nao ha convencao de pasta (o GTA V que motivou este suporte estava
 *    em `E:\GTAV`, sem nada no nome que dissesse "Epic"). Em compensacao ela
 *    guarda um manifesto JSON por jogo, com o `DisplayName` JA PRONTO e o
 *    `InstallLocation` — melhor estruturado que o da Steam. Casamos por
 *    caminho de instalacao.
 *
 * Isso cobre qualquer jogo dessas duas lojas, inclusive os instalados depois,
 * sem cadastrar nada. O que ainda NAO cobre: GOG, Battle.net, Xbox e jogos
 * avulsos. Esta anotado nas limitacoes do README.
 *
 * PRIVACIDADE — a regra que decide o desenho deste arquivo:
 * a lista de processos NUNCA sai desta maquina. Ela e lida aqui, no processo
 * principal, e o unico dado que atravessa a ponte para a pagina (e dai para o
 * servidor) e o NOME DO JOGO ja identificado. Tudo que nao casa com a regra da
 * Steam e descartado sem sair daqui.
 *
 * Por isso tambem a deteccao comeca DESLIGADA: ninguem tem a propria lista de
 * programas lida sem ter pedido.
 */

/** De quanto em quanto tempo olhamos. 15s: o suficiente para parecer imediato. */
const POLL_MS = 15_000;

/**
 * O que essas lojas instalam mas NAO e jogo.
 *
 * Descoberto testando: a primeira deteccao numa maquina real trouxe
 * "wallpaper_engine" junto do jogo de verdade. Dizer "Ryan esta jogando
 * wallpaper_engine" seria errado e ridiculo.
 *
 * Comparado em minusculas — contra o nome da PASTA na Steam, e contra o
 * `DisplayName` na Epic (que distribui a Unreal Engine pela mesma via dos
 * jogos).
 */
const NAO_SAO_JOGOS = new Set([
  "wallpaper_engine",
  "steamvr",
  "steamworks shared",
  "steam controller configs",
  "steamlinuxruntime",
  "steam linux runtime",
  "unreal engine",
  "epic games launcher",
]);

/**
 * O nome da pasta do jogo dentro de um caminho de executavel.
 *
 * Normaliza as barras antes de casar: o Windows entrega `\`, e uma regex com
 * barra invertida escapada e exatamente o tipo de coisa que quebra em silencio
 * quando alguem edita o arquivo depois.
 *
 * Devolve `null` para qualquer caminho que nao seja de jogo Steam — o que
 * inclui a esmagadora maioria dos processos da maquina.
 */
function pastaDoJogo(caminho) {
  if (typeof caminho !== "string") return null;
  const normalizado = caminho.replace(/\\/g, "/");
  const encontrado = normalizado.match(/\/steamapps\/common\/([^/]+)\//i);
  return encontrado ? encontrado[1] : null;
}

/** A pasta e de um jogo, ou de um app da Steam que so parece jogo? */
function ehJogo(pasta) {
  return typeof pasta === "string" && !NAO_SAO_JOGOS.has(pasta.toLowerCase());
}

/* -------------------------------------------------------------------------
 * Epic Games
 *
 * A Epic guarda um manifesto JSON por jogo, com o nome JA PRONTO — melhor
 * estruturado que a Steam, que exige derivar o nome da pasta:
 *
 *   { "DisplayName": "Grand Theft Auto V", "InstallLocation": "E:\\GTAV" }
 *
 * Por isso o casamento aqui e por CAMINHO DE INSTALACAO, e nao por uma
 * convencao de pasta: a Epic deixa instalar em qualquer lugar (o GTA V que
 * motivou isto estava em `E:\GTAV`, sem nada no nome que dissesse "Epic").
 * ------------------------------------------------------------------------- */

const MANIFESTOS_EPIC =
  "C:/ProgramData/Epic/EpicGamesLauncher/Data/Manifests";

/** Barras normalizadas e com barra final: `E:/GTA` nao pode casar `E:/GTAV/`. */
function comoPasta(caminho) {
  const normalizado = String(caminho).replace(/\\/g, "/").toLowerCase();
  return normalizado.endsWith("/") ? normalizado : `${normalizado}/`;
}

/**
 * Le os manifestos da Epic. Devolve `[{ pasta, nome }]`.
 *
 * Um manifesto quebrado nao pode derrubar os outros — se a Epic mudar o
 * formato ou um arquivo estiver sendo escrito no momento da leitura, o certo
 * e perder AQUELE jogo, nao a deteccao inteira.
 */
function lerManifestosEpic() {
  const jogos = [];
  try {
    for (const arquivo of fs.readdirSync(MANIFESTOS_EPIC)) {
      if (!arquivo.endsWith(".item")) continue;
      try {
        const dados = JSON.parse(
          fs.readFileSync(path.join(MANIFESTOS_EPIC, arquivo), "utf8"),
        );
        if (dados.InstallLocation && dados.DisplayName) {
          jogos.push({
            pasta: comoPasta(dados.InstallLocation),
            nome: String(dados.DisplayName),
            /**
             * O executavel de lancamento, em caminho absoluto.
             *
             * Vale ouro para o icone: ele existe no DISCO independentemente de
             * qual processo esteja de pe. Jogo com anti-cheat passa boa parte
             * do tempo sem nenhum processo "livre" na pasta, e sem isto ficava
             * sem icone nenhum.
             */
            launch: dados.LaunchExecutable
              ? path.join(
                  String(dados.InstallLocation),
                  String(dados.LaunchExecutable).replace(/\//g, path.sep),
                )
              : null,
          });
        }
      } catch {
        // Manifesto ilegivel: segue para o proximo.
      }
    }
  } catch {
    // Epic nao instalada nesta maquina — caso normal, nao erro.
  }
  return jogos;
}

/**
 * Cache dos manifestos, invalidado pela data da PASTA.
 *
 * Instalar ou desinstalar um jogo mexe na pasta, e so ai relemos. Sem isso, ou
 * reliamos disco a cada 15 segundos, ou um jogo recem-instalado so apareceria
 * depois de reiniciar o app.
 */
let epicCache = { assinatura: null, jogos: [] };

function jogosEpic() {
  let assinatura = null;
  try {
    assinatura = String(fs.statSync(MANIFESTOS_EPIC).mtimeMs);
  } catch {
    // Sem a pasta nao ha o que ler, nem o que cachear.
    return [];
  }
  if (epicCache.assinatura !== assinatura) {
    const jogos = lerManifestosEpic();
    /**
     * Lista VAZIA nao vira cache.
     *
     * A Epic reescreve os manifestos ao instalar, atualizar ou verificar um
     * jogo — e uma leitura que caia nesse instante devolve vazio. Guardar esse
     * vazio com a assinatura nova envenenaria o cache: a deteccao ficaria
     * parada ate a pasta mudar de novo, que pode nao acontecer tao cedo.
     * Sem cache, a proxima verificacao tenta outra vez, 15 segundos depois.
     */
    if (jogos.length > 0) epicCache = { assinatura, jogos };
    return jogos;
  }
  return epicCache.jogos;
}

/**
 * Um jogo da Epic rodando neste caminho? Devolve o nome, ou `null`.
 *
 * O proprio launcher da Epic nao casa: os manifestos apontam para pastas de
 * JOGO, e o launcher mora em `Program Files/Epic Games/Launcher`, que nao e
 * a pasta de instalacao de nenhum jogo.
 */
function jogoEpicEm(caminho, catalogo) {
  return entradaEpicDe(caminho, catalogo)?.nome ?? null;
}

/**
 * A entrada INTEIRA do catalogo, para quem tambem precisa do `launch`.
 *
 * Separada de `jogoEpicEm` porque a maioria dos chamadores so quer o nome, e
 * devolver o objeto em todo lugar convidaria a depender de campos por acidente.
 */
function entradaEpicDe(caminho, catalogo) {
  if (typeof caminho !== "string" || caminho.length === 0) return null;
  const alvo = String(caminho).replace(/\\/g, "/").toLowerCase();
  for (const jogo of catalogo) {
    if (alvo.startsWith(jogo.pasta)) return jogo;
  }
  return null;
}

/**
 * Jogos distintos presentes numa saida de processos.
 *
 * Recebe TEXTO cru (a saida do wmic ou do powershell) em vez de uma lista
 * pronta: as duas ferramentas formatam diferente, e varrer linha a linha
 * procurando o padrao funciona para as duas sem precisar entender o formato
 * de nenhuma.
 *
 * Devolve `[{ chave, nome, caminhos }]`. A `chave` identifica o jogo de forma
 * estavel (pasta na Steam, nome na Epic) e serve para ordenar; o `nome` e o
 * que aparece na tela — e na Epic ele ja vem pronto do manifesto. Os
 * `caminhos` sao TODOS os executaveis daquele jogo que estao rodando, porque
 * e entre eles que se escolhe de onde tirar o icone.
 */
function jogosEmSaida(texto, catalogoEpic = jogosEpic()) {
  const achados = new Map();

  function registrar(chave, nome, caminho) {
    const existente = achados.get(chave);
    if (existente) existente.caminhos.push(caminho);
    else achados.set(chave, { chave, nome, caminhos: [caminho] });
  }

  for (const linha of String(texto).split("\n")) {
    const caminho = linha.trim();
    if (caminho.length === 0) continue;

    const pasta = pastaDoJogo(linha);
    if (pasta) {
      if (ehJogo(pasta)) registrar(pasta, null, caminho);
      continue;
    }
    // So tentamos a Epic quando NAO e da Steam: um jogo nao esta nas duas.
    const entrada = entradaEpicDe(caminho, catalogoEpic);
    if (entrada && ehJogo(entrada.nome)) {
      registrar(entrada.nome, entrada.nome, caminho);
      /**
       * O executavel do MANIFESTO entra junto, mesmo que nao esteja rodando.
       * E o que garante icone para jogo com anti-cheat, cujos processos
       * "livres" podem nao existir enquanto se joga.
       */
      if (entrada.launch) {
        const registro = achados.get(entrada.nome);
        if (registro && !registro.caminhos.includes(entrada.launch)) {
          registro.caminhos.push(entrada.launch);
        }
      }
    }
  }
  return [...achados.values()];
}

/**
 * O nome oficial dentro de um `appmanifest_*.acf`, se ele for do jogo pedido.
 *
 * O `.acf` e um formato proprio da Valve (VDF), mas nao vale trazer um parser
 * inteiro para ler dois campos. `installdir` diz a pasta e `name` diz o nome —
 * e e a pasta que liga o manifesto ao processo que vimos rodando.
 */
function nomeNoManifesto(conteudo, pastaProcurada) {
  const dir = String(conteudo).match(/"installdir"\s+"([^"]+)"/);
  if (!dir || dir[1].toLowerCase() !== String(pastaProcurada).toLowerCase()) {
    return null;
  }
  const nome = String(conteudo).match(/"name"\s+"([^"]+)"/);
  return nome ? nome[1] : null;
}

/**
 * Pasta -> nome oficial, ja resolvido antes.
 *
 * Sem isto, cada verificacao relia TODOS os manifestos do disco enquanto o
 * jogo estivesse aberto — medido: 719ms com a leitura contra ~300ms sem ela,
 * a cada 15 segundos, numa maquina que esta rodando um jogo. O nome de um
 * jogo instalado nao muda enquanto ele roda.
 */
const nomesResolvidos = new Map();

/**
 * Converte a pasta no nome oficial, lendo os manifestos ao lado dela.
 *
 * Se nada casar, devolve a propria pasta: um nome talvez menos bonito e
 * melhor que nenhum, e o jogo continua aparecendo.
 */
function nomeOficial(caminhoDoExecutavel, pasta) {
  const emCache = nomesResolvidos.get(pasta);
  if (emCache) return emCache;

  try {
    const normalizado = caminhoDoExecutavel.replace(/\\/g, "/");
    const corte = normalizado.toLowerCase().indexOf("/steamapps/common/");
    if (corte === -1) return pasta;

    const steamapps = path.normalize(normalizado.slice(0, corte) + "/steamapps");
    for (const arquivo of fs.readdirSync(steamapps)) {
      if (!arquivo.startsWith("appmanifest_") || !arquivo.endsWith(".acf")) {
        continue;
      }
      // utf8 de proposito: sem isso, "Marvel's" vira "Marvelâ€™s".
      const conteudo = fs.readFileSync(path.join(steamapps, arquivo), "utf8");
      const nome = nomeNoManifesto(conteudo, pasta);
      if (nome) {
        nomesResolvidos.set(pasta, nome);
        return nome;
      }
    }
  } catch {
    // Biblioteca em disco removido, permissao negada: o nome da pasta serve.
  }
  // Guarda tambem o caso "nao achei": senao um jogo sem manifesto faria a
  // varredura do disco inteira toda vez, que e justamente o custo evitado.
  nomesResolvidos.set(pasta, pasta);
  return pasta;
}

/* -------------------------------------------------------------------------
 * Icone do jogo
 *
 * Vem do proprio executavel, via `app.getFileIcon` — sem CDN, sem banco de
 * imagens, sem pedir nada para a internet. Funciona igual para Steam, Epic e
 * qualquer coisa que venha depois, porque todo `.exe` de Windows carrega o
 * proprio icone.
 *
 * Nao e a arte de capa que o Discord mostra: aquilo vem do catalogo deles.
 * Aqui e o icone do programa, 48x48 — que e o tamanho em que ele aparece.
 * ------------------------------------------------------------------------- */

/** Icones ja extraidos, por caminho de executavel. Icone de jogo nao muda. */
const iconesResolvidos = new Map();

/**
 * Executaveis que moram na pasta do jogo mas NAO carregam a cara dele.
 *
 * O caso que motivou isto: o Fall Guys aparecia com a logo do Easy Anti-Cheat.
 * O anti-cheat sobe ANTES do jogo, entao existe uma janela em que ele e o
 * unico processo daquela pasta rodando — e o icone capturado ali ficava preso
 * a sessao inteira.
 *
 * Verificado extraindo os icones um a um: `RunFallGuys.exe`,
 * `FallGuys_client.exe` e `FallGuys_client_game.exe` trazem a logo do jogo;
 * so o `start_protected_game.exe` traz o escudo do EAC.
 *
 * Comparado em minusculas contra o NOME do arquivo.
 */
const NAO_DA_ICONE = new Set([
  // Easy Anti-Cheat
  "start_protected_game.exe",
  "easyanticheat.exe",
  "easyanticheat_eos.exe",
  "easyanticheat_eos_setup.exe",
  "eaclauncher.exe",
  // BattlEye
  "beservice.exe",
  "belauncher.exe",
  // Epic Online Services
  "eosbootstrapper.exe",
  "epiconlineservicesinstaller.exe",
  // relatorio de erro e redistribuiveis: nunca sao o jogo
  "crashpad_handler.exe",
  "unitycrashhandler64.exe",
  "unitycrashhandler32.exe",
  "crashreportclient.exe",
]);

/** Este executavel pode emprestar o icone ao jogo? */
function podeDarIcone(caminho) {
  const arquivo = String(caminho).replace(/\\/g, "/").split("/").pop() ?? "";
  const minusculo = arquivo.toLowerCase();
  if (NAO_DA_ICONE.has(minusculo)) return false;
  // Familias inteiras, sem precisar listar cada variante de versao.
  return !/^(vc_redist|vcredist|dxsetup|dotnet|oalinst|ueprereq)/.test(minusculo);
}

/**
 * O melhor icone entre os processos de um jogo.
 *
 * "Melhor" e o data URL MAIOR, e isso nao e chute: um jogo sobe varios
 * processos, e o atalho costuma ter icone pobre. Medido no GTA V —
 * `PlayGTAV.exe` devolve 550 bytes (praticamente um icone generico) e
 * `GTA5.exe` devolve 4126 bytes em 48x48. Pegar o primeiro que aparece daria
 * o pior dos dois.
 */
async function melhorIcone(caminhos) {
  let melhor = null;
  for (const caminho of caminhos) {
    // Anti-cheat, bootstrapper e relator de erro nao emprestam a cara.
    if (!podeDarIcone(caminho)) continue;
    let icone = iconesResolvidos.get(caminho);
    if (icone === undefined) {
      try {
        const imagem = await app.getFileIcon(caminho, { size: "large" });
        icone = imagem.isEmpty() ? null : imagem.toDataURL();
      } catch {
        // Executavel sumiu ou sem permissao: segue sem icone deste.
        icone = null;
      }
      /**
       * Falha NAO vira cache. Anti-cheat pode segurar o arquivo por um
       * instante, e guardar o `null` deixaria aquele executavel sem icone para
       * sempre — mesmo depois de liberar.
       */
      if (icone) iconesResolvidos.set(caminho, icone);
    }
    if (icone && (!melhor || icone.length > melhor.length)) melhor = icone;
  }
  return melhor;
}

function executar(comando, argumentos) {
  return new Promise((resolve, reject) => {
    execFile(
      comando,
      argumentos,
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (erro, saida) => (erro ? reject(erro) : resolve(saida)),
    );
  });
}

/**
 * Lista os caminhos dos processos em execucao.
 *
 * `wmic` primeiro porque e MUITO mais barato: medido nesta maquina, ~300ms
 * contra ~1600ms do PowerShell. Numa maquina que esta rodando um jogo, um
 * segundo e meio de processo em segundo plano se sente.
 *
 * O PowerShell fica de reserva porque o `wmic` foi removido por padrao a
 * partir do Windows 11 24H2 — sem a reserva, a deteccao simplesmente nao
 * existiria para quem tem Windows novo.
 */
async function caminhosDeProcessos() {
  try {
    return await executar("wmic", ["process", "get", "ExecutablePath"]);
  } catch {
    return executar("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-Process).Path",
    ]);
  }
}

/**
 * O jogo rodando agora como `{ nome, icone }`, ou `null`.
 *
 * O icone pode vir `null` sozinho: nem todo executavel entrega um, e nome sem
 * icone continua sendo informacao util.
 */
async function jogoAtual() {
  if (process.platform !== "win32") return null;

  const saida = await caminhosDeProcessos();
  const achados = jogosEmSaida(saida);
  if (achados.length === 0) return null;

  /**
   * Mais de um jogo aberto e caso raro e sem resposta certa. Ordenar e pegar
   * o primeiro nao e "o melhor", e o ESTAVEL: sem isso o nome ficaria
   * alternando entre os dois a cada verificacao.
   */
  const escolhido = achados.sort((a, b) => a.chave.localeCompare(b.chave))[0];
  const icone = await melhorIcone(escolhido.caminhos);

  // Epic ja trouxe o nome pronto do manifesto; Steam precisa resolver.
  if (escolhido.nome) return { nome: escolhido.nome, icone };

  const normalizada = escolhido.chave.replace(/\\/g, "/");
  for (const caminho of escolhido.caminhos) {
    if (caminho.replace(/\\/g, "/").includes(`/steamapps/common/${normalizada}/`)) {
      return { nome: nomeOficial(caminho, escolhido.chave), icone };
    }
  }
  return { nome: escolhido.chave, icone };
}

/**
 * Vigia em segundo plano. Avisa SO quando o jogo muda — mandar o mesmo nome a
 * cada 15 segundos seria trafego e re-render sem nenhuma informacao nova.
 */
function criarVigia(aoMudar) {
  let timer = null;
  let ultimo = null;

  async function verificar() {
    try {
      const jogo = await jogoAtual();
      /**
       * Comparacao por VALOR, nao pelo objeto: `jogoAtual` devolve um objeto
       * novo a cada chamada, e `===` entre objetos nunca e verdade — sem isto
       * o app anunciaria o mesmo jogo para a sala inteira a cada 15 segundos.
       *
       * O icone entra na comparacao junto com o nome, e nao so o nome. Jogo
       * com anti-cheat sobe em etapas: existe uma janela em que a pasta so tem
       * o processo do anti-cheat, e o icone daquele instante e pior (ou era o
       * escudo do EAC). Comparando so o nome, o primeiro icone ficava preso a
       * sessao inteira; comparando os dois, ele MELHORA assim que o processo
       * do jogo aparece.
       */
      if (
        (jogo?.nome ?? null) === (ultimo?.nome ?? null) &&
        (jogo?.icone ?? null) === (ultimo?.icone ?? null)
      ) {
        return;
      }
      ultimo = jogo;
      aoMudar(jogo);
    } catch {
      // Uma falha de leitura nao pode derrubar o app: na proxima tentativa
      // provavelmente funciona, e ate la o estado anterior continua valendo.
    }
  }

  return {
    /**
     * O jogo conhecido AGORA, sem esperar a proxima verificacao.
     *
     * Existe por causa de uma corrida: com a deteccao ja ligada, o vigia
     * comeca junto com o app — antes de a pagina existir. Esse primeiro aviso
     * ia para uma janela que ainda nao carregou e se perdia; como so avisamos
     * em MUDANCA, o jogo nunca mais era enviado e nada aparecia. A pagina
     * pergunta isto ao montar e fecha o buraco.
     */
    atual: () => ultimo,

    iniciar() {
      if (timer) return;
      void verificar(); // resposta imediata, sem esperar o primeiro intervalo
      timer = setInterval(() => void verificar(), POLL_MS);
    },
    parar() {
      if (timer) clearInterval(timer);
      timer = null;
      // Avisa que nao ha mais jogo: desligar precisa APAGAR o que ficou
      // aparecendo para os outros, nao so parar de atualizar.
      if (ultimo !== null) {
        ultimo = null;
        aoMudar(null);
      }
    },
  };
}

module.exports = {
  criarVigia,
  jogoAtual,
  // exportados para os testes — sao a logica que decide o que vira nome
  pastaDoJogo,
  ehJogo,
  jogosEmSaida,
  nomeNoManifesto,
  jogoEpicEm,
  comoPasta,
  podeDarIcone,
  jogosEpic,
};
