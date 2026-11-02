import { beforeEach, describe, expect, it } from "vitest";
import {
  adaptadorDoJogo,
  COMO_ENTRAR_MAX,
  CONVITE_VALIDADE_MS,
  limparComoEntrar,
  type PresenceEntry,
  type PublicUser,
  type UserStatus,
} from "@aether/shared";
import { criarArmazemEmMemoria } from "../../apps/realtime/src/convites/armazem";
import {
  cancelarConvite,
  enviarConvite,
  listarConvites,
  responderConvite,
  type DependenciasDeConvite,
} from "../../apps/realtime/src/convites/convites";

/**
 * Convites de jogo (`apps/realtime/src/convites/`). Travam as regras que
 * nao podem depender do cliente: amizade, o jogo vem do ANFITRIAO, invisivel
 * nao vaza, so o destinatario responde, so o remetente cancela, a primeira
 * resposta vence, e expira.
 */

function usuario(id: string): PublicUser {
  return {
    id,
    username: id,
    displayName: id.toUpperCase(),
    avatarUrl: null,
    status: "ONLINE",
    kind: "HUMAN",
  } as PublicUser;
}

let agora: number;
let amizades: Record<string, string[]>;
let jogos: Record<string, string | null>;
let status: Record<string, UserStatus>;
let conectados: Set<string>;
let seq: number;
let deps: DependenciasDeConvite;

beforeEach(() => {
  agora = Date.UTC(2026, 10, 2, 12, 0, 0);
  seq = 0;
  amizades = {
    eu: ["jota", "mau", "a", "b", "c", "d", "e"],
    jota: ["eu"],
    mau: ["eu"],
  };
  jogos = { jota: "VALORANT", mau: null, eu: null };
  status = {};
  conectados = new Set(["eu", "jota", "mau"]);
  deps = {
    armazem: criarArmazemEmMemoria(() => agora),
    friendsOf: async (id) => amizades[id] ?? [],
    isConnected: async (id) => conectados.has(id),
    statusOf: async (id) => status[id] ?? "ONLINE",
    presenceEntryOf: async (id) =>
      ({ userId: id, status: "ONLINE", game: jogos[id] ?? null, gameCover: null }) as PresenceEntry,
    usuarioPublico: async (id) => usuario(id),
    agora: () => agora,
    novoId: () => `c${++seq}`,
  };
});

const EU = usuario("eu");

describe("enviar", () => {
  it("pedido: o jogo e o do ANFITRIAO (destinatario), e o 'como entrar' do remetente e ignorado", async () => {
    const r = await enviarConvite(deps, EU, { paraId: "jota", tipo: "pedir", comoEntrar: "golpe" });
    expect(r.novo).toBe(true);
    expect(r.resposta).toMatchObject({
      ok: true,
      convite: { anfitriaoId: "jota", jogo: "VALORANT", estado: "pendente", comoEntrar: null },
    });
  });

  it("so entre amigos", async () => {
    const r = await enviarConvite(deps, EU, { paraId: "estranho", tipo: "pedir" });
    expect(r.resposta).toMatchObject({ ok: false, codigo: "nao_amigo" });
  });

  it("invisivel jogando = 'nao esta jogando', com a mesma mensagem", async () => {
    const semJogo = await enviarConvite(deps, EU, { paraId: "mau", tipo: "pedir" });
    jogos.mau = "Fortnite";
    status.mau = "OFFLINE";
    const invisivel = await enviarConvite(deps, EU, { paraId: "mau", tipo: "pedir" });
    expect(invisivel.resposta).toEqual(semJogo.resposta);
    expect(invisivel.resposta).toMatchObject({ ok: false, codigo: "sem_jogo" });
  });

  it("o mesmo pedido de novo devolve o existente e nao conta como novo", async () => {
    const a = await enviarConvite(deps, EU, { paraId: "jota", tipo: "pedir" });
    const b = await enviarConvite(deps, EU, { paraId: "jota", tipo: "pedir" });
    expect(b.novo).toBe(false);
    expect(b.resposta.ok && a.resposta.ok && b.resposta.convite.id).toBe(
      a.resposta.ok && a.resposta.convite.id,
    );
  });

  it("limite de pendentes enviados", async () => {
    jogos.eu = "CS2";
    for (const id of ["a", "b", "c", "d", "e"]) {
      const r = await enviarConvite(deps, EU, { paraId: id, tipo: "convidar" });
      expect(r.resposta.ok).toBe(true);
    }
    const sexto = await enviarConvite(deps, EU, { paraId: "jota", tipo: "convidar" });
    expect(sexto.resposta).toMatchObject({ ok: false, codigo: "limite" });
  });

  it("convidar exige que QUEM ENVIA esteja jogando, e guarda o 'como entrar' dele", async () => {
    const sem = await enviarConvite(deps, EU, { paraId: "jota", tipo: "convidar" });
    expect(sem.resposta).toMatchObject({ ok: false, codigo: "sem_jogo" });
    jogos.eu = "Counter-Strike 2";
    const com = await enviarConvite(deps, EU, {
      paraId: "jota",
      tipo: "convidar",
      comoEntrar: "ABCDE-FGHJ",
    });
    expect(com.resposta).toMatchObject({
      ok: true,
      convite: { anfitriaoId: "eu", jogo: "Counter-Strike 2", comoEntrar: "ABCDE-FGHJ" },
    });
  });

  it("payload invalido", async () => {
    expect((await enviarConvite(deps, EU, null)).resposta).toMatchObject({ codigo: "invalido" });
    expect((await enviarConvite(deps, EU, { paraId: "jota", tipo: "x" })).resposta).toMatchObject({
      codigo: "invalido",
    });
    expect((await enviarConvite(deps, EU, { paraId: "eu", tipo: "pedir" })).resposta).toMatchObject({
      codigo: "invalido",
    });
  });
});

