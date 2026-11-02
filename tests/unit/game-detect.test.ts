import { describe, expect, it } from "vitest";
// @ts-expect-error — modulo do desktop e JavaScript puro, sem tipos
import detect from "../../apps/desktop/src/game-detect.js";

/**
 * O que `jogosEmSaida` devolve.
 *
 * Declarado aqui porque `game-detect.js` e JavaScript puro — o desktop nao
 * passa por `tsc` (ver o script `typecheck` dele). Sem isto, o retorno chega
 * como `any` e cada `.map((j) => ...)` vira erro de `noImplicitAny`, que era
 * exatamente o que mantinha `npm run typecheck:tests` vermelho e, por isso,
 * fora do CI. Anotar aqui e o menor lugar possivel para a informacao: o
 * modulo continua JS, e so o teste declara o que consome dele.
 */
type JogoAchado = { chave: string; nome: string; caminhos: string[] };

const {
  pastaDoJogo,
  ehJogo,
  jogosEmSaida,
  jogosPorNomes,
  entradaPorNomeDeProcesso,
  nomeNoManifesto,
  jogoDeCatalogoEm,
  comoPasta,
  podeDarIcone,
} = detect;

/**
 * Deteccao de jogo — a parte que decide, sem tocar no sistema.
 *
 * O que roda de verdade contra o Windows (`wmic`, leitura dos manifestos) NAO
 * esta coberto aqui: dublar `execFile` testaria o duble. O que esta coberto e
 * onde de fato mora o erro — transformar caminho de executavel em nome de
 * jogo, e nao chamar de jogo o que nao e.
 *
 * Os casos abaixo sao REAIS: sairam de uma maquina com Hollow Knight aberto,
 * inclusive o `wallpaper_engine` que a primeira versao mostrou como se fosse
 * jogo, e o apostrofo tipografico de "Marvel's", que a pasta nao tem e o
 * manifesto tem.
 */

describe("caminho de executavel -> pasta do jogo", () => {
  it("reconhece um caminho da Steam no Windows", () => {
    expect(
      pastaDoJogo(
        "E:\\SteamLibrary\\steamapps\\common\\Hollow Knight\\hollow_knight.exe",
      ),
    ).toBe("Hollow Knight");
  });

  it("funciona em qualquer disco e biblioteca", () => {
    expect(
      pastaDoJogo(
        "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Portal 2\\portal2.exe",
      ),
    ).toBe("Portal 2");
  });

  it("ignora processo que nao e da Steam", () => {
    expect(pastaDoJogo("C:\\Windows\\System32\\notepad.exe")).toBeNull();
    expect(pastaDoJogo("C:\\Users\\ryu\\AppData\\Local\\Discord\\app.exe")).toBeNull();
  });

  it("nao quebra com lixo", () => {
    expect(pastaDoJogo("")).toBeNull();
    expect(pastaDoJogo(undefined)).toBeNull();
    expect(pastaDoJogo(null)).toBeNull();
  });

  it("exige o executavel DENTRO da pasta, nao a pasta solta", () => {
    // Sem barra final nao ha executavel — e sem executavel nao ha processo.
    expect(pastaDoJogo("E:\\SteamLibrary\\steamapps\\common\\Hollow Knight")).toBeNull();
  });
});

describe("o que NAO e jogo", () => {
  it("descarta o Wallpaper Engine", () => {
    // Caso real: apareceu junto do jogo na primeira deteccao numa maquina.
    expect(ehJogo("wallpaper_engine")).toBe(false);
  });

  it("descarta ferramentas da Steam", () => {
    expect(ehJogo("SteamVR")).toBe(false);
    expect(ehJogo("Steamworks Shared")).toBe(false);
  });

  it("nao se importa com maiusculas", () => {
    expect(ehJogo("Wallpaper_Engine")).toBe(false);
    expect(ehJogo("WALLPAPER_ENGINE")).toBe(false);
  });

  it("deixa passar jogo de verdade", () => {
    expect(ehJogo("Hollow Knight")).toBe(true);
    expect(ehJogo("MECCHA CHAMELEON")).toBe(true);
  });
});

describe("varredura da saida de processos", () => {
  /** Recorte do formato que o `wmic process get ExecutablePath` devolve. */
  const saidaReal = [
    "ExecutablePath",
    "C:\\Windows\\System32\\svchost.exe",
    "E:\\SteamLibrary\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe",
    "C:\\Windows\\explorer.exe",
    "E:\\SteamLibrary\\steamapps\\common\\Hollow Knight\\hollow_knight.exe",
    "",
  ].join("\r\n");

  it("acha o jogo e ignora o resto da maquina", () => {
    expect(jogosEmSaida(saidaReal, []).map((j: JogoAchado) => j.chave)).toEqual([
      "Hollow Knight",
    ]);
  });

  it("nao repete quando o jogo tem varios processos", () => {
    const comAuxiliares = [
      "E:\\SteamLibrary\\steamapps\\common\\Hollow Knight\\hollow_knight.exe",
      "E:\\SteamLibrary\\steamapps\\common\\Hollow Knight\\crashhandler.exe",
    ].join("\n");
    expect(jogosEmSaida(comAuxiliares, []).map((j: JogoAchado) => j.chave)).toEqual([
      "Hollow Knight",
    ]);
  });

  it("devolve vazio quando nao ha jogo nenhum", () => {
    expect(
      jogosEmSaida("C:\\Windows\\explorer.exe\nC:\\foo\\bar.exe", []),
    ).toEqual([]);
  });
});

