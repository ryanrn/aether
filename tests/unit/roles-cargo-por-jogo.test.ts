import { beforeEach, describe, expect, it, vi } from "vitest";
import { Permission, combine } from "@aether/shared";

/**
 * `updateRole` com jogo vinculado (fase 2, estagio 2).
 *
 * Banco dublado, mesmo espirito de `roles-escalada`: o que importa e o que sai
 * para `prisma.role.update` e se `prisma.memberRole.deleteMany` e chamado.
 */

const roleFindFirst = vi.fn();
const roleUpdate = vi.fn();
const memberRoleDeleteMany = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: {
    role: { findFirst: roleFindFirst, update: roleUpdate },
    memberRole: { deleteMany: memberRoleDeleteMany },
  },
}));

const { updateRole } = await import("../../apps/web/src/server/services/roles");

const SERVER = "s1";
const ROLE = "r1";

function dadosGravados() {
  expect(roleUpdate).toHaveBeenCalledOnce();
  return roleUpdate.mock.calls[0]![0].data as {
    permissions: bigint;
    jogoVinculado?: string | null;
    jogoNormalizado?: string | null;
  };
}

beforeEach(() => {
  roleFindFirst.mockReset();
  roleUpdate.mockReset();
  memberRoleDeleteMany.mockReset();
});

describe("updateRole — vinculo com jogo", () => {
  it("vincular um jogo clampa a permissao para participacao, mesmo do dono", async () => {
    roleFindFirst.mockResolvedValue({
      id: ROLE,
      isOwner: false,
      isDefault: false,
      permissions: combine("VIEW_CHANNEL"),
      jogoNormalizado: null,
    });

    await updateRole({
      roleId: ROLE,
      serverId: SERVER,
      name: "CS2",
      color: "#fff",
      permissions: ["VIEW_CHANNEL", "SPEAK", "BAN_MEMBERS", "MANAGE_ROLES"],
      jogoVinculado: "Counter-Strike 2",
      actorPermissions: 0n,
      actorIsOwner: true,
    });

    const data = dadosGravados();
    expect(data.permissions & Permission.BAN_MEMBERS).toBe(0n);
    expect(data.permissions & Permission.MANAGE_ROLES).toBe(0n);
    expect(data.permissions & Permission.SPEAK).not.toBe(0n);
    expect(data.jogoVinculado).toBe("Counter-Strike 2");
    expect(data.jogoNormalizado).toBe("counter strike 2");
  });

  it("mudar o vinculo zera quem tinha o cargo", async () => {
    roleFindFirst.mockResolvedValue({
      id: ROLE,
      isOwner: false,
      isDefault: false,
      permissions: combine("VIEW_CHANNEL"),
      jogoNormalizado: "portal 2",
    });

    await updateRole({
      roleId: ROLE,
      serverId: SERVER,
      name: "x",
      color: "#fff",
      permissions: ["VIEW_CHANNEL"],
      jogoVinculado: "Portal",
      actorPermissions: 0n,
      actorIsOwner: true,
    });

    expect(memberRoleDeleteMany).toHaveBeenCalledWith({
      where: { roleId: ROLE },
    });
  });

  it("desvincular (string vazia) grava null e zera os membros", async () => {
    roleFindFirst.mockResolvedValue({
      id: ROLE,
      isOwner: false,
      isDefault: false,
      permissions: combine("VIEW_CHANNEL"),
      jogoNormalizado: "portal 2",
    });

    await updateRole({
      roleId: ROLE,
      serverId: SERVER,
      name: "x",
      color: "#fff",
      permissions: ["VIEW_CHANNEL"],
      jogoVinculado: "   ",
      actorPermissions: 0n,
      actorIsOwner: true,
    });

    const data = dadosGravados();
    expect(data.jogoVinculado).toBe(null);
    expect(data.jogoNormalizado).toBe(null);
    expect(memberRoleDeleteMany).toHaveBeenCalledOnce();
  });

  it("nao deixa vincular jogo ao cargo padrao", async () => {
    roleFindFirst.mockResolvedValue({
      id: ROLE,
      isOwner: false,
      isDefault: true,
      permissions: combine("VIEW_CHANNEL"),
      jogoNormalizado: null,
    });

    await expect(
      updateRole({
        roleId: ROLE,
        serverId: SERVER,
        name: "Membro",
        color: "#fff",
        permissions: ["VIEW_CHANNEL"],
        jogoVinculado: "Minecraft",
        actorPermissions: 0n,
        actorIsOwner: true,
      }),
    ).rejects.toThrow();
    expect(roleUpdate).not.toHaveBeenCalled();
  });

  it("sem o campo jogoVinculado, nao toca no vinculo nem nos membros", async () => {
    roleFindFirst.mockResolvedValue({
      id: ROLE,
      isOwner: false,
      isDefault: false,
      permissions: combine("VIEW_CHANNEL"),
      jogoNormalizado: null,
    });

    await updateRole({
      roleId: ROLE,
      serverId: SERVER,
      name: "Moderador",
      color: "#fff",
      permissions: ["VIEW_CHANNEL", "KICK_MEMBERS"],
      actorPermissions: combine("VIEW_CHANNEL", "KICK_MEMBERS"),
      actorIsOwner: false,
    });

    const data = dadosGravados();
    expect("jogoVinculado" in data).toBe(false);
    expect(data.permissions & Permission.KICK_MEMBERS).not.toBe(0n);
    expect(memberRoleDeleteMany).not.toHaveBeenCalled();
  });
});
