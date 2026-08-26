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
  nomeNoManifesto,
  jogoEpicEm,
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
    expect(jogoEpicEm("E:\\GTAV\\PlayGTAV.exe", catalogo)).toBe(
      "Grand Theft Auto V",
    );
  });

  it("reconhece tambem os auxiliares do jogo", () => {
    // Caso real: o GTA sobe PlayGTAV.exe, GTA5.exe e GTA5_BE.exe juntos.
    expect(jogoEpicEm("E:\\GTAV\\GTA5_BE.exe", catalogo)).toBe(
      "Grand Theft Auto V",
    );
  });

  it("nao casa por PREFIXO de nome parecido", () => {
    // `E:\GTA` nao pode reivindicar `E:\GTAV\`: o casamento e por PASTA, e
    // sem a barra final "GTA" engoliria "GTAV" e nomearia o jogo errado.
    const soGta = [{ pasta: comoPasta("E:\\GTA"), nome: "Outro Jogo" }];
    expect(jogoEpicEm("E:\\GTAV\\PlayGTAV.exe", soGta)).toBeNull();
  });

  it("ignora o proprio launcher da Epic", () => {
    // Os manifestos apontam para pastas de JOGO; o launcher nao e nenhuma.
    expect(
      jogoEpicEm(
        "C:\\Program Files\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe",
        catalogo,
      ),
    ).toBeNull();
  });

  it("nao se importa com maiusculas nem com o tipo de barra", () => {
    expect(jogoEpicEm("e:/gtav/PlayGTAV.exe", catalogo)).toBe(
      "Grand Theft Auto V",
    );
  });

  it("nao quebra com lixo", () => {
    expect(jogoEpicEm("", catalogo)).toBeNull();
    expect(jogoEpicEm(undefined, catalogo)).toBeNull();
    expect(jogoEpicEm("E:\\GTAV\\PlayGTAV.exe", [])).toBeNull();
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