describe("Epic Games — casamento por caminho de instalacao", () => {
  /**
   * Catalogo real, lido dos manifestos de uma maquina: a Epic nao segue
   * convencao de pasta nenhuma — este GTA V estava em `E:\GTAV`, sem nada no
   * caminho que dissesse "Epic". Por isso casamos por InstallLocation.
   */
  const catalogo = [
    { pasta: comoPasta("E:\\GTAV"), nome: "Grand Theft Auto V" },
    { pasta: comoPasta("C:\\Program Files\\Epic Games\\Fortnite"), nome: "Fortnite" },
  ];

  it("reconhece o executavel principal", () => {
    expect(jogoDeCatalogoEm("E:\\GTAV\\PlayGTAV.exe", catalogo)).toBe(
      "Grand Theft Auto V",
    );
  });

  it("reconhece tambem os auxiliares do jogo", () => {
    // Caso real: o GTA sobe PlayGTAV.exe, GTA5.exe e GTA5_BE.exe juntos.
    expect(jogoDeCatalogoEm("E:\\GTAV\\GTA5_BE.exe", catalogo)).toBe(
      "Grand Theft Auto V",
    );
  });

  it("nao casa por PREFIXO de nome parecido", () => {
    // `E:\GTA` nao pode reivindicar `E:\GTAV\`: o casamento e por PASTA, e
    // sem a barra final "GTA" engoliria "GTAV" e nomearia o jogo errado.
    const soGta = [{ pasta: comoPasta("E:\\GTA"), nome: "Outro Jogo" }];
    expect(jogoDeCatalogoEm("E:\\GTAV\\PlayGTAV.exe", soGta)).toBeNull();
  });

  it("ignora o proprio launcher da Epic", () => {
    // Os manifestos apontam para pastas de JOGO; o launcher nao e nenhuma.
    expect(
      jogoDeCatalogoEm(
        "C:\\Program Files\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe",
        catalogo,
      ),
    ).toBeNull();
  });

  it("nao se importa com maiusculas nem com o tipo de barra", () => {
    expect(jogoDeCatalogoEm("e:/gtav/PlayGTAV.exe", catalogo)).toBe(
      "Grand Theft Auto V",
    );
  });

  it("nao quebra com lixo", () => {
    expect(jogoDeCatalogoEm("", catalogo)).toBeNull();
    expect(jogoDeCatalogoEm(undefined, catalogo)).toBeNull();
    expect(jogoDeCatalogoEm("E:\\GTAV\\PlayGTAV.exe", [])).toBeNull();
  });

  it("a Unreal Engine nao conta como jogo", () => {
    // A Epic distribui a engine pela mesma via dos jogos.
    expect(ehJogo("Unreal Engine")).toBe(false);
  });
});

describe("Steam e Epic juntas na mesma varredura", () => {
  const catalogo = [{ pasta: comoPasta("E:\\GTAV"), nome: "Grand Theft Auto V" }];

  const saida = [
    "C:\\Windows\\explorer.exe",
    "C:\\Program Files\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe",
    "E:\\GTAV\\PlayGTAV.exe",
    "E:\\GTAV\\GTA5_BE.exe",
    "E:\\SteamLibrary\\steamapps\\common\\Hollow Knight\\hollow_knight.exe",
  ].join("\r\n");

  it("acha os dois, sem duplicar o jogo da Epic", () => {
    const nomes = jogosEmSaida(saida, catalogo)
      .map((j: JogoAchado) => j.chave)
      .sort();
    expect(nomes).toEqual(["Grand Theft Auto V", "Hollow Knight"]);
  });

  it("o da Epic ja vem com o nome pronto; o da Steam ainda nao", () => {
    const achados = jogosEmSaida(saida, catalogo);
    const epic = achados.find((j: JogoAchado) => j.chave === "Grand Theft Auto V");
    const steam = achados.find((j: JogoAchado) => j.chave === "Hollow Knight");
    // Epic entrega DisplayName no manifesto; Steam exige ler o .acf depois.
    expect(epic?.nome).toBe("Grand Theft Auto V");
    expect(steam?.nome).toBeNull();
  });
});

describe("pasta -> nome oficial pelo manifesto", () => {
  /** Recorte real de um appmanifest_*.acf da Valve. */
  const manifesto = `"AppState"
{
  "appid"    "1817070"
  "name"    "Marvel\u2019s Spider-Man Remastered"
  "installdir"    "Marvel's Spider-Man Remastered"
}`;

  it("devolve o nome oficial, com a pontuacao que a pasta nao tem", () => {
    // A pasta usa apostrofo reto; o nome de verdade usa o tipografico.
    expect(
      nomeNoManifesto(manifesto, "Marvel's Spider-Man Remastered"),
    ).toBe("Marvel\u2019s Spider-Man Remastered");
  });

  it("recusa manifesto de OUTRO jogo", () => {
    // Sem esta checagem, o primeiro manifesto lido nomearia qualquer jogo.
    expect(nomeNoManifesto(manifesto, "Hollow Knight")).toBeNull();
  });

  it("casa a pasta sem se importar com maiusculas", () => {
    expect(nomeNoManifesto(manifesto, "marvel's spider-man remastered")).toBe(
      "Marvel\u2019s Spider-Man Remastered",
    );
  });

  it("nao quebra com manifesto incompleto", () => {
    expect(nomeNoManifesto('"installdir" "Hollow Knight"', "Hollow Knight")).toBeNull();
    expect(nomeNoManifesto("", "Hollow Knight")).toBeNull();
  });
});

