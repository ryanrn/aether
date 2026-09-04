import { beforeEach, describe, expect, it, vi } from "vitest";
import { combine } from "@aether/shared";

/**
 * Hierarquia nas actions do app web (auditoria M6).
 *
 * `assertRoleHierarchy` e `assertHierarchy` sao as duas travas que ficam ENTRE
 * ter a permissao MANAGE_ROLES/KICK e poder de fato mexer num cargo ou membro.
 * A regra de "quem age sobre quem" (`canActOnUser`) ja tem cobertura propria em
 * hierarchy.test.ts; aqui o alvo e o que os guards adicionam: cargo do dono
 * intocavel, escopo por servidor, traducao de recusa em excecao.
 *
 * Banco DUBLADO. `canActOnUser` e dublado tambem — nao e o que este arquivo
 * testa, e dublar isola o ramo de decisao dos guards.
 */

const roleFindFirst = vi.fn();
const memberFindUnique = vi.fn();
const canActOnUser = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: {
    role: { findFirst: roleFindFirst },
    serverMember: { findUnique: memberFindUnique },
  },
}));

vi.mock("@aether/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aether/access")>()),
  canActOnUser,
}));

const { assertRoleHierarchy, assertHierarchy, ForbiddenError, NotFoundError } =
  await import("../../apps/web/src/server/guards");

const SERVER = "servidor-1";

function actor(over: Partial<Record<string, unknown>> = {}) {
  return {
    serverId: SERVER,
    memberId: "membro-ator",
    isOwner: false,
    permissions: combine("MANAGE_ROLES", "KICK_MEMBERS"),
    highestRolePosition: 50,
    roleIds: ["cargo-ator"],
    session: { user: { id: "user-ator" } },
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  roleFindFirst.mockReset();
  memberFindUnique.mockReset();
  canActOnUser.mockReset();
});

describe("assertRoleHierarchy", () => {
  it("404 quando o cargo nao existe no servidor do ator", async () => {
    roleFindFirst.mockResolvedValue(null);
    await expect(
      assertRoleHierarchy(actor(), "cargo-x"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("recusa mexer no cargo do dono, mesmo sendo o dono", async () => {
    roleFindFirst.mockResolvedValue({ position: 999, isOwner: true });
    await expect(
      assertRoleHierarchy(actor({ isOwner: true }), "cargo-dono"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("o dono gerencia qualquer cargo abaixo do dele", async () => {
    roleFindFirst.mockResolvedValue({ position: 900, isOwner: false });
    await expect(
      assertRoleHierarchy(actor({ isOwner: true }), "cargo-alto"),
    ).resolves.toEqual({ position: 900 });
  });

  it("nao-dono NAO gerencia cargo de mesma altura", async () => {
    roleFindFirst.mockResolvedValue({ position: 50, isOwner: false });
    await expect(
      assertRoleHierarchy(actor({ highestRolePosition: 50 }), "cargo-par"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("nao-dono NAO gerencia cargo acima", async () => {
    roleFindFirst.mockResolvedValue({ position: 80, isOwner: false });
    await expect(
      assertRoleHierarchy(actor({ highestRolePosition: 50 }), "cargo-acima"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("nao-dono gerencia cargo estritamente abaixo", async () => {
    roleFindFirst.mockResolvedValue({ position: 20, isOwner: false });
    await expect(
      assertRoleHierarchy(actor({ highestRolePosition: 50 }), "cargo-abaixo"),
    ).resolves.toEqual({ position: 20 });
  });
});

describe("assertHierarchy", () => {
  it("age sobre si mesmo sem tocar o banco", async () => {
    await expect(
      assertHierarchy(actor(), "membro-ator"),
    ).resolves.toBeUndefined();
    expect(memberFindUnique).not.toHaveBeenCalled();
    expect(canActOnUser).not.toHaveBeenCalled();
  });

  it("404 quando o alvo nao existe", async () => {
    memberFindUnique.mockResolvedValue(null);
    await expect(
      assertHierarchy(actor(), "membro-fantasma"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(canActOnUser).not.toHaveBeenCalled();
  });

  it("404 quando o alvo e de outro servidor", async () => {
    memberFindUnique.mockResolvedValue({
      serverId: "outro-servidor",
      userId: "user-alvo",
    });
    await expect(
      assertHierarchy(actor(), "membro-de-fora"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(canActOnUser).not.toHaveBeenCalled();
  });

  it("ForbiddenError quando canActOnUser recusa", async () => {
    memberFindUnique.mockResolvedValue({
      serverId: SERVER,
      userId: "user-alvo",
    });
    canActOnUser.mockResolvedValue(false);
    await expect(
      assertHierarchy(actor(), "membro-alvo"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("resolve quando canActOnUser aceita", async () => {
    memberFindUnique.mockResolvedValue({
      serverId: SERVER,
      userId: "user-alvo",
    });
    canActOnUser.mockResolvedValue(true);
    await expect(
      assertHierarchy(actor(), "membro-alvo"),
    ).resolves.toBeUndefined();
    expect(canActOnUser).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: SERVER }),
      "user-alvo",
    );
  });
});
