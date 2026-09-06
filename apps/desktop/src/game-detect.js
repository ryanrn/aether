"use strict";

const { app, nativeImage } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { registrar } = require("./log");

/**
 * Log de DIAGNOSTICO da deteccao.
 *
 * Chega ao `aether.log` como qualquer outra linha. So os momentos que
 * importam quando um jogo "some sozinho": o que foi fixado, quando o processo
 * anti-cheat segurou o jogo, quando soltou. Nao loga a cada verificacao — so
 * quando o estado muda. Nunca inclui caminho (carrega o nome de usuario do
 * Windows): so nome de executavel e de jogo.
 */
function diag(assunto, dados) {
  try {
    registrar(`deteccao:${assunto}`, dados);
  } catch {
    // Log que quebra a deteccao seria pior que nao ter log.
  }
}

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
 *  - RIOT: como a Epic, sem convencao de pasta (o VALORANT desta maquina esta
 *    em `D:/Riot Games/VALORANT/live`). Escreve `product_install_full_path`
 *    num YAML por produto, e ainda deixa um `.ico` pronto ao lado.
 *
 *  - UBISOFT e GOG: a biblioteca mora no REGISTRO. A Ubisoft da so o caminho,
 *    mas ali a pasta ja e o nome de marca; o GOG da caminho e `gameName`.
 *
 *  - XBOX: instala em `<disco>:/XboxGames/<Nome>/`, e a pasta e o nome.
 *
 * Isso cobre qualquer jogo dessas lojas, inclusive os instalados depois, sem
 * cadastrar nada.
 *
 * POR QUE NAO OLHAMOS O NOME DO EXECUTAVEL. Seria o caminho obvio para o
 * VALORANT (`VALORANT-Win64-Shipping.exe`), e e uma armadilha: exige uma
 * tabela `executavel -> jogo` mantida a mao, que so cobre o que alguem
 * cadastrou e envelhece a cada lancamento. Perguntar a loja onde ela instalou
 * cobre a biblioteca inteira de graca, hoje e daqui a um ano.
 *
 * O que ainda NAO cobre: Battle.net, EA e jogos avulsos. Anotado no README.
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

/* -------------------------------------------------------------------------
 * Riot Games
 *
 * Mesmo problema da Epic — nao ha convencao de pasta. O VALORANT desta
 * maquina esta em `D:/Riot Games/VALORANT/live`, e nao no `C:\Riot Games`
 * padrao. E a mesma solucao: a propria Riot escreve onde instalou.
 *
 * `Metadata/<produto>/<produto>.product_settings.yaml` traz
 * `product_install_full_path`. Dois campos de um YAML nao justificam um
 * parser de YAML — a mesma decisao ja tomada para o `.acf` da Steam.
 *
 * O LAUNCHER se exclui sozinho, sem lista negra: `Riot Client` tem
 * `Riot Client.settings.yaml`, e nao `.product_settings.yaml`. Exigir o
 * sufixo de produto deixa o cliente de fora — e ele fica de pe o tempo todo,
 * entao casar com ele diria "jogando" para quem so abriu o launcher.
 * ------------------------------------------------------------------------- */

const METADATA_RIOT = "C:/ProgramData/Riot Games/Metadata";

/** Segmentos que sao LINHA DE ATUALIZACAO, e nao nome de jogo. */
const PATCHLINES = new Set(["live", "pbe", "beta", "esports"]);

/**
 * O nome do jogo a partir do que a Riot escreveu.
 *
 * `shortcut_name` primeiro, porque e o nome de marca ("VALORANT.lnk",
 * "Teamfight Tactics.lnk"). Quando ele nao existe — e no League of Legends
 * nao existe — vale o ultimo segmento util do caminho de instalacao, que na
 * Riot ja vem com a grafia certa: `C:/Riot Games/League of Legends`.
 *
 * Por que nao derivar da pasta de metadata: ela e `league_of_legends.live`, e
 * qualquer conversao daria "League Of Legends", com o "Of" maiusculo errado.
 */
function nomeRiot(conteudo, caminhoInstalado) {
  const atalho = String(conteudo).match(/^shortcut_name:\s*"([^"]+)"/m);
  if (atalho) return atalho[1].replace(/\.lnk$/i, "");

  const partes = String(caminhoInstalado)
    .replace(/\\/g, "/")
    .split("/")
    .filter((parte) => parte.length > 0);
  for (let i = partes.length - 1; i >= 0; i -= 1) {
    if (!PATCHLINES.has(partes[i].toLowerCase())) return partes[i];
  }
  return null;
}