async function pedidoPendente(): Promise<string> {
  const r = await enviarConvite(deps, EU, { paraId: "jota", tipo: "pedir" });
  if (!r.resposta.ok) throw new Error("setup");
  return r.resposta.convite.id;
}

describe("responder e cancelar", () => {
  it("so o destinatario responde; os outros veem 'nao existe'", async () => {
    const id = await pedidoPendente();
    expect(await responderConvite(deps, "eu", { id, aceitar: true })).toMatchObject({
      ok: false,
      codigo: "nao_encontrado",
    });
    expect(await responderConvite(deps, "mau", { id, aceitar: true })).toMatchObject({
      codigo: "nao_encontrado",
    });
  });

  it("anfitriao aceita com 'como entrar' limpo", async () => {
    const id = await pedidoPendente();
    const r = await responderConvite(deps, "jota", {
      id,
      aceitar: true,
      comoEntrar: "  jota#BR1\n",
    });
    expect(r).toMatchObject({ ok: true, convite: { estado: "aceito", comoEntrar: "jota#BR1" } });
  });

  it("a primeira resposta vence: cancelar depois de aceito, e aceitar depois de cancelado", async () => {
    const id = await pedidoPendente();
    await responderConvite(deps, "jota", { id, aceitar: true });
    expect(await cancelarConvite(deps, "eu", { id })).toMatchObject({ codigo: "ja_respondido" });

    const id2 = (
      await enviarConvite(deps, EU, { paraId: "jota", tipo: "pedir", comoEntrar: null })
    ).resposta;
    if (!id2.ok) throw new Error("setup");
    expect(await cancelarConvite(deps, "eu", { id: id2.convite.id })).toMatchObject({
      ok: true,
      convite: { estado: "cancelado" },
    });
    expect(
      await responderConvite(deps, "jota", { id: id2.convite.id, aceitar: true }),
    ).toMatchObject({ codigo: "ja_respondido" });
  });

  it("so o remetente cancela", async () => {
    const id = await pedidoPendente();
    expect(await cancelarConvite(deps, "jota", { id })).toMatchObject({ codigo: "nao_encontrado" });
  });

  it("recusar nao leva 'como entrar'", async () => {
    const id = await pedidoPendente();
    const r = await responderConvite(deps, "jota", { id, aceitar: false, comoEntrar: "x" });
    expect(r).toMatchObject({ ok: true, convite: { estado: "recusado", comoEntrar: null } });
  });
});

