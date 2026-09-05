import { beforeAll, describe, expect, it } from "vitest";

/**
 * O `state` do login de conexoes.
 *
 * ISTO E TESTE DE SEGURANCA, nao de formato. O `state` antigo carregava so o
 * usuario, com audiencia `aether-spotify-state`. Com um provedor so era
 * inofensivo; com dois, um `state` emitido para o Spotify passaria na
 * verificacao do callback do Twitch — bastava comecar um fluxo num servico e
 * entregar aquele `state` na rota do outro.
 *
 * Os testes abaixo travam as tres condicoes que o `concluirLogin` exige:
 * assinatura nossa, MESMO provedor, MESMO usuario.
 */

const SEGREDO = "x".repeat(48);

type Modulo = typeof import("../../packages/access/src/conexoes/state");
let assinar: Modulo["assinarStateDeConexao"];
let verificar: Modulo["verificarStateDeConexao"];

beforeAll(async () => {
  // A chave sai do AUTH_SECRET; sem ele o modulo lanca de proposito.
  process.env.AUTH_SECRET = SEGREDO;
  // Caminho relativo, e nao `@aether/access`: o modulo do `state` e puro, e
  // importar o pacote inteiro arrastaria Prisma para dentro da suite.
  const m = await import("../../packages/access/src/conexoes/state");
  assinar = m.assinarStateDeConexao;
  verificar = m.verificarStateDeConexao;
});

describe("state de conexao", () => {
  it("ida e volta devolve usuario E provedor", async () => {
    const s = await assinar("user-1", "SPOTIFY");
    expect(await verificar(s)).toEqual({
      userId: "user-1",
      provider: "SPOTIFY",
    });
  });

  it("o provedor VIAJA no state — nao da para reaproveitar noutro", async () => {
    const s = await assinar("user-1", "SPOTIFY");
    const lido = await verificar(s);
    // Quem confere e o `concluirLogin`; aqui provamos que ele TEM como
    // conferir. Sem este campo, a checagem seria impossivel.
    expect(lido?.provider).toBe("SPOTIFY");
    expect(lido?.provider).not.toBe("TWITCH");
  });

  it("state adulterado nao passa", async () => {
    const s = await assinar("user-1", "SPOTIFY");
    const partes = s.split(".");
    // Troca o usuario no payload e re-empacota, sem reassinar.
    const payload = JSON.parse(
      Buffer.from(partes[1]!, "base64url").toString("utf8"),
    );
    payload.sub = "user-2";
    partes[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect(await verificar(partes.join("."))).toBeNull();
  });

  it("assinado com outro segredo nao passa", async () => {
    const s = await assinar("user-1", "SPOTIFY");
    process.env.AUTH_SECRET = "y".repeat(48);
    try {
      expect(await verificar(s)).toBeNull();
    } finally {
      process.env.AUTH_SECRET = SEGREDO;
    }
  });

  it("lixo nao passa, e nao lanca", async () => {
    for (const ruim of ["", "abc", "a.b.c", "..", "eyJhbGciOiJub25lIn0..%"]) {
      await expect(verificar(ruim)).resolves.toBeNull();
    }
  });

  it("state sem provedor (formato antigo) nao passa", async () => {
    const { SignJWT } = await import("jose");
    // Reproduz o formato ANTIGO: so `sub`, sem `provider`.
    const antigo = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject("user-1")
      .setIssuedAt()
      .setIssuer("aether")
      .setAudience("aether-conexao-state")
      .setExpirationTime("600s")
      .sign(new TextEncoder().encode(SEGREDO));
    expect(await verificar(antigo)).toBeNull();
  });
});