function lerJogosRiot() {
  const jogos = [];
  try {
    for (const produto of fs.readdirSync(METADATA_RIOT)) {
      try {
        const pastaProduto = path.join(METADATA_RIOT, produto);
        const conteudo = fs.readFileSync(
          path.join(pastaProduto, `${produto}.product_settings.yaml`),
          "utf8",
        );
        const local = conteudo.match(/^product_install_full_path:\s*"([^"]+)"/m);
        if (!local) continue;

        const nome = nomeRiot(conteudo, local[1]);
        if (!nome) continue;

        /**
         * O `.ico` do proprio produto, ao lado do YAML.
         *
         * A Riot e a unica das lojas que entrega a arte pronta. Nas outras o
         * icone sai do `.exe`, que e 48x48; aqui ha um arquivo de icone de
         * verdade, e ele existe mesmo com o jogo fechado — o que importa em
         * jogo com anti-cheat, cujos processos nem sempre podem ser lidos.
         */
        const ico = path.join(pastaProduto, `${produto}.ico`);
        jogos.push({
          pasta: comoPasta(local[1]),
          nome,
          launch: null,
          icone: fs.existsSync(ico) ? ico : null,
        });
      } catch {
        // Produto sendo escrito ou ilegivel: perde este, nao a deteccao.
      }
    }
  } catch {
    // Riot nao instalada nesta maquina — caso normal, nao erro.
  }
  return jogos;
}

let riotCache = { assinatura: null, jogos: [] };

function jogosRiot() {
  let assinatura = null;
  try {
    assinatura = String(fs.statSync(METADATA_RIOT).mtimeMs);
  } catch {
    return [];
  }
  if (riotCache.assinatura !== assinatura) {
    const jogos = lerJogosRiot();
    // Vazio nao vira cache, pelo mesmo motivo da Epic.
    if (jogos.length > 0) riotCache = { assinatura, jogos };
    return jogos;
  }
  return riotCache.jogos;
}

/* -------------------------------------------------------------------------
 * Lojas que guardam a biblioteca no REGISTRO (Ubisoft, GOG)
 *
 * Lidas com `reg query`, e nao com uma dependencia nativa: o arquivo ja fala
 * com o Windows por linha de comando (`wmic`, `powershell`), e trazer um
 * modulo compilado so para ler duas chaves custaria rebuild a cada versao de
 * Electron.
 * ------------------------------------------------------------------------- */

/** `reg query` que devolve texto vazio quando a chave nao existe. */
async function lerRegistro(chave) {
  try {
    return await executar("reg", ["query", chave, "/s"]);
  } catch {
    // Chave ausente = loja nao instalada. Nao e erro.
    return "";
  }
}

/**
 * Um bloco por sub-chave, como `[{ chave, valores }]`.
 *
 * A saida do `reg query /s` vem em blocos: uma linha com o caminho da chave e
 * abaixo `  NOME    REG_SZ    valor`. Agrupar por bloco importa porque no GOG
 * o nome e o caminho do jogo sao dois valores da MESMA sub-chave — casa-los
 * por posicao daria jogo com o nome do vizinho.
 */
function blocosDoRegistro(texto) {
  const blocos = [];
  let atual = null;
  /**
   * Quebra em `\r?\n`, e nao so em `\n`.
   *
   * O `reg` termina cada linha em CRLF, e o `\r` que sobrava impedia o `$` do
   * regex de valor de casar — `.` nao casa `\r`. O efeito era SILENCIOSO e
   * pior que um erro: a chave era encontrada, o bloco existia, e a lista de
   * valores vinha vazia. Na pratica, a loja inteira ficava sem jogo nenhum.
   *
   * Um teste de fixture escrito a mao, com `\n`, teria passado.
   */
  for (const linha of String(texto).split(/\r?\n/)) {
    const limpa = linha.trim();
    if (/^HKEY_/i.test(limpa)) {
      atual = { chave: limpa, valores: new Map() };
      blocos.push(atual);
      continue;
    }
    const valor = linha.match(/^\s+(.+?)\s+REG_[A-Z_]+\s+(.*)$/);
    if (valor && atual) {
      atual.valores.set(valor[1].trim().toLowerCase(), valor[2].trim());
    }
  }
  return blocos;
}

/** O nome do jogo a partir da pasta de instalacao. */
function nomePelaPasta(caminho) {
  const partes = String(caminho)
    .replace(/\\/g, "/")
    .split("/")
    .filter((parte) => parte.length > 0);
  return partes.length > 0 ? partes[partes.length - 1] : null;
}

/**
 * Ubisoft Connect.
 *
 * `HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs\<id>\InstallDir`.
 * O registro so da o caminho, mas na Ubisoft a pasta JA e o nome de marca —
 * nesta maquina, `D:/Tom Clancy's Rainbow Six Siege/`, com o apostrofo certo
 * que na Steam so existe dentro do manifesto.
 */
async function jogosUbisoft() {
  const texto = await lerRegistro(
    "HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs",
  );
  const jogos = [];
  for (const bloco of blocosDoRegistro(texto)) {
    const dir = bloco.valores.get("installdir");
    if (!dir) continue;
    const nome = nomePelaPasta(dir);
    if (nome) {
      jogos.push({ pasta: comoPasta(dir), nome, launch: null, icone: null });
    }
  }
  return jogos;
}

/**
 * GOG Galaxy.
 *
 * `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<id>` guarda `path` e `gameName`
 * na mesma sub-chave — a unica loja que entrega os dois juntos.
 */