describe("de quem o icone pode ser tirado", () => {
  /**
   * Caso real: o Fall Guys aparecia com a logo do Easy Anti-Cheat.
   *
   * Extrai os icones um a um para descobrir o porque, e a resposta nao era a
   * que eu supunha. TRES dos quatro executaveis trazem a logo do jogo —
   * `RunFallGuys.exe`, `FallGuys_client.exe` e `FallGuys_client_game.exe`;
   * so o `start_protected_game.exe` traz o escudo do EAC, e ele ainda por
   * cima e o MENOR dos quatro.
   *
   * Ou seja: a regra de "maior data URL vence" ja o descartaria — se ele nao
   * fosse, por alguns segundos, o UNICO processo da pasta rodando. Anti-cheat
   * sobe antes do jogo.
   */
  it("recusa o lancador do Easy Anti-Cheat", () => {
    expect(
      podeDarIcone(
        "C:\\Program Files\\Epic Games\\FallGuys\\start_protected_game.exe",
      ),
    ).toBe(false);
  });

  it("aceita os executaveis do jogo em si", () => {
    const base = "C:\\Program Files\\Epic Games\\FallGuys\\";
    expect(podeDarIcone(base + "FallGuys_client.exe")).toBe(true);
    expect(podeDarIcone(base + "FallGuys_client_game.exe")).toBe(true);
    expect(podeDarIcone(base + "RunFallGuys.exe")).toBe(true);
  });

  it("recusa relator de erro e bootstrapper", () => {
    expect(podeDarIcone("C:/jogo/UnityCrashHandler64.exe")).toBe(false);
    expect(podeDarIcone("C:/jogo/crashpad_handler.exe")).toBe(false);
    expect(podeDarIcone("C:/jogo/EOSBootstrapper.exe")).toBe(false);
  });

  it("recusa redistribuiveis por FAMILIA, sem listar cada versao", () => {
    // Sem isto, cada nova versao do VC++ precisaria entrar na lista na mao.
    expect(podeDarIcone("C:/jogo/Redistributables/VC_redist.x64.exe")).toBe(false);
    expect(podeDarIcone("C:/jogo/vcredist_x86.exe")).toBe(false);
    expect(podeDarIcone("C:/jogo/UEPrereqSetup_x64.exe")).toBe(false);
  });

  it("nao se importa com maiusculas nem com o tipo de barra", () => {
    expect(podeDarIcone("C:/x/START_PROTECTED_GAME.EXE")).toBe(false);
    expect(podeDarIcone("C:\\jogo\\EasyAntiCheat_EOS.exe")).toBe(false);
  });

  it("deixa passar jogo normal, sem anti-cheat", () => {
    expect(
      podeDarIcone("E:/SteamLibrary/steamapps/common/Hollow Knight/hollow_knight.exe"),
    ).toBe(true);
  });
});

describe("jogo com anti-cheat continua tendo icone", () => {
  /**
   * O caso que quebrou DEPOIS da primeira correcao.
   *
   * Bloquear o anti-cheat resolveu o icone errado, mas criou outro problema:
   * enquanto se joga Fall Guys, o processo visivel daquela pasta pode ser SO o
   * do anti-cheat — e ai nao sobrava candidato nenhum, e o jogo aparecia com um
   * controle generico. Foi o que o usuario reportou.
   *
   * A saida foi parar de depender apenas de quem esta RODANDO: o manifesto da
   * Epic diz qual e o executavel de lancamento, e esse arquivo existe no disco
   * o tempo todo.
   *
   * Caminhos com barra normal de proposito — o codigo normaliza, e barra
   * invertida em string de teste ja se perdeu em edicao antes.
   */
  const FALLGUYS = "C:/Program Files/Epic Games/FallGuys";
  const catalogo = [
    {
      pasta: comoPasta(FALLGUYS),
      nome: "Fall Guys",
      launch: `${FALLGUYS}/RunFallGuys.exe`,
    },
  ];

  it("com SO o anti-cheat rodando, ainda ha de onde tirar o icone", () => {
    const achados = jogosEmSaida(`${FALLGUYS}/start_protected_game.exe`, catalogo);
    expect(achados).toHaveLength(1);
    const validos = achados[0].caminhos.filter(podeDarIcone);
    // O anti-cheat e recusado; o executavel do manifesto entra no lugar.
    expect(validos).toEqual([`${FALLGUYS}/RunFallGuys.exe`]);
  });

  it("o executavel do manifesto nao entra duas vezes", () => {
    const achados = jogosEmSaida(
      [
        `${FALLGUYS}/RunFallGuys.exe`,
        `${FALLGUYS}/start_protected_game.exe`,
      ].join("\n"),
      catalogo,
    );
    const runs = achados[0].caminhos.filter((c: string) =>
      /RunFallGuys/.test(c),
    );
    expect(runs).toHaveLength(1);
  });

  it("jogo sem `launch` no manifesto nao quebra", () => {
    const semLaunch = [
      { pasta: comoPasta("E:/GTAV"), nome: "Grand Theft Auto V", launch: null },
    ];
    const achados = jogosEmSaida("E:/GTAV/GTA5.exe", semLaunch);
    expect(achados[0].caminhos).toEqual(["E:/GTAV/GTA5.exe"]);
  });
});


/**
 * Riot Games — o nome sai do que a propria Riot escreveu.
 *
 * Os dois casos abaixo sao REAIS, lidos de uma maquina com os jogos
 * instalados: o VALORANT tem `shortcut_name`, o League of Legends NAO tem, e
 * cada um cobre o buraco do outro.
 */
describe("Riot — nome do produto", () => {
  const { nomeRiot } = detect;

  it("prefere o shortcut_name, sem o .lnk", () => {
    const yaml = `product_install_full_path: "D:/Riot Games/VALORANT/live"\nshortcut_name: "VALORANT.lnk"`;
    expect(nomeRiot(yaml, "D:/Riot Games/VALORANT/live")).toBe("VALORANT");
  });

  it("sem shortcut_name, usa o caminho e PULA a linha de atualizacao", () => {
    // Caso real do League of Legends: nao ha shortcut_name no arquivo.
    const yaml = `product_install_full_path: "C:/Riot Games/League of Legends"`;
    expect(nomeRiot(yaml, "C:/Riot Games/League of Legends")).toBe(
      "League of Legends",
    );
  });

  it("nao devolve 'live' como se fosse o nome do jogo", () => {
    expect(nomeRiot("", "C:/Riot Games/Teamfight Tactics/Live")).toBe(
      "Teamfight Tactics",
    );
  });
});

/**
 * Registro do Windows — Ubisoft e GOG.
 *
 * O primeiro caso e o defeito que a maquina real revelou e que nenhuma
 * fixture escrita a mao teria pego.
 */
