import { describe, expect, it } from "vitest";
import { safeGameCover } from "@aether/shared";
import {
  CONFIANCA_MINIMA,
  melhorCasamento,
  normalizarNome,
  semEdicao,
  semelhanca,
  separarCamelCase,
  urlDaCapa,
  type CandidatoIgdb,
} from "../../apps/realtime/src/games/normalize";

/**
 * A logica que decide QUAL capa vai para a atividade de alguem.
 *
 * Isto e testado com cuidado desproporcional ao tamanho do codigo por um
 * motivo so: errar aqui poe a capa de um jogo na atividade de outro, na tela
 * de outras pessoas. E um erro silencioso — ninguem recebe excecao, so uma
 * imagem plausivel e errada.
 */

describe("normalizarNome", () => {
  it("aceita as grafias diferentes do mesmo jogo como uma so", () => {
    expect(normalizarNome("ELDEN RING")).toBe("elden ring");
    expect(normalizarNome("Elden Ring")).toBe("elden ring");
    expect(normalizarNome("  elden   ring  ")).toBe("elden ring");
  });

  it("tira o .exe, que o cadastro manual vai mandar", () => {
    expect(normalizarNome("HollowKnight.exe")).toBe("hollowknight");
  });

  it("tira simbolo de marca, que aparece em manifesto de loja", () => {
    expect(normalizarNome("Bloodborne™")).toBe("bloodborne");
    expect(normalizarNome("PAC-MAN®")).toBe("pac man");
  });

  it("apostrofo some sem virar espaco", () => {
    // "marvel s spider man" quebraria o casamento com o nome do IGDB.
    expect(normalizarNome("Marvel's Spider-Man")).toBe("marvels spider man");
    expect(normalizarNome("Marvel’s Spider-Man")).toBe("marvels spider man");
  });

  /**
   * O caso que justifica a regra existir: numero NAO e ruido. Remover digitos
   * juntaria sequencias diferentes na mesma linha do cache, e a capa de uma
   * apareceria na outra.
   */
  it("PRESERVA numeros — sao o que distingue as sequencias", () => {
    expect(normalizarNome("Portal 2")).toBe("portal 2");
    expect(normalizarNome("Cyberpunk 2077")).toBe("cyberpunk 2077");
    expect(normalizarNome("Portal 2")).not.toBe(normalizarNome("Portal"));
  });
});

describe("semEdicao", () => {
  it("reconhece que a reedicao e o mesmo jogo", () => {
    expect(semEdicao("marvels spider man remastered")).toBe("marvels spider man");
    expect(semEdicao("skyrim anniversary edition")).toBe("skyrim");
  });

  it("nao mexe em nome que so parece ter sufixo", () => {
    expect(semEdicao("hollow knight")).toBe("hollow knight");
  });
});

describe("separarCamelCase", () => {
  it("resolve o nome cru de pasta quando o manifesto falhou", () => {
    expect(separarCamelCase("HollowKnight")).toBe("hollow knight");
    expect(separarCamelCase("DarkSoulsIII")).toBe("dark souls iii");
  });

  it("nome que ja tem espaco atravessa sem estrago", () => {
    expect(separarCamelCase("Hollow Knight")).toBe("hollow knight");
  });
});

describe("semelhanca", () => {
  it("identico depois de normalizar vale 1", () => {
    expect(semelhanca("ELDEN RING", "Elden Ring")).toBe(1);
  });

  it("mesma obra em edicao diferente fica alto, mas abaixo de 1", () => {
    expect(semelhanca("Marvel's Spider-Man", "Marvel's Spider-Man Remastered")).toBe(0.9);
  });

  /**
   * O caso legitimo da regra de conter: a pasta da loja costuma trazer o nome
   * curto, e o IGDB traz o titulo completo com subtitulo.
   */
  it("aceita subtitulo — sobra palavra, nao numero de sequencia", () => {
    expect(semelhanca("Witcher 3", "The Witcher 3: Wild Hunt")).toBe(0.75);
    expect(semelhanca("Hollow Knight", "Hollow Knight Silksong")).toBe(0.75);
  });

  /**
   * O teste mais importante do arquivo. "Portal" dentro de "Portal 2" e
   * substring, mas sao jogos diferentes — se isto casar, a atividade de quem
   * joga Portal 2 mostra a capa de Portal.
   */
  it("NAO casa sequencias diferentes que compartilham prefixo", () => {
    expect(semelhanca("Portal", "Portal 2")).toBeLessThan(CONFIANCA_MINIMA);
    expect(semelhanca("Far Cry 3", "Far Cry 5")).toBeLessThan(CONFIANCA_MINIMA);
    // Romano tambem: "Final Fantasy" nao e "Final Fantasy VII".
    expect(semelhanca("Final Fantasy", "Final Fantasy VII")).toBeLessThan(
      CONFIANCA_MINIMA,
    );
    expect(semelhanca("Dark Souls", "Dark Souls III")).toBeLessThan(
      CONFIANCA_MINIMA,
    );
  });

  it("jogos sem relacao dao zero", () => {
    expect(semelhanca("Hollow Knight", "Rocket League")).toBe(0);
  });

  it("nome vazio nao casa com nada", () => {
    expect(semelhanca("", "Hollow Knight")).toBe(0);
  });
});