async function jogosGog() {
  const texto = await lerRegistro(
    "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games",
  );
  const jogos = [];
  for (const bloco of blocosDoRegistro(texto)) {
    const dir = bloco.valores.get("path");
    if (!dir) continue;
    const nome = bloco.valores.get("gamename") || nomePelaPasta(dir);
    if (nome) {
      jogos.push({ pasta: comoPasta(dir), nome, launch: null, icone: null });
    }
  }
  return jogos;
}

/**
 * Xbox / Microsoft Store.
 *
 * Instala em `<disco>:/XboxGames/<Nome do Jogo>/`, e ali a pasta e o nome de
 * marca. NAO lemos `WindowsApps`: aquela pasta e protegida por ACL e listar
 * dela exige elevacao, que um app de bandeja nao deve pedir.
 */
function jogosXbox() {
  const jogos = [];
  for (const letra of "CDEFGH") {
    const raiz = `${letra}:/XboxGames`;
    try {
      for (const pasta of fs.readdirSync(raiz)) {
        jogos.push({
          pasta: comoPasta(`${raiz}/${pasta}`),
          nome: pasta,
          launch: null,
          icone: null,
        });
      }
    } catch {
      // Disco sem XboxGames: o caso normal.
    }
  }
  return jogos;
}

/**
 * O catalogo de TODAS as lojas que dizem o que instalaram.
 *
 * A Steam nao entra aqui: ela e a unica com convencao de pasta
 * (`steamapps/common/<Jogo>/`), entao e reconhecida pelo caminho do processo,
 * sem catalogo. As outras precisam dizer onde puseram o jogo.
 *
 * Uma loja com problema nao derruba as outras — `allSettled`, e nao `all`: se
 * o `reg query` travar, o jogo da Riot continua sendo detectado.
 */
async function catalogoDeLojas() {
  const doRegistro = await Promise.allSettled([jogosUbisoft(), jogosGog()]);
  return [
    ...jogosEpic(),
    ...jogosRiot(),
    ...jogosXbox(),
    ...doRegistro.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
  ];
}

/**
 * Um jogo de CATALOGO rodando neste caminho? Devolve o nome, ou `null`.
 *
 * Serve Epic, Riot, Ubisoft, GOG e Xbox com a mesma conta, porque todas
 * respondem a mesma pergunta: "onde voce instalou?". So a Steam fica de fora,
 * e por ter convencao de pasta propria.
 *
 * Nenhum LAUNCHER casa: os catalogos apontam para pastas de JOGO, e o
 * launcher mora fora delas. E o que impede o Riot Client — que fica aberto o
 * tempo todo — de virar "jogando VALORANT".
 */
function jogoDeCatalogoEm(caminho, catalogo) {
  return entradaDeCatalogo(caminho, catalogo)?.nome ?? null;
}

/**
 * A entrada INTEIRA do catalogo, para quem tambem precisa do `launch`.
 *
 * Separada de `jogoDeCatalogoEm` porque a maioria dos chamadores so quer o nome, e
 * devolver o objeto em todo lugar convidaria a depender de campos por acidente.
 */
function entradaDeCatalogo(caminho, catalogo) {
  if (typeof caminho !== "string" || caminho.length === 0) return null;
  const alvo = String(caminho).replace(/\\/g, "/").toLowerCase();
  for (const jogo of catalogo) {
    if (alvo.startsWith(jogo.pasta)) return jogo;
  }
  return null;
}

/**
 * Nome de processo ou de jogo reduzido ao que da para comparar.
 *
 * Tira extensao, pontuacao e caixa: "VALORANT-Win64-Shipping.exe" e
 * "VALORANT" precisam se encontrar, e o executavel raramente se chama
 * exatamente como o jogo.
 */