describe("leitura do registro", () => {
  const { blocosDoRegistro, nomePelaPasta } = detect;

  it("le valor mesmo com fim de linha do Windows (CRLF)", () => {
    // Exatamente o que o `reg query` devolve, \r inclusive.
    const saida =
      "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\635\r\n" +
      "    Language    REG_SZ    pt-BR\r\n" +
      "    InstallDir    REG_SZ    D:/Tom Clancy's Rainbow Six Siege/\r\n";
    const blocos = blocosDoRegistro(saida);
    expect(blocos).toHaveLength(1);
    expect(blocos[0].valores.get("installdir")).toBe(
      "D:/Tom Clancy's Rainbow Six Siege/",
    );
  });

  it("mantem cada valor na SUA sub-chave", () => {
    // No GOG, nome e caminho sao irmaos: trocar de bloco poria o nome de um
    // jogo na pasta de outro.
    const saida =
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1\r\n" +
      "    gameName    REG_SZ    The Witcher 3\r\n" +
      "    path    REG_SZ    D:/GOG/Witcher3\r\n" +
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\2\r\n" +
      "    gameName    REG_SZ    Cyberpunk 2077\r\n" +
      "    path    REG_SZ    D:/GOG/Cyberpunk\r\n";
    const blocos = blocosDoRegistro(saida);
    expect(blocos).toHaveLength(2);
    expect(blocos[0].valores.get("gamename")).toBe("The Witcher 3");
    expect(blocos[0].valores.get("path")).toBe("D:/GOG/Witcher3");
    expect(blocos[1].valores.get("gamename")).toBe("Cyberpunk 2077");
  });

  it("chave inexistente devolve lista vazia, e nao erro", () => {
    expect(blocosDoRegistro("")).toEqual([]);
  });

  it("o nome pela pasta ignora a barra final", () => {
    expect(nomePelaPasta("D:/Tom Clancy's Rainbow Six Siege/")).toBe(
      "Tom Clancy's Rainbow Six Siege",
    );
  });
});

/**
 * O catalogo generico serve qualquer loja — e nenhum LAUNCHER casa.
 *
 * Este e o caso que motivou o desenho: o Riot Client fica aberto o tempo todo
 * em quem joga VALORANT. Se ele casasse, a pessoa apareceria "jogando" sem
 * ter aberto jogo nenhum.
 */
describe("catalogo de loja — jogo casa, launcher nao", () => {
  const catalogoRiot = [
    {
      pasta: "d:/riot games/valorant/live/",
      nome: "VALORANT",
      launch: null,
      icone: "C:/ProgramData/Riot Games/Metadata/valorant.live/valorant.live.ico",
    },
  ];

  /**
   * Caminhos em `String.raw`, e nao com aspas normais.
   *
   * Escrito com aspas, `"D:\Riot Games\VALORANT\live"` vira
   * `D:Riot GamesVALORANTlive` — `\R`, `\V` e `\l` sao escapes. O teste do
   * launcher entao PASSAVA por acidente: caminho corrompido nao casa com
   * nada, e "nao achou jogo" era exatamente o que ele esperava.
   */
  const EXE_VALORANT = String.raw`D:\Riot Games\VALORANT\live\ShooterGame\Binaries\Win64\VALORANT-Win64-Shipping.exe`;

  it("reconhece o executavel do jogo no disco onde ele esta", () => {
    const achados = jogosEmSaida(EXE_VALORANT, catalogoRiot);
    expect(achados.map((j: JogoAchado) => j.nome)).toEqual(["VALORANT"]);
  });

  it("o Riot Client sozinho NAO e jogo", () => {
    const achados = jogosEmSaida(
      String.raw`C:\Riot Games\Riot Client\RiotClientServices.exe` +
        "\n" +
        String.raw`C:\Program Files\Riot Vanguard\vgtray.exe`,
      catalogoRiot,
    );
    expect(achados).toEqual([]);
  });

  it("leva junto o icone que a loja ja tinha pronto", () => {
    const achados = jogosEmSaida(EXE_VALORANT, catalogoRiot);
    expect(achados[0].icone).toContain("valorant.live.ico");
  });
});

/**
 * Deteccao por NOME de processo — o caminho para jogo com anti-cheat.
 *
 * POR QUE EXISTE: o Vanguard, do VALORANT, protege o processo do jogo, e o
 * Windows passa a devolver caminho VAZIO para ele. Medido na maquina de
 * desenvolvimento com o jogo aberto: `wmic process get ExecutablePath` lista
 * o Riot Client e o `vgtray`, e NAO lista `VALORANT-Win64-Shipping.exe`.
 * Como toda a deteccao era por caminho, o jogo mais jogado da maquina era
 * justamente o unico invisivel.
 *
 * O nome do processo o anti-cheat nao esconde. E ele basta porque o catalogo
 * ja diz o que esta INSTALADO aqui — nao e lista de nomes conhecidos mantida
 * a mao, e sim o cruzamento de "o que a loja instalou" com "o que roda".
 */
