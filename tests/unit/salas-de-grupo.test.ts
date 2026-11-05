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

  it("sem tamanho, a sala nasce sem limite (servidor comum, como sempre)", async () => {
    channelFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    channelCount.mockResolvedValueOnce(0);
    channelCreate.mockResolvedValueOnce({ id: "nova" });

    await criarSalaDeGrupo({ serverId: SERVER, jogo: "Valorant", criadaPor: EU });
    expect(channelCreate.mock.calls[0]![0].data.userLimit).toBeNull();
  });

  it("hub (4b): o tamanho escolhido vira o userLimit do canal", async () => {
    channelFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    channelCount.mockResolvedValueOnce(0);
    channelCreate.mockResolvedValueOnce({ id: "nova" });

    await criarSalaDeGrupo({
      serverId: SERVER,
      jogo: "Valorant",
      criadaPor: EU,
      tamanho: 5,
    });
    expect(channelCreate.mock.calls[0]![0].data.userLimit).toBe(5);
  });

  it("hub (4b): o teto passado substitui o de servidor comum", async () => {
    // Acima do teto de servidor comum, abaixo do teto passado: cria.
    channelFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    channelCount.mockResolvedValueOnce(MAX_SALAS_DE_GRUPO_POR_SERVIDOR + 5);
    channelCreate.mockResolvedValueOnce({ id: "nova" });
    await expect(
      criarSalaDeGrupo({ serverId: SERVER, jogo: "Valorant", criadaPor: EU, teto: 50 }),
    ).resolves.toEqual({ channelId: "nova", jaExistia: false });

    // No teto passado: recusa.
    channelFindFirst.mockResolvedValueOnce(null);
    channelCount.mockResolvedValueOnce(50);
    await expect(
      criarSalaDeGrupo({ serverId: SERVER, jogo: "Valorant", criadaPor: EU, teto: 50 }),
    ).rejects.toThrow();
  });
});