function normalizarNomeDeJogo(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .replace(/\.exe$/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Nome curto demais nao pode casar por prefixo.
 *
 * Sem este piso, um jogo chamado "Rust" faria qualquer `rustdesk.exe` virar
 * "voce esta jogando Rust". Nome curto ainda casa, mas so EXATO.
 */
const MINIMO_PARA_PREFIXO = 5;

/**
 * A entrada do catalogo que corresponde a um processo, olhando SO o nome.
 *
 * POR QUE EXISTE: jogo com anti-cheat de kernel esconde o proprio caminho. O
 * Vanguard, do VALORANT, faz o `wmic` e o `Get-Process` devolverem caminho
 * VAZIO para `VALORANT-Win64-Shipping.exe` — nao e erro nosso, e protecao do
 * anti-cheat contra leitura de processo. Como toda a deteccao era por
 * caminho, o jogo mais pedido da maquina era justamente o unico invisivel.
 *
 * O nome, esse o Vanguard nao esconde. E ele basta, porque o catalogo ja diz
 * quais jogos ESTAO INSTALADOS aqui — nao e uma lista de nomes conhecidos
 * mantida a mao, e sim o cruzamento de "o que a loja instalou" com "o que
 * esta rodando".
 */
function entradaPorNomeDeProcesso(nomeProcesso, catalogo) {
  const alvo = normalizarNomeDeJogo(nomeProcesso);
  if (alvo.length === 0) return null;

  for (const jogo of catalogo) {
    const nome = normalizarNomeDeJogo(jogo.nome);
    if (nome.length === 0) continue;
    if (alvo === nome) return jogo;
    /**
     * Prefixo cobre o sufixo de motor que quase todo jogo carrega:
     * `VALORANT-Win64-Shipping`, `FortniteClient-Win64-Shipping`. O piso de
     * tamanho impede que nome curto vire curinga.
     */
    if (nome.length >= MINIMO_PARA_PREFIXO && alvo.startsWith(nome)) return jogo;
  }
  return null;
}

/**
 * Jogos reconhecidos pelos NOMES dos processos.
 *
 * Devolve no mesmo formato de `jogosEmSaida` para os dois se juntarem sem
 * tratamento especial. `caminhos` sai vazio de proposito: quando o anti-cheat
 * esconde o caminho, nao ha executavel legivel para tirar icone — e por isso
 * o `launch` do manifesto e o `.ico` da loja entram aqui, que e exatamente
 * para o que eles ja existiam.
 */
function jogosPorNomes(texto, catalogo = []) {
  const achados = new Map();

  for (const linha of String(texto).split(/\r?\n/)) {
    const nome = linha.trim();
    if (nome.length === 0) continue;

    const entrada = entradaPorNomeDeProcesso(nome, catalogo);
    if (!entrada || !ehJogo(entrada.nome)) continue;
    if (achados.has(entrada.nome)) continue;

    const registro = { chave: entrada.nome, nome: entrada.nome, caminhos: [] };
    if (entrada.launch) registro.caminhos.push(entrada.launch);
    if (entrada.icone) registro.icone = entrada.icone;
    achados.set(entrada.nome, registro);
  }

  return [...achados.values()];
}

/* -------------------------------------------------------------------------
 * Biblioteca da comunidade
 *
 * O que as pessoas ensinaram ao app e a equipe aprovou. Chega da PAGINA, por
 * IPC, e nao e buscado aqui: o processo principal nao tem a sessao (os cookies
 * vivem no renderer), e dar-lhe uma seria criar um segundo lugar com
 * credencial para nada.
 *
 * Guardado em memoria e tambem em disco pelo `main.js`, para valer ja na
 * primeira deteccao depois de abrir — antes de a pagina carregar.
 *
 * CASAMENTO POR IGUALDADE EXATA, e nao por prefixo como o catalogo das lojas.
 * A diferenca tem razao: no catalogo da loja a chave e o NOME DO JOGO, e o
 * executavel costuma ser o nome mais um sufixo de motor; aqui a chave JA E o
 * executavel normalizado. Aceitar prefixo faria `sot` casar com qualquer
 * `sotsomething.exe`.
 * ------------------------------------------------------------------------- */

let catalogoDaComunidade = [];

/** Trocado inteiro, e nao mesclado: a lista aprovada e a verdade completa. */
function definirCatalogoDaComunidade(lista) {
  catalogoDaComunidade = Array.isArray(lista)
    ? lista
        .filter((j) => j && typeof j.chave === "string" && typeof j.nome === "string")
        .map((j) => ({ chave: j.chave, nome: j.nome }))
    : [];
  return catalogoDaComunidade.length;
}

function lerCatalogoDaComunidade() {
  return catalogoDaComunidade;
}

/** Jogos da comunidade presentes numa lista de NOMES de processo. */
function jogosDaComunidadeEm(texto, comunidade = catalogoDaComunidade) {
  if (comunidade.length === 0) return [];
  const porChave = new Map(comunidade.map((j) => [j.chave, j]));
  const achados = new Map();

  for (const linha of String(texto).split(/\r?\n/)) {
    const chave = normalizarNomeDeJogo(linha.trim());
    if (chave.length === 0) continue;
    const jogo = porChave.get(chave);
    if (!jogo || achados.has(jogo.nome)) continue;
    achados.set(jogo.nome, { chave: jogo.nome, nome: jogo.nome, caminhos: [] });
  }
  return [...achados.values()];
}

/**
 * Processos que a pessoa poderia sugerir como jogo.
 *
 * Devolve NOMES, nunca caminhos — pelo mesmo motivo de a biblioteca guardar
 * executavel: caminho carrega o nome de usuario do Windows.
 *
 * Tira o que ja e reconhecido (nao ha o que sugerir) e o ruido obvio do
 * sistema. A lista NAO tenta adivinhar o que e jogo: adivinhar erraria para os
 * dois lados, e quem sabe se aquilo e um jogo e a pessoa que esta olhando.
 */
function candidatosParaSugerir(texto, catalogo = [], comunidade = catalogoDaComunidade) {
  const conhecidos = new Set(comunidade.map((j) => j.chave));
  const vistos = new Set();
  const candidatos = [];

  for (const linha of String(texto).split(/\r?\n/)) {
    const nome = linha.trim();
    if (nome.length === 0 || nome.toLowerCase() === "name") continue;

    const chave = normalizarNomeDeJogo(nome);
    if (chave.length < 3 || vistos.has(chave)) continue;
    if (conhecidos.has(chave)) continue;
    if (RUIDO_DO_SISTEMA.has(chave)) continue;
    if (entradaPorNomeDeProcesso(nome, catalogo)) continue;

    vistos.add(chave);
    candidatos.push(nome);
  }

  return candidatos.sort((a, b) => a.localeCompare(b));
}

/**
 * O que nunca e jogo.
 *
 * Lista curta e do OBVIO de proposito. Ela nao existe para acertar o que e
 * jogo — existe para a lista nao abrir com trinta processos do Windows antes
 * do primeiro nome reconhecivel. Errar para menos aqui custa uma linha a mais
 * para a pessoa ler; errar para mais esconderia o jogo que ela veio sugerir.
 */
const RUIDO_DO_SISTEMA = new Set(
  [
    "system", "systemidleprocess", "registry", "smss", "csrss", "wininit",
    "winlogon", "services", "lsass", "svchost", "fontdrvhost", "dwm",
    "explorer", "taskhostw", "ctfmon", "runtimebroker", "searchhost",
    "startmenuexperiencehost", "shellexperiencehost", "sihost", "conhost",
    "dllhost", "spoolsv", "audiodg", "wmiprvse", "backgroundtaskhost",
    "applicationframehost", "textinputhost", "lockapp", "useroobebroker",
    "securityhealthservice", "securityhealthsystray", "msmpeng", "nissrv",
    "aether", "electron", "node", "cmd", "powershell", "pwsh", "wsl",
    "chrome", "msedge", "firefox", "opera", "brave",
  ].map((n) => n),
);

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
function jogosEmSaida(texto, catalogo = []) {
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
    // So olhamos o catalogo quando NAO e da Steam: um jogo nao esta nas duas.
    const entrada = entradaDeCatalogo(caminho, catalogo);
    if (entrada && ehJogo(entrada.nome)) {
      registrar(entrada.nome, entrada.nome, caminho);
      /**
       * O executavel do MANIFESTO entra junto, mesmo que nao esteja rodando.
       * E o que garante icone para jogo com anti-cheat, cujos processos
       * "livres" podem nao existir enquanto se joga.
       */
      const registro = achados.get(entrada.nome);
      if (entrada.launch && registro && !registro.caminhos.includes(entrada.launch)) {
        registro.caminhos.push(entrada.launch);
      }
      /**
       * O `.ico` que a Riot ja deixa pronto. Guardado a parte dos caminhos
       * porque nao e executavel: `app.getFileIcon` le programa, e este e
       * arquivo de icone.
       */
      if (entrada.icone && registro) registro.icone = entrada.icone;
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

/** Icones ja lidos de arquivo `.ico`, por caminho. */
const iconesDeArquivo = new Map();

/**
 * O icone que a loja ja deixou pronto em disco, como data URL.
 *
 * REDIMENSIONADO PARA 48px de proposito, e nao usado no tamanho original: o
 * `.ico` da Riot tem varias resolucoes, e a maior passa de 256px. Este data
 * URL nao fica na maquina — ele viaja para o gateway e de la para TODO MUNDO
 * que ve o seu cartao de atividade, a cada troca de jogo. 48px e o tamanho em
 * que ele aparece, e e o mesmo que `app.getFileIcon` devolve para as outras
 * lojas; a arte grande de verdade e a capa do IGDB, que vem por outro caminho.
 */
function iconeDeArquivo(caminho) {
  if (!caminho) return null;
  const emCache = iconesDeArquivo.get(caminho);
  if (emCache !== undefined) return emCache;
  try {
    const imagem = nativeImage.createFromPath(caminho);
    if (imagem.isEmpty()) return null;
    const url = imagem.resize({ width: 48, height: 48 }).toDataURL();
    iconesDeArquivo.set(caminho, url);
    return url;
  } catch {
    // Arquivo ilegivel: cai no icone do executavel, como antes.
    return null;
  }
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
 * Lista os NOMES dos processos em execucao.
 *
 * Consulta separada da de caminhos porque responde a uma pergunta que a outra
 * nao consegue: jogo com anti-cheat de kernel devolve caminho VAZIO. Medido
 * nesta maquina com o VALORANT aberto, `VALORANT-Win64-Shipping` aparece na
 * lista de nomes e some na de caminhos.
 *
 * As duas rodam EM PARALELO em `jogoAtual`, entao o custo em tempo e o da
 * mais lenta, e nao a soma.
 */
async function nomesDeProcessos() {
  try {
    return await executar("wmic", ["process", "get", "Name"]);
  } catch {
    return executar("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-Process).ProcessName",
    ]);
  }
}

/* -------------------------------------------------------------------------
 * Jogo FIXADO — sobreviver ao anti-cheat que esconde o caminho DEPOIS
 *
 * O caso: um jogo do Steam abre normal, o caminho casa
 * `steamapps/common/<Jogo>/` e a atividade aparece. Segundos depois o Easy
 * Anti-Cheat (ou BattlEye, ou Vanguard) relanca o jogo como processo
 * protegido e o caminho para de ser legivel. O Steam nao tem catalogo (e
 * reconhecido so pela pasta), entao a busca por nome nao tinha o que casar —
 * e o jogo sumia da tela no instante em que o anti-cheat carregava.
 *
 * A saida: quando um jogo e visto POR CAMINHO, guardamos os NOMES dos
 * executaveis dele. O nome o anti-cheat nao esconde (so o caminho). Enquanto
 * qualquer um desses nomes seguir na lista de processos, o jogo continua na
 * tela, com o mesmo icone que ja tinha. Some quando todos somem.
 * ------------------------------------------------------------------------- */

/**
 * Processos de anti-cheat que NAO identificam um jogo — sao os mesmos para
 * todo jogo que usa aquele anti-cheat. Fixar um jogo por eles faria "fechei o
 * GunZ e abri o Fall Guys" continuar mostrando GunZ.
 */
const EXE_GENERICO_DE_ANTICHEAT = new Set([
  // Easy Anti-Cheat
  "start_protected_game.exe",
  "easyanticheat.exe",
  "easyanticheat_eos.exe",
  "easyanticheat_eos_setup.exe",
  "eaclauncher.exe",
  // BattlEye
  "beservice.exe",
  "beservice_x64.exe",
  "belauncher.exe",
  "battleye.exe",
  // Riot Vanguard
  "vgc.exe",
  "vgtray.exe",
]);

/** O jogo visto por caminho da ultima vez, e os nomes de processo dele. */
let jogoFixado = null; // { nome, icone, exes: Set<string> }

/** Base de um caminho de executavel, minuscula: `.../GunZ.exe` -> `gunz.exe`. */
function nomeDeExecutavel(caminho) {
  const base = String(caminho).replace(/\\/g, "/").split("/").pop();
  return base ? base.toLowerCase() : "";
}

/**
 * O NOME do executavel que o Easy Anti-Cheat protege, lido do proprio jogo.
 *
 * POR QUE ISTO E A PECA QUE FALTAVA: quando o EAC sobe, ele NEGA `OpenProcess`
 * ao processo do jogo — entao `wmic`/`Get-Process` devolvem CAMINHO vazio e o
 * jogo do Steam some da varredura (o Steam nao tem catalogo, so a pasta). Mas
 * o NOME do processo continua visivel (`EnumProcesses` nao depende de
 * `OpenProcess`). Falta so saber QUAL nome — e o proprio jogo diz, no
 * `EasyAntiCheat/Launcher/Settings.json`, campo `executable`. E o mesmo
 * arquivo que o EAC usa para lancar o jogo, e o mesmo que o Playnite le para
 * detectar jogo protegido.
 *
 * Recebe um caminho de executavel visto na pasta do jogo e sobe ate 5 niveis
 * procurando o `Settings.json` — o exe costuma estar em `Binaries/Win64/`, e o
 * arquivo do EAC fica na raiz do jogo.
 *
 * Cacheado por pasta: o alvo nao muda enquanto o jogo esta instalado.
 */
const exeDeEacResolvido = new Map();

/**
 * DUAS localizacoes, porque ha duas geracoes do Easy Anti-Cheat:
 *
 *  - `EasyAntiCheat/Launcher/Settings.json` — EAC classico (Rocket League,
 *    Fall Guys). E o que o Playnite documenta.
 *  - `EasyAntiCheat/Settings.json` — EAC EOS (Epic Online Services), a versao
 *    nova. E onde o GunZ: The Duel poe o arquivo — verificado na instalacao
 *    real, e o motivo de a primeira tentativa nao pegar Steam + EAC.
 *
 * O campo `executable` pode vir so o nome (`"Gunz.exe"`) ou com subpasta
 * (`"Binaries/Win64/Game.exe"`); `.split("/").pop()` cobre os dois.
 */
const CAMINHOS_DE_SETTINGS_EAC = [
  ["EasyAntiCheat", "Launcher", "Settings.json"],
  ["EasyAntiCheat", "Settings.json"],
];

function nomeProtegidoPorEac(caminhoNaPastaDoJogo) {
  let dir;
  try {
    dir = path.dirname(String(caminhoNaPastaDoJogo).replace(/\//g, path.sep));
  } catch {
    return null;
  }

  for (let nivel = 0; nivel < 5; nivel += 1) {
    const emCache = exeDeEacResolvido.get(dir);
    if (emCache !== undefined) return emCache || null;

    let nome = null;
    for (const partes of CAMINHOS_DE_SETTINGS_EAC) {
      try {
        const dados = JSON.parse(
          fs.readFileSync(path.join(dir, ...partes), "utf8"),
        );
        const rel =
          dados && typeof dados.executable === "string" ? dados.executable : "";
        if (rel) {
          nome = String(rel).replace(/\\/g, "/").split("/").pop().toLowerCase();
          break;
        }
      } catch {
        // Este caminho nao existe aqui — tenta o proximo.
      }
    }

    // String vazia = "olhei nesta pasta e nao ha EAC" — para a proxima chamada
    // parar aqui em vez de subir os 5 niveis de novo.
    exeDeEacResolvido.set(dir, nome || "");
    if (nome) return nome;

    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  return null;
}

/**
 * Fixa o jogo recem-detectado por caminho, guardando os nomes de processo
 * dele — para segura-lo na tela quando o anti-cheat esconder o caminho DEPOIS.
 *
 * Duas fontes:
 *  1. os executaveis vistos rodando na pasta (menos os genericos de anti-cheat
 *     e ruido de sistema);
 *  2. o `executable` do `Settings.json` do Easy Anti-Cheat, se houver — este e
 *     o mais confiavel, porque e EXATAMENTE o processo que o EAC vai proteger,
 *     dito pelo proprio jogo.
 *
 * Sem nenhum dos dois, nao fixa.
 */
function fixarJogo(jogo, caminhos) {
  const exes = new Set();
  let achouEac = false;

  for (const c of caminhos || []) {
    const base = nomeDeExecutavel(c);
    const semExt = base.replace(/\.exe$/, "");
    if (
      base.endsWith(".exe") &&
      !EXE_GENERICO_DE_ANTICHEAT.has(base) &&
      !RUIDO_DO_SISTEMA.has(semExt)
    ) {
      exes.add(base);
    }

    // O `Settings.json` do EAC mora na raiz do jogo; `c` esta dentro dela.
    const eac = nomeProtegidoPorEac(c);
    if (eac) {
      exes.add(eac);
      achouEac = true;
    }
  }

  const antes = jogoFixado?.nome ?? null;
  jogoFixado =
    exes.size > 0 ? { nome: jogo.nome, icone: jogo.icone ?? null, exes } : null;

  if ((jogoFixado?.nome ?? null) !== antes) {
    diag("fixado", {
      jogo: jogo.nome,
      exes: [...exes],
      eacSettings: achouEac,
      // basename dos caminhos vistos — sem o caminho, so o nome do arquivo
      processosVistos: (caminhos || []).map(nomeDeExecutavel),
      fixou: jogoFixado !== null,
    });
  }
}

/**
 * O jogo fixado ainda esta rodando? Devolve `{ nome, icone }` ou `null`,
 * limpando o estado quando todos os processos dele sumiram.
 *
 * `saidaDeNomes` e a lista crua de `wmic`/`Get-Process` — uma traz `.exe`, a
 * outra nao, entao casamos as duas formas.
 */
let jogoFixadoJaLogado = null;

function jogoFixadoAindaVivo(saidaDeNomes) {
  if (!jogoFixado) return null;
  const rodando = new Set();
  for (const linha of String(saidaDeNomes).split(/\r?\n/)) {
    const n = linha.trim().toLowerCase();
    if (!n) continue;
    rodando.add(n);
    rodando.add(n.replace(/\.exe$/, ""));
  }
  const vivo = [...jogoFixado.exes].some(
    (exe) => rodando.has(exe) || rodando.has(exe.replace(/\.exe$/, "")),
  );
  if (vivo) {
    if (jogoFixadoJaLogado !== jogoFixado.nome) {
      jogoFixadoJaLogado = jogoFixado.nome;
      diag("segurou-pelo-nome", {
        jogo: jogoFixado.nome,
        exes: [...jogoFixado.exes],
      });
    }
    return { nome: jogoFixado.nome, icone: jogoFixado.icone };
  }
  diag("soltou", {
    jogo: jogoFixado.nome,
    exes: [...jogoFixado.exes],
    // por que soltou: nenhum dos nomes esperados estava rodando
    motivo: "processos sumiram",
  });
  jogoFixado = null;
  jogoFixadoJaLogado = null;
  return null;
}

/**
 * O jogo rodando agora como `{ nome, icone }`, ou `null`.
 *
 * O icone pode vir `null` sozinho: nem todo executavel entrega um, e nome sem
 * icone continua sendo informacao util.
 */
async function jogoAtual() {
  if (process.platform !== "win32") return null;

  const catalogo = await catalogoDeLojas();

  /*
   * As duas leituras em paralelo: o custo em tempo e o da mais lenta, e nao a
   * soma. Caminho continua sendo o caminho principal — ele diz de onde tirar
   * icone e cobre jogo fora do catalogo (Steam pela convencao de pasta). Nome
   * cobre o que o anti-cheat esconde.
   */
  const [saidaDeCaminhos, saidaDeNomes] = await Promise.all([
    caminhosDeProcessos(),
    nomesDeProcessos(),
  ]);

  const porCaminho = jogosEmSaida(saidaDeCaminhos, catalogo);

  /*
   * O que ja apareceu por caminho NAO e procurado de novo por nome: o achado
   * por caminho traz os executaveis rodando, e e deles que sai o melhor
   * icone. Substituir por um registro de `caminhos` vazio seria perder isso.
   */
  const jaAchados = new Set(porCaminho.map((j) => j.chave));
  const porNome = jogosPorNomes(saidaDeNomes, catalogo).filter(
    (j) => !jaAchados.has(j.chave),
  );

  /*
   * A comunidade vem POR ULTIMO, de proposito: o que uma loja declarou ter
   * instalado e informacao de primeira mao, e o que as pessoas ensinaram e de
   * segunda. Empatando, ganha a loja — e ela tambem e a unica que traz icone.
   */
  for (const j of porNome) jaAchados.add(j.chave);
  const daComunidade = jogosDaComunidadeEm(saidaDeNomes).filter(
    (j) => !jaAchados.has(j.chave),
  );

  const achados = [...porCaminho, ...porNome, ...daComunidade];
  if (achados.length === 0) {
    // Nada agora. Mas se o anti-cheat acabou de esconder o caminho de um jogo
    // que estava na tela, ele ainda esta rodando — so nao aparece mais na
    // varredura. `jogoFixado` cobre essa janela.
    return jogoFixadoAindaVivo(saidaDeNomes);
  }

  /**
   * Mais de um jogo aberto e caso raro e sem resposta certa. Ordenar e pegar
   * o primeiro nao e "o melhor", e o ESTAVEL: sem isso o nome ficaria
   * alternando entre os dois a cada verificacao.
   */
  const escolhido = achados.sort((a, b) => a.chave.localeCompare(b.chave))[0];
  /**
   * O `.ico` da loja ganha do icone do executavel quando existe: e arte de
   * verdade, e nao os 48x48 que o Windows guarda dentro do programa. So a
   * Riot entrega isso hoje.
   */
  const icone =
    iconeDeArquivo(escolhido.icone) ?? (await melhorIcone(escolhido.caminhos));

  const resultado = escolhido.nome
    ? { nome: escolhido.nome, icone } // Epic/Riot/comunidade ja trazem o nome
    : resolverNomeSteam(escolhido, icone);

  /**
   * Fixa SO quando veio por CAMINHO. Nome e comunidade ja funcionam sem
   * caminho legivel — e so o caminho que o anti-cheat quebra depois.
   */
  if (porCaminho.some((j) => j.chave === escolhido.chave)) {
    fixarJogo(resultado, escolhido.caminhos);
  }
  return resultado;
}

/** Resolve o nome oficial de um jogo Steam achado por pasta. */
function resolverNomeSteam(escolhido, icone) {
  const normalizada = escolhido.chave.replace(/\\/g, "/");
  for (const caminho of escolhido.caminhos) {
    if (
      caminho.replace(/\\/g, "/").includes(`/steamapps/common/${normalizada}/`)
    ) {
      return { nome: nomeOficial(caminho, escolhido.chave), icone };
    }
  }
  return { nome: escolhido.chave, icone };
}

/**
 * Os processos que a pessoa poderia sugerir como jogo, prontos para a tela.
 *
 * Monta o catalogo das lojas aqui dentro em vez de receber por parametro: quem
 * chama e o processo principal, e ele nao tem por que saber que existe
 * catalogo de loja para poder perguntar "o que da para sugerir?".
 */
async function listarCandidatos() {
  if (process.platform !== "win32") return [];
  const [nomes, catalogo] = await Promise.all([
    nomesDeProcessos(),
    catalogoDeLojas(),
  ]);
  return candidatosParaSugerir(nomes, catalogo);
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
      diag("mudou", {
        de: ultimo?.nome ?? null,
        para: jogo?.nome ?? null,
      });

      /**
       * Um jogo que vira `null` e o sintoma que estamos cacando. Nesse
       * instante — e SO nesse — releaos os nomes de processo e listamos o que
       * NAO e ruido de sistema. E o que mostra o nome real do processo do jogo
       * quando o anti-cheat escondeu o caminho e a fixacao nao pegou.
       */
      if (ultimo?.nome && !jogo) {
        try {
          const nomes = String(await nomesDeProcessos())
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .filter((n) => {
              const c = normalizarNomeDeJogo(n);
              return c.length >= 3 && !RUIDO_DO_SISTEMA.has(c);
            });
          diag("sumiu-processos-suspeitos", {
            jogo: ultimo.nome,
            candidatos: [...new Set(nomes)].sort(),
          });
        } catch {
          // Diagnostico e melhor-esforco.
        }
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
  jogosPorNomes,
  entradaPorNomeDeProcesso,
  normalizarNomeDeJogo,
  definirCatalogoDaComunidade,
  lerCatalogoDaComunidade,
  jogosDaComunidadeEm,
  candidatosParaSugerir,
  fixarJogo,
  jogoFixadoAindaVivo,
  nomeDeExecutavel,
  resolverNomeSteam,
  listarCandidatos,
  nomeNoManifesto,
  jogoDeCatalogoEm,
  comoPasta,
  podeDarIcone,
  jogosEpic,
  jogosRiot,
  catalogoDeLojas,
  nomeRiot,
  blocosDoRegistro,
  nomePelaPasta,
};