describe("jogo com anti-cheat: casar pelo nome do processo", () => {
  const CATALOGO = [
    {
      pasta: "d:/riot games/valorant/live/",
      nome: "VALORANT",
      launch: null,
      icone: "C:/ProgramData/Riot Games/Metadata/valorant.live/valorant.live.ico",
    },
    {
      pasta: "c:/riot games/league of legends/",
      nome: "League of Legends",
      launch: null,
      icone: null,
    },
  ];

  /** O caso real, com os tres processos que a maquina lista de fato. */
  const PROCESSOS_REAIS = [
    "Name",
    "explorer.exe",
    "Riot Client.exe",
    "vgc.exe",
    "VALORANT.exe",
    "VALORANT-Win64-Shipping.exe",
    "chrome.exe",
  ].join("\n");

  it("acha o VALORANT pelo nome, com o sufixo do motor", () => {
    const achados = jogosPorNomes(PROCESSOS_REAIS, CATALOGO);
    expect(achados.map((j: { nome: string }) => j.nome)).toEqual(["VALORANT"]);
  });

  it("traz o icone que a Riot deixou pronto", () => {
    const [jogo] = jogosPorNomes(PROCESSOS_REAIS, CATALOGO);
    expect(jogo.icone).toContain("valorant.live.ico");
  });

  /**
   * O anti-cheat NAO e o jogo. `vgc.exe` roda junto e ficaria anunciado como
   * "jogando vgc" se o casamento fosse por qualquer semelhanca.
   */
  it("o processo do anti-cheat nao vira jogo", () => {
    expect(entradaPorNomeDeProcesso("vgc.exe", CATALOGO)).toBeNull();
    expect(entradaPorNomeDeProcesso("vgtray.exe", CATALOGO)).toBeNull();
  });

  it("o launcher nao vira jogo", () => {
    expect(entradaPorNomeDeProcesso("Riot Client.exe", CATALOGO)).toBeNull();
    expect(entradaPorNomeDeProcesso("RiotClientServices.exe", CATALOGO)).toBeNull();
  });

  it("nome exato tambem casa, com e sem extensao", () => {
    expect(entradaPorNomeDeProcesso("VALORANT.exe", CATALOGO)?.nome).toBe("VALORANT");
    expect(entradaPorNomeDeProcesso("VALORANT", CATALOGO)?.nome).toBe("VALORANT");
  });

  it("nao inventa jogo que nao esta instalado", () => {
    expect(jogosPorNomes("Fortnite.exe\nnotepad.exe", CATALOGO)).toEqual([]);
  });

  /**
   * O PISO DE TAMANHO PARA PREFIXO, fixado de proposito.
   *
   * Sem ele, um jogo de nome curto viraria curinga: "Rust" no catalogo faria
   * qualquer `rustdesk.exe` anunciar que a pessoa esta jogando Rust. Nome
   * curto continua casando, mas so EXATO.
   */
  it("nome curto nao casa por prefixo, so exato", () => {
    const curto = [{ pasta: "c:/jogos/rust/", nome: "Rust", launch: null, icone: null }];
    expect(entradaPorNomeDeProcesso("rustdesk.exe", curto)).toBeNull();
    expect(entradaPorNomeDeProcesso("rust.exe", curto)?.nome).toBe("Rust");
  });

  it("nome longo casa por prefixo", () => {
    const longo = [{ pasta: "c:/jogos/f/", nome: "Fortnite", launch: null, icone: null }];
    expect(entradaPorNomeDeProcesso("FortniteClient-Win64-Shipping.exe", longo)?.nome).toBe(
      "Fortnite",
    );
  });

  it("saida vazia nao acha nada, e nao quebra", () => {
    expect(jogosPorNomes("", CATALOGO)).toEqual([]);
    expect(jogosPorNomes("Name\n\n  \n", CATALOGO)).toEqual([]);
  });

  it("o mesmo jogo em dois processos aparece UMA vez", () => {
    const achados = jogosPorNomes("VALORANT.exe\nVALORANT-Win64-Shipping.exe", CATALOGO);
    expect(achados).toHaveLength(1);
  });
});

/**
 * Jogo FIXADO — sobreviver ao Easy Anti-Cheat que esconde o caminho DEPOIS.
 *
 * O caso real (GunZ: The Duel, EAC): o jogo abre, o caminho casa
 * `steamapps/common/`, a atividade aparece. Segundos depois o EAC relanca o
 * jogo protegido, o caminho some da varredura — e como o Steam nao tem
 * catalogo, o jogo sumia da tela. Agora o nome do processo (que o anti-cheat
 * NAO esconde) segura o jogo enquanto ele estiver rodando.
 */
describe("jogo fixado (anti-cheat que esconde o caminho depois)", () => {
  const { fixarJogo, jogoFixadoAindaVivo, nomeDeExecutavel } = detect as {
    fixarJogo: (j: { nome: string; icone: unknown }, c: string[]) => void;
    jogoFixadoAindaVivo: (
      s: string,
    ) => { nome: string; icone: unknown } | null;
    nomeDeExecutavel: (c: string) => string;
  };

  it("nomeDeExecutavel tira pasta e caixa", () => {
    expect(
      nomeDeExecutavel(String.raw`E:\SteamLibrary\steamapps\common\GunZ\GunZ.exe`),
    ).toBe("gunz.exe");
  });

  it("mantem o jogo enquanto o processo dele segue rodando", () => {
    fixarJogo({ nome: "GunZ: The Duel", icone: "ICO" }, [
      "D:/Steam/steamapps/common/GunZ The Duel/GunZ.exe",
      "D:/Steam/steamapps/common/GunZ The Duel/start_protected_game.exe",
    ]);
    // EAC escondeu o caminho; `Get-Process` ainda lista o nome (sem .exe).
    expect(jogoFixadoAindaVivo("chrome\nGunZ\nsvchost\n")).toEqual({
      nome: "GunZ: The Duel",
      icone: "ICO",
    });
    // wmic lista com .exe — as duas formas contam.
    expect(jogoFixadoAindaVivo("chrome.exe\nGunZ.exe\n")).toEqual({
      nome: "GunZ: The Duel",
      icone: "ICO",
    });
  });

  it("solta o jogo quando o processo dele some — e nao volta", () => {
    fixarJogo({ nome: "GunZ: The Duel", icone: "ICO" }, [
      "D:/Steam/steamapps/common/GunZ The Duel/GunZ.exe",
    ]);
    expect(jogoFixadoAindaVivo("chrome\nsvchost\n")).toBeNull();
    // ja limpou: mesmo com o nome de volta, sem novo `fixarJogo` nao ressuscita
    expect(jogoFixadoAindaVivo("GunZ\n")).toBeNull();
  });

  it("NAO fixa por processo generico de anti-cheat", () => {
    // so o bootstrapper do EAC estava rodando na pasta
    fixarJogo({ nome: "Fall Guys", icone: null }, [
      "C:/Steam/steamapps/common/Fall Guys/start_protected_game.exe",
      "C:/Steam/steamapps/common/Fall Guys/EasyAntiCheat.exe",
    ]);
    // nada proprio para fixar -> "fechei o GunZ e abri o Fall Guys" nao mostra
    // GunZ so porque o EAC dos dois se chama igual
    expect(jogoFixadoAindaVivo("start_protected_game.exe\n")).toBeNull();
  });

  it("troca de jogo: o fixado novo substitui o antigo", () => {
    fixarJogo({ nome: "GunZ", icone: "A" }, ["x/GunZ.exe"]);
    fixarJogo({ nome: "Deadlock", icone: "B" }, ["y/deadlock.exe"]);
    expect(jogoFixadoAindaVivo("deadlock\n")).toEqual({
      nome: "Deadlock",
      icone: "B",
    });
    expect(jogoFixadoAindaVivo("gunz\n")).toBeNull();
  });
});

