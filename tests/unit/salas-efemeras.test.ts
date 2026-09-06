import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Salas de voz efemeras (fase 2, estagio 3).
 *
 * `talvezRemoverSalaEfemera` decide se apaga um canal quando alguem sai dele.
 * As tres guardas que importam: tem gente dentro? e temporario? ja passou da
 * carencia criar->entrar?
 */

const channelFindUnique = vi.fn();
const channelDelete = vi.fn();
const countInChannel = vi.fn();
const resyncEavisarServidor = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: { channel: { findUnique: channelFindUnique, delete: channelDelete } },
}));
vi.mock("../../apps/realtime/src/rooms", () => ({ resyncEavisarServidor }));
vi.mock("../../apps/realtime/src/state", () => ({ countInChannel }));

const { talvezRemoverSalaEfemera, CARENCIA_SALA_EFEMERA_MS } = await import(
  "../../apps/realtime/src/voz/salas-efemeras"
);

const IO = {} as never;
const CANAL = "c1";

const velho = () => new Date(Date.now() - CARENCIA_SALA_EFEMERA_MS - 1000);
const novo = () => new Date();

beforeEach(() => {
  channelFindUnique.mockReset();
  channelDelete.mockReset();
  countInChannel.mockReset();
  resyncEavisarServidor.mockReset();
});

describe("talvezRemoverSalaEfemera", () => {
  it("nao faz nada sem channelId", async () => {
    await talvezRemoverSalaEfemera(IO, null);
    expect(channelFindUnique).not.toHaveBeenCalled();
  });

  it("nao apaga se ainda tem gente na sala", async () => {
    countInChannel.mockResolvedValueOnce(1);
    await talvezRemoverSalaEfemera(IO, CANAL);
    expect(channelDelete).not.toHaveBeenCalled();
  });

  it("nao apaga canal comum (nao temporario)", async () => {
    countInChannel.mockResolvedValueOnce(0);
    channelFindUnique.mockResolvedValueOnce({
      serverId: "s1",
      isTemporary: false,
      createdAt: velho(),
    });
    await talvezRemoverSalaEfemera(IO, CANAL);
    expect(channelDelete).not.toHaveBeenCalled();
  });

  it("nao apaga sala dentro da carencia (criada agora, ninguem entrou ainda)", async () => {
    countInChannel.mockResolvedValueOnce(0);
    channelFindUnique.mockResolvedValueOnce({
      serverId: "s1",
      isTemporary: true,
      createdAt: novo(),
    });
    await talvezRemoverSalaEfemera(IO, CANAL);
    expect(channelDelete).not.toHaveBeenCalled();
  });

  it("apaga a sala vazia, velha e temporaria e re-sincroniza o servidor", async () => {
    countInChannel.mockResolvedValue(0);
    channelFindUnique.mockResolvedValueOnce({
      serverId: "s1",
      isTemporary: true,
      createdAt: velho(),
    });
    channelDelete.mockResolvedValueOnce({});

    await talvezRemoverSalaEfemera(IO, CANAL);

    expect(channelDelete).toHaveBeenCalledWith({ where: { id: CANAL } });
    expect(resyncEavisarServidor).toHaveBeenCalledWith(IO, "s1");
  });

  it("aborta se alguem entrou entre a primeira e a segunda contagem", async () => {
    countInChannel.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    channelFindUnique.mockResolvedValueOnce({
      serverId: "s1",
      isTemporary: true,
      createdAt: velho(),
    });

    await talvezRemoverSalaEfemera(IO, CANAL);

    expect(channelDelete).not.toHaveBeenCalled();
  });
});
