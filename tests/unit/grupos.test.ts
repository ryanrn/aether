import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Grupos (LFG) pelos seus servidores — fase 2, estagio 4a.
 *
 * Banco e gateway dublados. O que se testa: o agrupamento por forma canonica
 * do jogo, a ordenacao (jogo com mais salas primeiro, sala mais cheia primeiro)
 * e o comportamento quando o gateway nao responde a ocupacao.
 */

const memberFindMany = vi.fn();
const channelFindMany = vi.fn();
const userFindMany = vi.fn();
const ocupacaoDeCanais = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: {
    serverMember: { findMany: memberFindMany },
    channel: { findMany: channelFindMany },
    user: { findMany: userFindMany },
  },
}));
vi.mock("../../apps/web/src/server/realtime-notify", () => ({
  ocupacaoDeCanais: (...a: unknown[]) => ocupacaoDeCanais(...a),
}));

const { listarGruposDosMeusServidores } = await import(
  "../../apps/web/src/server/services/grupos"
);

const EU = "u1";

function canal(over: Record<string, unknown>) {
  return {
    id: "c",
    serverId: "s1",
    jogo: "Valorant",
    criadaPor: null,
    createdAt: new Date("2026-09-06T00:00:00Z"),
    server: { name: "Servidor", iconUrl: null },
    ...over,
  };
}

beforeEach(() => {
  memberFindMany.mockReset();
  channelFindMany.mockReset();
  userFindMany.mockReset();
  ocupacaoDeCanais.mockReset();
  memberFindMany.mockResolvedValue([{ serverId: "s1" }, { serverId: "s2" }]);
  userFindMany.mockResolvedValue([]);
});

describe("listarGruposDosMeusServidores", () => {
  it("sem servidores, devolve vazio sem consultar canais", async () => {
    memberFindMany.mockResolvedValueOnce([]);
    expect(await listarGruposDosMeusServidores(EU)).toEqual([]);
    expect(channelFindMany).not.toHaveBeenCalled();
  });

  it("agrupa grafias do mesmo jogo e ordena por salas e ocupacao", async () => {
    channelFindMany.mockResolvedValueOnce([
      canal({ id: "a", jogo: "Valorant" }),
      canal({ id: "b", jogo: "VALORANT", serverId: "s2" }),
      canal({ id: "c", jogo: "Minecraft" }),
    ]);
    ocupacaoDeCanais.mockResolvedValueOnce({ a: 1, b: 4, c: 9 });

    const grupos = await listarGruposDosMeusServidores(EU);

    // Valorant tem 2 salas -> vem antes de Minecraft (1 sala)
    expect(grupos.map((g) => g.jogo)).toEqual(["Valorant", "Minecraft"]);
    // dentro de Valorant, a sala mais cheia (b=4) antes de a=1
    expect(grupos[0]!.salas.map((s) => s.channelId)).toEqual(["b", "a"]);
    expect(grupos[0]!.salas[0]!.ocupacao).toBe(4);
  });

  it("ocupacao nula quando o gateway nao responde", async () => {
    channelFindMany.mockResolvedValueOnce([canal({ id: "a" })]);
    ocupacaoDeCanais.mockResolvedValueOnce(null);

    const grupos = await listarGruposDosMeusServidores(EU);
    expect(grupos[0]!.salas[0]!.ocupacao).toBeNull();
  });

  it("resolve o nome de quem criou", async () => {
    channelFindMany.mockResolvedValueOnce([
      canal({ id: "a", criadaPor: "u9" }),
    ]);
    ocupacaoDeCanais.mockResolvedValueOnce({ a: 0 });
    userFindMany.mockResolvedValueOnce([
      { id: "u9", displayName: "Ryan", username: "ryu" },
    ]);

    const grupos = await listarGruposDosMeusServidores(EU);
    expect(grupos[0]!.salas[0]!.criadaPorNome).toBe("Ryan");
  });
});