/**
 * Jogo do Steam com Easy Anti-Cheat que so mostra `start_protected_game.exe`
 * antes de esconder tudo.
 *
 * Foi o buraco real (GunZ): a pasta era detectada so pelo bootstrapper do EAC,
 * e como o `start_protected_game.exe` e generico ele nao servia de ancora.
 * Agora o proprio jogo diz qual e o processo protegido, no
 * `EasyAntiCheat/Launcher/Settings.json` — e ESSE nome segura o jogo na tela
 * quando o EAC nega o caminho.
 */
describe("jogo fixado pelo Settings.json do Easy Anti-Cheat", () => {
  const os = require("node:os") as typeof import("node:os");
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const { fixarJogo, jogoFixadoAindaVivo } = detect as {
    fixarJogo: (j: { nome: string; icone: unknown }, c: string[]) => void;
    jogoFixadoAindaVivo: (
      s: string,
    ) => { nome: string; icone: unknown } | null;
  };

  /** EAC classico: `EasyAntiCheat/Launcher/Settings.json`. */
  function pastaEacClassico(exeProtegido: string): string {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "aether-eac-"));
    const launcher = path.join(raiz, "EasyAntiCheat", "Launcher");
    fs.mkdirSync(launcher, { recursive: true });
    fs.writeFileSync(
      path.join(launcher, "Settings.json"),
      JSON.stringify({ executable: `Binaries/Win64/${exeProtegido}` }),
    );
    return raiz;
  }

  /** EAC EOS: `EasyAntiCheat/Settings.json` — o do GunZ, verificado real. */
  function pastaEacEos(exeProtegido: string): string {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "aether-eos-"));
    fs.mkdirSync(path.join(raiz, "EasyAntiCheat"), { recursive: true });
    // formato REAL do GunZ: indentacao com tabs, campo so o basename
    fs.writeFileSync(
      path.join(raiz, "EasyAntiCheat", "Settings.json"),
      `{
	"title"	: "GunZ: The Duel",
	"executable"	: "${exeProtegido}"
}`,
    );
    return raiz;
  }

  const pastaDeJogoFalsa = pastaEacClassico;

  it("le o executavel protegido e segura o jogo por ele", () => {
    const raiz = pastaDeJogoFalsa("GunZ_x64.exe");
    // So o bootstrapper do EAC estava rodando quando a pasta foi vista.
    fixarJogo({ nome: "GunZ: The Duel", icone: "IGDB" }, [
      path.join(raiz, "start_protected_game.exe"),
    ]);
    // EAC ja escondeu o caminho; `Get-Process` ainda lista o nome protegido.
    expect(jogoFixadoAindaVivo("chrome\nGunZ_x64\nsvchost\n")).toEqual({
      nome: "GunZ: The Duel",
      icone: "IGDB",
    });
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  it("acha o Settings.json subindo da pasta Binaries/Win64", () => {
    const raiz = pastaDeJogoFalsa("Game.exe");
    fixarJogo({ nome: "Jogo", icone: null }, [
      path.join(raiz, "Binaries", "Win64", "Game.exe"),
    ]);
    expect(jogoFixadoAindaVivo("Game.exe\n")).toEqual({
      nome: "Jogo",
      icone: null,
    });
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  it("EAC EOS (GunZ): le `EasyAntiCheat/Settings.json`, so o bootstrapper visto", () => {
    const raiz = pastaEacEos("Gunz.exe");
    // `start_protected_game.exe` sai depois de lancar (wait_for_game_process_exit
    // false), entao no primeiro poll era o unico processo da pasta.
    fixarJogo({ nome: "GunZ: The Duel", icone: "IGDB" }, [
      path.join(raiz, "start_protected_game.exe"),
    ]);
    // EAC EOS escondeu o caminho; `Get-Process` lista `Gunz`.
    expect(jogoFixadoAindaVivo("Gunz\nchrome\n")).toEqual({
      nome: "GunZ: The Duel",
      icone: "IGDB",
    });
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  it("pasta sem EAC: fixa so pelos exes proprios vistos", () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "aether-noeac-"));
    fixarJogo({ nome: "Solo", icone: null }, [
      path.join(raiz, "solo.exe"),
    ]);
    expect(jogoFixadoAindaVivo("solo\n")).toEqual({ nome: "Solo", icone: null });
    fs.rmSync(raiz, { recursive: true, force: true });
  });
});

/**
 * EA app (ex-Origin) — mesmo modelo da Steam: uma pasta-mae, uma subpasta por
 * jogo. Verificado contra a instalacao real do EA SPORTS FC 26.
 */
describe("EA app", () => {
  const os = require("node:os") as typeof import("node:os");
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const { nomesProtegidosPorAntiCheat, fixarJogo, jogoFixadoAindaVivo } =
    detect as {
      nomesProtegidosPorAntiCheat: (c: string) => string[] | null;
      fixarJogo: (j: { nome: string; icone: unknown }, c: string[]) => void;
      jogoFixadoAindaVivo: (
        s: string,
      ) => { nome: string; icone: unknown } | null;
    };

  it("le os exes protegidos do EAAntiCheat.cfg (formato REAL do FC 26)", () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "aether-ea-"));
    // O `.cfg` e binario; os nomes ficam em texto claro entre lixo. Este e o
    // recorte exato do FC 26, com os bytes nao-texto trocados por espaco.
    fs.writeFileSync(
      path.join(raiz, "EAAntiCheat.cfg"),
      "  default  FC26.exe  fc26  trial  FC26_Trial.exe  fc26  showcase  FC26_Showcase.exe  fc26 " +
        "EAAntiCheat.GameServiceLauncher.exe ",
    );
    const nomes = nomesProtegidosPorAntiCheat(path.join(raiz, "FC26.exe"));
    expect(new Set(nomes)).toEqual(
      new Set(["fc26.exe", "fc26_trial.exe", "fc26_showcase.exe"]),
    );
    // o launcher do proprio anti-cheat NAO entra
    expect(nomes).not.toContain("eaanticheat.gameservicelauncher.exe");
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  it("segura o FC 26 pelo nome do processo quando o EA AntiCheat esconde o caminho", () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "aether-ea2-"));
    fs.writeFileSync(
      path.join(raiz, "EAAntiCheat.cfg"),
      "  default  FC26.exe  fc26 ",
    );
    fixarJogo({ nome: "EA SPORTS FC 26", icone: "IGDB" }, [
      path.join(raiz, "EAAntiCheat.GameServiceLauncher.exe"),
    ]);
    expect(jogoFixadoAindaVivo("chrome\nFC26\nsvchost\n")).toEqual({
      nome: "EA SPORTS FC 26",
      icone: "IGDB",
    });
    fs.rmSync(raiz, { recursive: true, force: true });
  });
});

