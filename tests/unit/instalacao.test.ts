import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Instalacao de bot num servidor (Etapa 7).
 *
 * Propriedades travadas:
 *  - `appParaInstalar` recusa app inexistente / bloqueada / sem bot habilitado;
 *  - `servidoresGerenciados` so lista servidor onde o humano tem MANAGE_SERVER;
 *  - `instalarBot` e idempotente e entra numa transacao (Installation +
 *    ServerMember + MemberRole);
 *  - `desinstalarBot` revoga a Installation e tira o bot do servidor.
 */

const applicationFindUnique = vi.fn();
const serverMemberFindMany = vi.fn();
const installationFindMany = vi.fn();
const installationFindUnique = vi.fn();
const installationFindFirst = vi.fn();
const installationUpsert = vi.fn();
const installationUpdate = vi.fn();
const roleFindFirst = vi.fn();
const serverMemberUpsert = vi.fn();
const serverMemberDeleteMany = vi.fn();
const memberRoleUpsert = vi.fn();

const tx = {
  installation: { upsert: installationUpsert, update: installationUpdate },
  serverMember: { upsert: serverMemberUpsert, deleteMany: serverMemberDeleteMany },
  memberRole: { upsert: memberRoleUpsert },
};

vi.mock("@aether/db", () => ({
  prisma: {
    application: { findUnique: applicationFindUnique },
    serverMember: { findMany: serverMemberFindMany },
    installation: {
      findMany: installationFindMany,
      findUnique: installationFindUnique,
      findFirst: installationFindFirst,
    },
    role: { findFirst: roleFindFirst },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));

const loadMemberAccess = vi.fn();
vi.mock("@aether/access", () => ({ loadMemberAccess }));

const {
  appParaInstalar,
  servidoresGerenciados,
  instalarBot,
  desinstalarBot,
} = await import("../../apps/web/src/server/services/instalacao");

const MANAGE_SERVER = 1n << 1n;

beforeEach(() => {
  for (const m of [
    applicationFindUnique,
    serverMemberFindMany,
    installationFindMany,
    installationFindUnique,
    installationFindFirst,
    installationUpsert,
    installationUpdate,
    roleFindFirst,
    serverMemberUpsert,
    serverMemberDeleteMany,
    memberRoleUpsert,
    loadMemberAccess,
  ]) {
    m.mockReset();
  }
  serverMemberUpsert.mockResolvedValue({ id: "mem_bot" });
});

describe("appParaInstalar", () => {
  it("app inexistente -> null", async () => {
    applicationFindUnique.mockResolvedValue(null);
    expect(await appParaInstalar("app_x")).toBeNull();
  });
  it("app bloqueada -> null", async () => {
    applicationFindUnique.mockResolvedValue({
      id: "a", name: "A", descricao: null, avatarUrl: null,
      botUserId: "u_bot", blockedAt: new Date(),
    });
    expect(await appParaInstalar("a")).toBeNull();
  });
  it("bot nao habilitado -> null", async () => {
    applicationFindUnique.mockResolvedValue({
      id: "a", name: "A", descricao: null, avatarUrl: null,
      botUserId: null, blockedAt: null,
    });
    expect(await appParaInstalar("a")).toBeNull();
  });
  it("ok -> os dados", async () => {
    applicationFindUnique.mockResolvedValue({
      id: "a", name: "AETHER Music", descricao: "toca musica",
      avatarUrl: null, botUserId: "u_bot", blockedAt: null,
    });
    expect(await appParaInstalar("a")).toEqual({
      id: "a", name: "AETHER Music", descricao: "toca musica",
      avatarUrl: null, botUserId: "u_bot",
    });
  });
});

describe("servidoresGerenciados", () => {
  it("filtra por MANAGE_SERVER e marca jaInstalado", async () => {
    serverMemberFindMany.mockResolvedValue([
      { server: { id: "s_1", name: "Um", iconUrl: null } },
      { server: { id: "s_2", name: "Dois", iconUrl: null } },
      { server: { id: "s_3", name: "Tres", iconUrl: null } },
    ]);
    installationFindMany.mockResolvedValue([{ serverId: "s_1" }]);
    loadMemberAccess.mockImplementation(async (serverId: string) =>
      serverId === "s_3" ? null : { permissions: serverId === "s_2" ? 0n : MANAGE_SERVER },
    );

    const r = await servidoresGerenciados("u_1", "app_1");
    expect(r).toEqual([
      { id: "s_1", name: "Um", iconUrl: null, jaInstalado: true },
    ]);
  });
});

describe("instalarBot", () => {
  it("instalacao viva -> jaEstava:true, sem transacao", async () => {
    installationFindUnique.mockResolvedValue({ id: "i", revokedAt: null });
    const r = await instalarBot({
      applicationId: "a", serverId: "s", botUserId: "u_bot", installedBy: "u_1",
    });
    expect(r).toEqual({ jaEstava: true });
    expect(installationUpsert).not.toHaveBeenCalled();
  });

  it("nova -> Installation + ServerMember + MemberRole(default)", async () => {
    installationFindUnique.mockResolvedValue(null);
    roleFindFirst.mockResolvedValue({ id: "role_default" });

    const r = await instalarBot({
      applicationId: "a", serverId: "s", botUserId: "u_bot", installedBy: "u_1",
    });
    expect(r).toEqual({ jaEstava: false });
    expect(installationUpsert).toHaveBeenCalled();
    expect(serverMemberUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { serverId_userId: { serverId: "s", userId: "u_bot" } },
      }),
    );
    expect(memberRoleUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberId_roleId: { memberId: "mem_bot", roleId: "role_default" } },
      }),
    );
  });

  it("instalacao REVOGADA -> reativa (upsert), jaEstava:false", async () => {
    installationFindUnique.mockResolvedValue({ id: "i", revokedAt: new Date() });
    roleFindFirst.mockResolvedValue(null);
    const r = await instalarBot({
      applicationId: "a", serverId: "s", botUserId: "u_bot", installedBy: "u_1",
    });
    expect(r).toEqual({ jaEstava: false });
    expect(installationUpsert).toHaveBeenCalled();
  });
});

describe("desinstalarBot", () => {
  it("nada instalado -> removido:false", async () => {
    installationFindFirst.mockResolvedValue(null);
    expect(
      await desinstalarBot({ applicationId: "a", serverId: "s", botUserId: "u_bot" }),
    ).toEqual({ removido: false });
  });

  it("instalado -> revoga + apaga o membro do bot", async () => {
    installationFindFirst.mockResolvedValue({ id: "i" });
    const r = await desinstalarBot({
      applicationId: "a", serverId: "s", botUserId: "u_bot",
    });
    expect(r).toEqual({ removido: true });
    expect(installationUpdate).toHaveBeenCalledWith({
      where: { id: "i" },
      data: { revokedAt: expect.any(Date) },
    });
    expect(serverMemberDeleteMany).toHaveBeenCalledWith({
      where: { serverId: "s", userId: "u_bot" },
    });
  });
});
