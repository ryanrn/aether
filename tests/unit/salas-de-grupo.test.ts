import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Salas de grupo (LFG) — fase 2, estagio 3.
 *
 * Banco dublado. O que importa aqui sao os limites: 1 sala por pessoa e o teto
 * por servidor. Sem eles, "criar sala" e um gerador de canais.
 */

const channelFindFirst = vi.fn();
const channelCount = vi.fn();
const channelCreate = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: {
    channel: {
      findFirst: channelFindFirst,
      count: channelCount,
      create: channelCreate,
    },
  },
}));

const { criarSalaDeGrupo, MAX_SALAS_DE_GRUPO_POR_SERVIDOR } = await import(
  "../../apps/web/src/server/services/salas-de-grupo"
);

const SERVER = "s1";
const EU = "u1";

beforeEach(() => {
  channelFindFirst.mockReset();
  channelCount.mockReset();
  channelCreate.mockReset();
});

describe("criarSalaDeGrupo", () => {
  it("devolve a sala que ja existe em vez de criar outra", async () => {
    channelFindFirst.mockResolvedValueOnce({ id: "sala-existente" });

    const r = await criarSalaDeGrupo({
      serverId: SERVER,
      jogo: "Valorant",
      criadaPor: EU,
    });

    expect(r).toEqual({ channelId: "sala-existente", jaExistia: true });
    expect(channelCreate).not.toHaveBeenCalled();
  });

  it("recusa quando o servidor ja esta no teto", async () => {
    channelFindFirst.mockResolvedValueOnce(null); // nao tenho sala
    channelCount.mockResolvedValueOnce(MAX_SALAS_DE_GRUPO_POR_SERVIDOR);

    await expect(
      criarSalaDeGrupo({ serverId: SERVER, jogo: "Valorant", criadaPor: EU }),
    ).rejects.toThrow();
    expect(channelCreate).not.toHaveBeenCalled();
  });

  it("cria a sala como canal de voz temporario, solto, com o jogo", async () => {
    channelFindFirst
      .mockResolvedValueOnce(null) // nao tenho sala
      .mockResolvedValueOnce({ position: 4 }); // ultimo canal solto
    channelCount.mockResolvedValueOnce(2);
    channelCreate.mockResolvedValueOnce({ id: "nova" });

    const r = await criarSalaDeGrupo({
      serverId: SERVER,
      jogo: "  Counter-Strike 2  ",
      criadaPor: EU,
    });

    expect(r).toEqual({ channelId: "nova", jaExistia: false });
    const data = channelCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      serverId: SERVER,
      type: "VOICE",
      categoryId: null,
      isTemporary: true,
      jogo: "Counter-Strike 2",
      criadaPor: EU,
      position: 5,
    });
    expect(data.name).toBe("Counter-Strike 2");
  });
});