/**
 * O que fecha o EA app + EA AntiCheat: o processo se chama `FC26.exe` mas o
 * jogo "EA SPORTS FC 26", e o anti-cheat esconde o caminho DESDE O INICIO —
 * nao ha janela para casar por pasta nem para fixar. So resta o nome do
 * processo, e o catalogo carrega os exes conhecidos (lidos do anti-cheat).
 */
describe("entradaPorNomeDeProcesso por exe conhecido", () => {
  const catalogo = [
    {
      nome: "EA SPORTS FC 26",
      exes: ["fc26.exe", "fc26_trial.exe", "fc26_showcase.exe"],
    },
    { nome: "Hollow Knight" }, // sem exes — o caso comum
  ];

  it("casa `FC26.exe` com o jogo cujo nome nao tem nada a ver", () => {
    expect(entradaPorNomeDeProcesso("FC26.exe", catalogo)?.nome).toBe(
      "EA SPORTS FC 26",
    );
    // `Get-Process` traz sem extensao
    expect(entradaPorNomeDeProcesso("FC26", catalogo)?.nome).toBe(
      "EA SPORTS FC 26",
    );
  });

  it("casamento e EXATO — `fc26x.exe` nao vira FC 26", () => {
    expect(entradaPorNomeDeProcesso("fc26x.exe", catalogo)).toBeNull();
    expect(entradaPorNomeDeProcesso("fc.exe", catalogo)).toBeNull();
  });

  it("jogo sem `exes` continua casando pela regra antiga (nome == processo)", () => {
    // "hollow_knight" normaliza igual a "Hollow Knight"
    expect(entradaPorNomeDeProcesso("hollow_knight.exe", catalogo)?.nome).toBe(
      "Hollow Knight",
    );
    expect(entradaPorNomeDeProcesso("algo_aleatorio.exe", catalogo)).toBeNull();
  });
});

describe("Steam — catalogo (anti-cheat que ja escondeu o caminho)", () => {
  const os = require("node:os") as typeof import("node:os");
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  type Entrada = {
    nome: string;
    exes: string[];
    raiz: string;
    chaveSteam: string;
  };
  const {
    bibliotecasNoVdf,
    jogosSteamEm,
    acharExecutavel,
  } = detect as {
    bibliotecasNoVdf: (t: string) => string[];
    jogosSteamEm: (raiz: string) => Entrada[];
    acharExecutavel: (raiz: string, nomes: string[]) => string | null;
  };

  function manifesto(steamapps: string, id: number, dir: string, nome: string) {
    fs.mkdirSync(path.join(steamapps, "common", dir), { recursive: true });
    fs.writeFileSync(
      path.join(steamapps, `appmanifest_${id}.acf`),
      `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${nome}"\n\t"installdir"\t\t"${dir}"\n}\n`,
    );
  }

  /**
   * Uma Steam falsa: a biblioteca da propria Steam e uma segunda num "outro
   * disco", apontada pelo `libraryfolders.vdf` com as barras escapadas como a
   * Steam escreve.
   */
  /** A Steam escreve o caminho com a barra invertida dobrada. */
  const vdf = (c: string) => c.split("\\").join("\\\\");

  function steamFalsa() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "aether-steam-"));
    const raiz = path.join(base, "Steam");
    const outra = path.join(base, "SteamLibrary");
    const apps1 = path.join(raiz, "steamapps");
    const apps2 = path.join(outra, "steamapps");
    fs.mkdirSync(apps1, { recursive: true });
    fs.mkdirSync(apps2, { recursive: true });
    fs.writeFileSync(
      path.join(apps1, "libraryfolders.vdf"),
      `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${vdf(raiz)}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${vdf(outra)}"\n\t}\n}\n`,
    );

    // GunZ: EAC EOS, exe protegido em Binaries/Win64
    manifesto(apps2, 1, "GunZ The Duel", "GunZ: The Duel");
    const gunz = path.join(apps2, "common", "GunZ The Duel");
    fs.mkdirSync(path.join(gunz, "EasyAntiCheat"), { recursive: true });
    fs.writeFileSync(
      path.join(gunz, "EasyAntiCheat", "Settings.json"),
      JSON.stringify({ executable: "Binaries/Win64/Gunz.exe" }),
    );
    fs.mkdirSync(path.join(gunz, "Binaries", "Win64"), { recursive: true });
    fs.writeFileSync(path.join(gunz, "Binaries", "Win64", "Gunz.exe"), "");

    manifesto(apps1, 2, "Hollow Knight", "Hollow Knight");
    manifesto(apps1, 3, "wallpaper_engine", "Wallpaper Engine");
    // manifesto sem a pasta: jogo meio instalado
    fs.writeFileSync(
      path.join(apps1, "appmanifest_4.acf"),
      `"AppState"\n{\n\t"name"\t\t"Fantasma"\n\t"installdir"\t\t"Fantasma"\n}\n`,
    );
    return { raiz, gunz };
  }

  it("le as bibliotecas do libraryfolders.vdf, desfazendo o escape", () => {
    const texto = [
      '"libraryfolders"',
      "{",
      '\t"0" { "path"\t\t"C:\\\\Program Files (x86)\\\\Steam" }',
      '\t"1" { "path"\t\t"D:\\\\SteamLibrary" }',
      "}",
    ].join("\n");
    expect(bibliotecasNoVdf(texto)).toEqual([
      "C:\\Program Files (x86)\\Steam",
      "D:\\SteamLibrary",
    ]);
  });

  it("monta o catalogo de todas as bibliotecas, sem app e sem jogo meio instalado", () => {
    const { raiz } = steamFalsa();
    const nomes = jogosSteamEm(raiz).map((j) => j.nome).sort();
    expect(nomes).toEqual(["GunZ: The Duel", "Hollow Knight"]);
  });

  it("guarda o exe que o anti-cheat protege e a pasta como chave", () => {
    const { raiz } = steamFalsa();
    const gunz = jogosSteamEm(raiz).find((j) => j.nome === "GunZ: The Duel")!;
    expect(gunz.exes).toEqual(["gunz.exe"]);
    expect(gunz.chaveSteam).toBe("GunZ The Duel");
  });

  it("casa o processo protegido pelo nome, com o nome oficial e a pasta como chave", () => {
    const { raiz, gunz } = steamFalsa();
    const catalogo = jogosSteamEm(raiz);
    const achados = jogosPorNomes("Gunz.exe\nexplorer.exe", catalogo) as JogoAchado[];
    expect(achados).toHaveLength(1);
    expect(achados[0]).toMatchObject({ chave: "GunZ The Duel", nome: "GunZ: The Duel" });
    // icone: o exe protegido achado no DISCO entra como candidato
    expect(achados[0]!.caminhos).toEqual([
      path.join(gunz, "Binaries", "Win64", "Gunz.exe"),
    ]);
  });

  it("acha o executavel ate 3 niveis abaixo, sem diferenciar caixa", () => {
    const { gunz } = steamFalsa();
    expect(acharExecutavel(gunz, ["GUNZ.EXE"])).toBe(
      path.join(gunz, "Binaries", "Win64", "Gunz.exe"),
    );
    expect(acharExecutavel(path.join(gunz, "EasyAntiCheat"), ["nada.exe"])).toBeNull();
  });
});

