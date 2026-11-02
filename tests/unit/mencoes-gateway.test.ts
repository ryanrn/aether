import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Quais mencoes VALEM (P1-2) — `resolverMencoes` no gateway.
 *
 * Banco e permissao DUBLADOS. Prende-se a regra: so quem enxerga a conversa,
 * @everyone e @cargo so com MENTION_EVERYONE, nome so vira marcador se valeu.
 */

const userFindMany = vi.fn();
const roleFindMany = vi.fn();
vi.mock("@aether/db", () => ({
  prisma: { user: { findMany: userFindMany }, role: { findMany: roleFindMany } },
}));

const loadMemberAccess = vi.fn();
const getChannelPermissions = vi.fn();
vi.mock("@aether/access", () => ({ loadMemberAccess, getChannelPermissions }));

const { resolverMencoes } = await import("../../apps/realtime/src/mencoes");
const { combine } = await import("@aether/shared");

const AUTOR = "autorautor00001";
const VE = "pessoaqueve0001";
const NAO_VE = "pessoanaove0001";
const CARGO = "cargocargo00001";
const CANAL = { tipo: "canal" as const, channelId: "c1", serverId: "s1", isText: true };

/** Cada pessoa: membro com estes bits no canal. Ausente = nao e membro. */
function bitsPorPessoa(bits: Record<string, bigint>) {
  loadMemberAccess.mockImplementation(async (_s: string, id: string) =>
    id in bits ? { id } : null,
  );
  getChannelPermissions.mockImplementation(async (acesso: { id: string }) => bits[acesso.id]);
}

beforeEach(() => {
  userFindMany.mockReset().mockResolvedValue([]);
  roleFindMany.mockReset().mockResolvedValue([]);
  loadMemberAccess.mockReset();
  getChannelPermissions.mockReset();
});

describe("resolverMencoes em canal", () => {
  it("so vale quem enxerga o canal; quem nao ve fica fora", async () => {
    bitsPorPessoa({
      [AUTOR]: combine("VIEW_CHANNEL", "SEND_MESSAGES"),
      [VE]: combine("VIEW_CHANNEL"),
      [NAO_VE]: 0n,
    });
    const r = await resolverMencoes(AUTOR, CANAL, `<@${VE}> <@${NAO_VE}> <@estranhoxx1>`);
    expect(r.usuarios).toEqual([VE]);
    expect(r.todos).toBe(false);
  });

  it("@nome vira marcador so de quem valeu", async () => {
    bitsPorPessoa({ [AUTOR]: combine("VIEW_CHANNEL"), [VE]: combine("VIEW_CHANNEL"), [NAO_VE]: 0n });
    userFindMany.mockResolvedValue([
      { id: VE, username: "Vera" },
      { id: NAO_VE, username: "naove" },
    ]);
    const r = await resolverMencoes(AUTOR, CANAL, "oi @vera e @naove.");
    expect(r.content).toBe(`oi <@${VE}> e @naove.`);
    expect(r.usuarios).toEqual([VE]);
    // Busca sem diferenciar maiusculas, so humanos e bots.
    expect(userFindMany.mock.calls[0]![0].where).toMatchObject({
      username: { in: ["vera", "naove"], mode: "insensitive" },
      kind: { in: ["HUMAN", "BOT"] },
    });
  });

  it("@everyone e @cargo sem MENTION_EVERYONE: ficam texto", async () => {
    bitsPorPessoa({ [AUTOR]: combine("VIEW_CHANNEL", "SEND_MESSAGES") });
    const r = await resolverMencoes(AUTOR, CANAL, `@everyone <@&${CARGO}>`);
    expect(r.todos).toBe(false);
    expect(r.cargos).toEqual([]);
    expect(roleFindMany).not.toHaveBeenCalled();
  });

  it("com MENTION_EVERYONE: @everyone vale e o cargo e conferido no servidor", async () => {
    bitsPorPessoa({ [AUTOR]: combine("VIEW_CHANNEL", "MENTION_EVERYONE") });
    roleFindMany.mockResolvedValue([{ id: CARGO }]);
    const r = await resolverMencoes(AUTOR, CANAL, `@everyone <@&${CARGO}>`);
    expect(r.todos).toBe(true);
    expect(r.cargos).toEqual([CARGO]);
    // So cargo deste servidor, e nunca o cargo padrao (que e o proprio @everyone).
    expect(roleFindMany.mock.calls[0]![0].where).toEqual({
      id: { in: [CARGO] },
      serverId: "s1",
      isDefault: false,
    });
  });

  it("no maximo 20 pessoas por mensagem", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `pessoa${String(i).padStart(10, "0")}`);
    bitsPorPessoa(Object.fromEntries(ids.map((id) => [id, combine("VIEW_CHANNEL")])));
    const r = await resolverMencoes(AUTOR, CANAL, ids.map((id) => `<@${id}>`).join(" "));
    expect(r.usuarios).toHaveLength(20);
  });
});

describe("resolverMencoes em conversa direta", () => {
  it("so as duas pessoas da conversa; @everyone nao existe", async () => {
    const dm = { tipo: "dm" as const, dmId: "dm1", outroId: VE };
    const r = await resolverMencoes(AUTOR, dm, `<@${VE}> <@${NAO_VE}> @everyone`);
    expect(r.usuarios).toEqual([VE]);
    expect(r.todos).toBe(false);
    expect(loadMemberAccess).not.toHaveBeenCalled();
  });
});
