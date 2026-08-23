import { describe, expect, it } from "vitest";
// @ts-expect-error — modulo do desktop e JavaScript puro, sem tipos
import detect from "../../apps/desktop/src/game-detect.js";

const { pastaDoJogo, ehJogo, jogosEmSaida, nomeNoManifesto, jogoEpicEm, comoPasta } =
  detect;

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
    expect(jogosEmSaida(saidaReal, []).map((j) => j.chave)).toEqual([
      "Hollow Knight",
    ]);
  });

  it("nao repete quando o jogo tem varios processos", () => {
    const comAuxiliares = [
      "E:\\SteamLibrary\\steamapps\\common\\Hollow Knight\\hollow_knight.exe",
      "E:\\SteamLibrary\\steamapps\\common\\Hollow Knight\\crashhandler.exe",
    ].join("\n");
    expect(jogosEmSaida(comAuxiliares, []).map((j) => j.chave)).toEqual([
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
      .map((j) => j.chave)
      .sort();
    expect(nomes).toEqual(["Grand Theft Auto V", "Hollow Knight"]);
  });

  it("o da Epic ja vem com o nome pronto; o da Steam ainda nao", () => {
    const achados = jogosEmSaida(saida, catalogo);
    const epic = achados.find((j) => j.chave === "Grand Theft Auto V");
    const steam = achados.find((j) => j.chave === "Hollow Knight");
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