describe("Battle.net — pelo registro de desinstalacao", () => {
  const os = require("node:os") as typeof import("node:os");
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const { jogosBattleNetNoRegistro, exesDoJogo } = detect as {
    jogosBattleNetNoRegistro: (t: string) => { nome: string; dir: string }[];
    exesDoJogo: (raiz: string) => string[];
  };

  /**
   * Saida no formato do `reg query /s`, em CRLF como o `reg` escreve (o
   * `blocosDoRegistro` ja quebrou uma vez por causa do `\r`).
   */
  const SAIDA = [
    String.raw`HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Overwatch`,
    String.raw`    DisplayName    REG_SZ    Overwatch`,
    String.raw`    InstallLocation    REG_SZ    D:\Jogos\Overwatch`,
    String.raw`    UninstallString    REG_SZ    "C:\ProgramData\Battle.net\Agent\Blizzard Uninstaller.exe" --lang=ptBR --uid=prometheus --displayname="Overwatch"`,
    String.raw`    Publisher    REG_SZ    Blizzard Entertainment`,
    "",
    String.raw`HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Call of Duty`,
    String.raw`    DisplayName    REG_SZ    Call of Duty`,
    String.raw`    InstallLocation    REG_SZ    C:\Program Files (x86)\Call of Duty`,
    String.raw`    UninstallString    REG_SZ    "C:\ProgramData\Battle.net\Agent\Blizzard Uninstaller.exe" --uid=auks`,
    String.raw`    Publisher    REG_SZ    Activision`,
    "",
    String.raw`HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Battle.net`,
    String.raw`    DisplayName    REG_SZ    Battle.net`,
    String.raw`    InstallLocation    REG_SZ    C:\Program Files (x86)\Battle.net`,
    String.raw`    UninstallString    REG_SZ    "C:\Program Files (x86)\Battle.net\Battle.net Launcher.exe" --uninstall`,
    "",
    String.raw`HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\7-Zip`,
    String.raw`    DisplayName    REG_SZ    7-Zip`,
    String.raw`    InstallLocation    REG_SZ    C:\Program Files\7-Zip`,
    String.raw`    UninstallString    REG_SZ    C:\Program Files\7-Zip\Uninstall.exe`,
  ].join("\r\n");

  it("pega so os jogos do desinstalador da Blizzard, nao o app nem o resto", () => {
    expect(jogosBattleNetNoRegistro(SAIDA)).toEqual([
      { nome: "Overwatch", dir: String.raw`D:\Jogos\Overwatch` },
      { nome: "Call of Duty", dir: String.raw`C:\Program Files (x86)\Call of Duty` },
    ]);
  });

  it("exes do jogo: raiz e um nivel abaixo, sem launcher, desinstalador nem relator de erro", () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "aether-bnet-"));
    fs.mkdirSync(path.join(raiz, "_retail_"));
    for (const f of ["cod.exe", "Call of Duty Launcher.exe", "Uninstall.exe", "readme.txt"]) {
      fs.writeFileSync(path.join(raiz, f), "");
    }
    fs.writeFileSync(path.join(raiz, "_retail_", "Overwatch.exe"), "");
    fs.writeFileSync(path.join(raiz, "_retail_", "BlizzardError.exe"), "");
    const nomes = exesDoJogo(raiz).map((c) => path.basename(c)).sort();
    expect(nomes).toEqual(["Overwatch.exe", "cod.exe"]);
  });

  it("o processo cod.exe casa o Call of Duty pelo exe conhecido", () => {
    const catalogo = [
      {
        pasta: "c:/program files (x86)/call of duty/",
        nome: "Call of Duty",
        launch: null,
        icone: null,
        exes: ["cod.exe"],
      },
    ];
    expect(entradaPorNomeDeProcesso("cod.exe", catalogo)?.nome).toBe("Call of Duty");
  });
});