describe("melhorCasamento", () => {
  const candidato = (
    id: number,
    name: string,
    coverImageId: string | null = "co1abc",
  ): CandidatoIgdb => ({ id, name, coverImageId, genre: null });

  it("prefere o exato ao aproximado, mesmo vindo depois", () => {
    const achado = melhorCasamento("Hollow Knight", [
      candidato(2, "Hollow Knight Silksong"),
      candidato(1, "Hollow Knight"),
    ]);
    expect(achado?.candidato.id).toBe(1);
    expect(achado?.confianca).toBe(1);
  });

  /**
   * A especificacao pede explicitamente para nao aceitar o primeiro resultado
   * so porque veio primeiro. Sem capa e melhor do que capa errada.
   */
  it("devolve null quando nada passa do corte, mesmo havendo resultados", () => {
    const achado = melhorCasamento("MeuJogoCaseiro", [
      candidato(1, "Rocket League"),
      candidato(2, "Fall Guys"),
    ]);
    expect(achado).toBeNull();
  });

  it("empate escolhe o menor id — a entrada principal, nao o port", () => {
    const achado = melhorCasamento("Doom", [
      candidato(9999, "DOOM"),
      candidato(42, "DOOM"),
    ]);
    expect(achado?.candidato.id).toBe(42);
  });

  it("lista vazia nao quebra", () => {
    expect(melhorCasamento("Hollow Knight", [])).toBeNull();
  });
});

describe("urlDaCapa", () => {
  it("monta a URL do CDN a partir do image_id", () => {
    expect(urlDaCapa("co1rgi")).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1rgi.jpg",
    );
  });

  /**
   * Sem image_id NAO montamos URL. Montar assim mesmo produziria exatamente a
   * imagem quebrada que a especificacao manda nunca renderizar.
   */
  it("sem image_id devolve null em vez de uma URL invalida", () => {
    expect(urlDaCapa(null)).toBeNull();
    expect(urlDaCapa(undefined)).toBeNull();
    expect(urlDaCapa("")).toBeNull();
  });

  it("recusa id com formato estranho", () => {
    expect(urlDaCapa("../../etc/passwd")).toBeNull();
    expect(urlDaCapa("co1rgi.jpg?x=1")).toBeNull();
  });
});

describe("safeGameCover", () => {
  it("aceita a URL que nos mesmos montamos", () => {
    const url = urlDaCapa("co1rgi") as string;
    expect(safeGameCover(url)).toBe(url);
  });

  /**
   * O valor sai do banco e vai para o `src` de uma imagem na tela de outras
   * pessoas. A checagem prende o HOST, e nao so o formato: "e https" nao
   * basta quando o destino pode ser qualquer servidor.
   */
  it("recusa outro host, ainda que https", () => {
    expect(
      safeGameCover("https://exemplo.invalido/igdb/image/upload/t_cover_big/x.jpg"),
    ).toBeNull();
    expect(safeGameCover("https://images.igdb.com.mau.site/a/b/c.jpg")).toBeNull();
  });

  it("recusa javascript: e data:", () => {
    expect(safeGameCover("javascript:alert(1)")).toBeNull();
    expect(safeGameCover("data:image/png;base64,AAAA")).toBeNull();
  });

  it("recusa o que nao e texto", () => {
    expect(safeGameCover(null)).toBeNull();
    expect(safeGameCover(42)).toBeNull();
    expect(safeGameCover({})).toBeNull();
  });
});
