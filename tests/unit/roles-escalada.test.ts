import { beforeEach, describe, expect, it, vi } from "vitest";
import { Permission, combine } from "@aether/shared";

/**
 * Escalada de privilegio no editor de cargos (auditoria M6).
 *
 * A regra que impede um moderador de se dar poderes que nao tem vive dentro de
 * `updateRole`, em aritmetica de bits. O banco e DUBLADO: o que interessa aqui
 * e o bitfield que sai para `prisma.role.update`, nao a consulta. A consulta
 * real continua exercitada pelos verify-phase contra o Postgres.
 *
 * Nomenclatura: "ator" = quem edita. `actorIsOwner` vem de `requirePermission`
 * ja resolvido; `actorPermissions` sao os bits efetivos do ator.
 */

const findFirst = vi.fn();
const update = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: { role: { findFirst, update } },
}));

const { updateRole } = await import("../../apps/web/src/server/services/roles");

const SERVER = "servidor-1";
const ROLE = "cargo-alvo";

/** O ultimo `data.permissions` que updateRole tentou gravar. */
function permsGravadas(): bigint {
  expect(update).toHaveBeenCalledOnce();
  return update.mock.calls[0]![0].data.permissions as bigint;
}

beforeEach(() => {
  findFirst.mockReset();
  update.mockReset();
});

describe("updateRole — clampe de escalada", () => {
  it("nao-dono NAO adiciona permissao que ele mesmo nao tem", async () => {
    findFirst.mockResolvedValue({
      id: ROLE,
      isOwner: false,
      permissions: combine("VIEW_CHANNEL", "SEND_MESSAGES"),
    });

    await updateRole({
      roleId: ROLE,
      serverId: SERVER,
      name: "Moderador",
      color: "#fff",
      permissions: ["VIEW_CHANNEL", "SEND_MESSAGES", "BAN_MEMBERS"],
      actorPermissions: combine(
        "VIEW_CHANNEL",
        "SEND_MESSAGES",
        "KICK_MEMBERS",
      ),
      actorIsOwner: false,
    });

    const gravado = permsGravadas();
    expect(gravado & Permission.BAN_MEMBERS).toBe(0n);
    expect(gravado & Permission.VIEW_CHANNEL).not.toBe(0n);
  });

  it("nao-dono ADICIONA permissao que ele tem", async () => {
    findFirst.mockResolvedValue({
      id: ROLE,
      isOwner: false,
      permissions: combine("VIEW_CHANNEL"),
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

    expect(permsGravadas() & Permission.KICK_MEMBERS).not.toBe(0n);
  });

  it("nao-dono nao REMOVE silenciosamente um bit fora do seu alcance se ele fica marcado", async () => {
    // O cargo ja tem ADMINISTRATOR; o ator nao. Ao salvar com a caixa ainda
    // marcada, o bit tem de sobreviver.
    findFirst.mockResolvedValue({
      id: ROLE,
      isOwner: false,
      permissions: combine("ADMINISTRATOR", "VIEW_CHANNEL"),
    });

    await updateRole({
      roleId: ROLE,
      serverId: SERVER,
      name: "Cargo Alto",
      color: "#fff",
      permissions: ["ADMINISTRATOR", "VIEW_CHANNEL"],
      actorPermissions: combine("VIEW_CHANNEL", "KICK_MEMBERS"),
      actorIsOwner: false,
    });

    expect(permsGravadas() & Permission.ADMINISTRATOR).not.toBe(0n);
  });

  it("o dono ignora o clampe — grava exatamente o pedido", async () => {
    findFirst.mockResolvedValue({
      id: ROLE,
      isOwner: false,
      permissions: combine("VIEW_CHANNEL"),
    });

    await updateRole({
      roleId: ROLE,
      serverId: SERVER,
      name: "Moderador",
      color: "#fff",
      permissions: ["VIEW_CHANNEL", "BAN_MEMBERS", "MANAGE_ROLES"],
      actorPermissions: 0n,
      actorIsOwner: true,
    });

    const gravado = permsGravadas();
    expect(gravado & Permission.BAN_MEMBERS).not.toBe(0n);
    expect(gravado & Permission.MANAGE_ROLES).not.toBe(0n);
  });

  it("recusa editar o cargo do dono", async () => {
    findFirst.mockResolvedValue({ id: ROLE, isOwner: true, permissions: 0n });
    await expect(
      updateRole({
        roleId: ROLE,
        serverId: SERVER,
        name: "x",
        color: "#fff",
        permissions: [],
        actorPermissions: 0n,
        actorIsOwner: true,
      }),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it("recusa cargo de outro servidor (findFirst nao acha)", async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      updateRole({
        roleId: ROLE,
        serverId: SERVER,
        name: "x",
        color: "#fff",
        permissions: [],
        actorPermissions: 0n,
        actorIsOwner: false,
      }),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });
});