describe("expiracao", () => {
  it("depois do prazo: responder diz 'expirou' e a lista marca como expirado", async () => {
    const id = await pedidoPendente();
    agora += CONVITE_VALIDADE_MS + 1;
    expect(await responderConvite(deps, "jota", { id, aceitar: true })).toMatchObject({
      codigo: "expirado",
    });
    const { convites } = await listarConvites(deps, "eu");
    expect(convites[0]).toMatchObject({ id, estado: "expirado" });
  });

  it("listar avisa (vencidos) so quem venceu NESTA leitura", async () => {
    await pedidoPendente();
    agora += CONVITE_VALIDADE_MS + 1;
    expect((await listarConvites(deps, "jota")).vencidos).toHaveLength(1);
    expect((await listarConvites(deps, "eu")).vencidos).toHaveLength(0);
  });

  it("some do armazem depois da retencao", async () => {
    await pedidoPendente();
    agora += CONVITE_VALIDADE_MS + 11 * 60_000;
    expect((await listarConvites(deps, "eu")).convites).toEqual([]);
  });
});

describe("limparComoEntrar", () => {
  it("tira controle, poda, corta e devolve null para vazio", () => {
    expect(limparComoEntrar("  a\tb\u0000c  ")).toBe("a b c");
    expect(limparComoEntrar("   ")).toBeNull();
    expect(limparComoEntrar(42)).toBeNull();
    expect(limparComoEntrar("x".repeat(500))).toHaveLength(COMO_ENTRAR_MAX);
  });
});

describe("adaptadores por jogo", () => {
  it("casa o nome detectado com o adaptador; jogo desconhecido e generico", () => {
    expect(adaptadorDoJogo("VALORANT").id).toBe("valorant");
    expect(adaptadorDoJogo("Counter-Strike 2").id).toBe("cs2");
    expect(adaptadorDoJogo("Fortnite").id).toBe("fortnite");
    expect(adaptadorDoJogo("Hades").id).toBe("generico");
  });

  it("nenhum jogo declara entrada automatica", () => {
    for (const nome of ["VALORANT", "Fortnite", "Counter-Strike 2", "Hades"]) {
      expect(adaptadorDoJogo(nome).capacidades.entrada).toBe("assistida");
      expect(adaptadorDoJogo(nome).capacidades.sessao).toBe("nenhuma");
    }
  });

  it("validadores de formato", () => {
    const riot = adaptadorDoJogo("VALORANT").comoEntrar.validar;
    expect(riot("Nome#BR1")).toBeNull();
    expect(riot("Joao Silva#1234")).toBeNull();
    expect(riot("Nome")).not.toBeNull();
    expect(riot("ab#BR1")).not.toBeNull();
    expect(riot("Nome#B")).not.toBeNull();

    const cs = adaptadorDoJogo("Counter-Strike 2").comoEntrar.validar;
    expect(cs("ABCDE-FGHJ")).toBeNull();
    expect(cs("https://steamcommunity.com/id/fulano")).toBeNull();
    expect(cs("https://evil.example/id/x")).not.toBeNull();

    expect(adaptadorDoJogo("Hades").comoEntrar.validar("qualquer coisa")).toBeNull();
  });

  it("Riot ID errado no aceite: recusa e o pedido CONTINUA pendente para corrigir", async () => {
    const id = await pedidoPendente();
    expect(
      await responderConvite(deps, "jota", { id, aceitar: true, comoEntrar: "so o nome" }),
    ).toMatchObject({ ok: false, codigo: "invalido" });
    expect(await responderConvite(deps, "jota", { id, aceitar: true, comoEntrar: "Jota#BR1" })).toMatchObject({
      ok: true,
      convite: { estado: "aceito", comoEntrar: "Jota#BR1" },
    });
  });

  it("jogo sem adaptador aceita texto livre; campo vazio sempre vale", async () => {
    jogos.jota = "Hades";
    const id = await pedidoPendente();
    expect(
      await responderConvite(deps, "jota", { id, aceitar: true, comoEntrar: "sala 42" }),
    ).toMatchObject({ ok: true, convite: { comoEntrar: "sala 42" } });

    jogos.jota = "VALORANT";
    const r = await enviarConvite(deps, EU, { paraId: "jota", tipo: "pedir" });
    if (!r.resposta.ok) throw new Error("setup");
    expect(
      await responderConvite(deps, "jota", { id: r.resposta.convite.id, aceitar: true, comoEntrar: "" }),
    ).toMatchObject({ ok: true, convite: { comoEntrar: null } });
  });
});
