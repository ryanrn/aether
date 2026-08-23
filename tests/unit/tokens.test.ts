import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  SOCKET_TICKET_TTL_SECONDS,
  signSessionToken,
  signSocketTicket,
  verifySessionToken,
  verifySocketTicket,
} from "@aether/access";

/**
 * Cookie de sessao e ticket de socket compartilham o AUTH_SECRET e o issuer.
 * O que os separa e a AUDIENCE — e essa separacao e a unica coisa impedindo
 * que um ticket de 5 minutos seja usado como sessao de 30 dias, e vice-versa.
 *
 * Nao ha banco aqui: estes testes cobrem a prova criptografica. A revalidacao
 * da linha `Session` e outra camada (loadSession), coberta pelos verify-phase.
 */

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET);

afterEach(() => {
  vi.useRealTimers();
});

describe("token de sessao", () => {
  it("assina e verifica, preservando sid e sub", async () => {
    const token = await signSessionToken({ sid: "sessao-1", sub: "usuario-1" });
    const claims = await verifySessionToken(token);
    expect(claims).toMatchObject({ sid: "sessao-1", sub: "usuario-1" });
  });

  it("recusa lixo sem lancar excecao", async () => {
    /**
     * O middleware do Next chama isto a cada request protegido. Lancar aqui
     * viraria erro 500 numa rota que so precisava redirecionar para /login.
     */
    for (const invalid of ["", "abc", "a.b.c", "Bearer token"]) {
      await expect(verifySessionToken(invalid)).resolves.toBeNull();
    }
  });

  it("recusa token adulterado", async () => {
    const token = await signSessionToken({ sid: "sessao-1", sub: "usuario-1" });
    const [header, payload, signature] = token.split(".");
    const forged = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    );
    forged.sub = "outro-usuario";
    const tampered = [
      header,
      Buffer.from(JSON.stringify(forged)).toString("base64url"),
      signature,
    ].join(".");

    await expect(verifySessionToken(tampered)).resolves.toBeNull();
  });

  it("recusa token assinado com outro segredo", async () => {
    const outsider = await new SignJWT({ sid: "sessao-1" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject("usuario-1")
      .setIssuedAt()
      .setIssuer("aether")
      .setAudience("aether-app")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("um-segredo-completamente-diferente-32+"));

    await expect(verifySessionToken(outsider)).resolves.toBeNull();
  });

  it("recusa token de outro issuer", async () => {
    const outsider = await new SignJWT({ sid: "sessao-1" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject("usuario-1")
      .setIssuedAt()
      .setIssuer("outro-produto")
      .setAudience("aether-app")
      .setExpirationTime("1h")
      .sign(SECRET);

    await expect(verifySessionToken(outsider)).resolves.toBeNull();
  });

  it("expira depois do TTL", async () => {
    const token = await signSessionToken({ sid: "sessao-1", sub: "usuario-1" });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (SESSION_TTL_SECONDS + 60) * 1000);
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("o nome do cookie e estavel", () => {
    /**
     * O gateway le este mesmo nome ao autenticar o handshake por cookie, e o
     * verify-phase monta o cookie a mao. Renomear em um lugar so quebra os
     * outros dois em runtime, longe da causa.
     */
    expect(SESSION_COOKIE).toBe("aether_session");
  });
});

describe("ticket de socket", () => {
  it("assina e verifica, com jti presente", async () => {
    const ticket = await signSocketTicket({ sid: "sessao-1", sub: "usuario-1" });
    const claims = await verifySocketTicket(ticket);
    expect(claims).toMatchObject({ sid: "sessao-1", sub: "usuario-1" });
    expect(claims?.jti).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gera jti diferente a cada emissao", async () => {
    /**
     * O consumo unico do gateway usa o jti como chave. jti repetido faria o
     * segundo ticket legitimo ser recusado como replay.
     */
    const tickets = await Promise.all(
      Array.from({ length: 20 }, () =>
        signSocketTicket({ sid: "sessao-1", sub: "usuario-1" }),
      ),
    );
    const jtis = await Promise.all(
      tickets.map(async (t) => (await verifySocketTicket(t))?.jti),
    );
    expect(new Set(jtis).size).toBe(20);
  });

  it("um ticket NAO vale como cookie de sessao", async () => {
    const ticket = await signSocketTicket({ sid: "sessao-1", sub: "usuario-1" });
    await expect(verifySessionToken(ticket)).resolves.toBeNull();
  });

  it("um cookie de sessao NAO vale como ticket", async () => {
    /**
     * O caso que importa: sem a separacao de audiencia, um cookie roubado
     * abriria socket por 30 dias em vez dos 5 minutos do ticket.
     */
    const session = await signSessionToken({
      sid: "sessao-1",
      sub: "usuario-1",
    });
    await expect(verifySocketTicket(session)).resolves.toBeNull();
  });

  it("expira depois do TTL", async () => {
    const ticket = await signSocketTicket({ sid: "sessao-1", sub: "usuario-1" });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (SOCKET_TICKET_TTL_SECONDS + 10) * 1000);
    await expect(verifySocketTicket(ticket)).resolves.toBeNull();
  });

  it("ainda vale um pouco antes de vencer — reconexao depende disso", async () => {
    const ticket = await signSocketTicket({ sid: "sessao-1", sub: "usuario-1" });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (SOCKET_TICKET_TTL_SECONDS - 30) * 1000);
    await expect(verifySocketTicket(ticket)).resolves.not.toBeNull();
  });

  it("o ticket dura muito menos que a sessao", () => {
    expect(SOCKET_TICKET_TTL_SECONDS).toBeLessThan(SESSION_TTL_SECONDS);
  });
});
