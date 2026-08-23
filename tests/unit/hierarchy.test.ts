import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PERMISSIONS, combine } from "@aether/shared";

/**
 * Hierarquia: quem pode agir sobre quem (expulsar, banir, silenciar, mover).
 *
 * O banco e DUBLADO aqui. Isso e uma escolha, com um custo declarado: estes
 * testes cobrem o RAMO DE DECISAO — dono intocavel, dono age sobre todos,
 * demais so agem sobre cargo estritamente abaixo — e nao cobrem a consulta
 * (o `include` dos cargos, o unique composto). A consulta real continua sendo
 * exercitada pelos verify-phase2 e verify-phase6, contra o Postgres.
 *
 * Vale a pena porque a regra e onde mora a escalada de privilegio, e ela
 * precisa ser exercitavel em combinacoes que o cenario de seed nao produz.
 */

const findUnique = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: { serverMember: { findUnique } },
}));

const { canActOnUser } = await import("@aether/access");

const SERVER = "servidor-1";
const OWNER = "usuario-dono";

/** Como o banco devolveria o alvo: cargos com position, e o dono do servidor. */
function targetRow(params: { userId: string; positions: number[] }) {
  return {
    server: { ownerId: OWNER },
    roles: params.positions.map((position) => ({ role: { position } })),
  };
}

function actor(params: {
  isOwner?: boolean;
  highestRolePosition: number;
  permissions?: bigint;
}) {
  return {
    serverId: SERVER,
    memberId: "membro-ator",
    isOwner: params.isOwner ?? false,
    permissions: params.permissions ?? combine("KICK_MEMBERS", "BAN_MEMBERS"),
    highestRolePosition: params.highestRolePosition,
    roleIds: ["cargo-ator"],
  };
}

beforeEach(() => {
  findUnique.mockReset();
});

describe("canActOnUser", () => {
  it("recusa quando o alvo nao e membro do servidor", async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      canActOnUser(actor({ highestRolePosition: 100 }), "estranho"),
    ).resolves.toBe(false);
  });

  it("o dono do servidor e intocavel", async () => {
    findUnique.mockResolvedValue(
      targetRow({ userId: OWNER, positions: [100] }),
    );
    const administrator = actor({
      highestRolePosition: 80,
      permissions: ALL_PERMISSIONS,
    });
    await expect(canActOnUser(administrator, OWNER)).resolves.toBe(false);
  });

  it("o dono e intocavel inclusive para ele mesmo", async () => {
    /** Nao existe caminho para o dono se auto-banir e ficar sem servidor. */
    findUnique.mockResolvedValue(
      targetRow({ userId: OWNER, positions: [100] }),
    );
    const owner = actor({
      isOwner: true,
      highestRolePosition: Number.MAX_SAFE_INTEGER,
      permissions: ALL_PERMISSIONS,
    });
    await expect(canActOnUser(owner, OWNER)).resolves.toBe(false);
  });

  it("o dono age sobre qualquer outro membro", async () => {
    findUnique.mockResolvedValue(
      targetRow({ userId: "alvo", positions: [80] }),
    );
    const owner = actor({
      isOwner: true,
      highestRolePosition: Number.MAX_SAFE_INTEGER,
      permissions: ALL_PERMISSIONS,
    });
    await expect(canActOnUser(owner, "alvo")).resolves.toBe(true);
  });

  it("age sobre cargo estritamente abaixo", async () => {
    findUnique.mockResolvedValue(
      targetRow({ userId: "alvo", positions: [10] }),
    );
    await expect(
      canActOnUser(actor({ highestRolePosition: 60 }), "alvo"),
    ).resolves.toBe(true);
  });

  it("NAO age sobre cargo de mesma altura", async () => {
    /**
     * Empate recusa. Se moderador pudesse moderar moderador, dois deles
     * conseguiriam se expulsar mutuamente, e a hierarquia deixaria de ser
     * ordem para virar disputa.
     */
    findUnique.mockResolvedValue(
      targetRow({ userId: "alvo", positions: [60] }),
    );
    await expect(
      canActOnUser(actor({ highestRolePosition: 60 }), "alvo"),
    ).resolves.toBe(false);
  });

  it("NAO age sobre cargo acima", async () => {
    findUnique.mockResolvedValue(
      targetRow({ userId: "alvo", positions: [80] }),
    );
    await expect(
      canActOnUser(actor({ highestRolePosition: 60 }), "alvo"),
    ).resolves.toBe(false);
  });

  it("usa o MAIOR cargo do alvo, nao o primeiro que aparecer", async () => {
    /**
     * Quem tem varios cargos e protegido pelo mais alto deles. Somar, usar o
     * ultimo ou confiar na ordem do banco deixaria um moderador ser expulso
     * por alguem abaixo dele, dependendo da ordem em que os cargos voltassem.
     */
    findUnique.mockResolvedValue(
      targetRow({ userId: "alvo", positions: [10, 80, 1] }),
    );
    await expect(
      canActOnUser(actor({ highestRolePosition: 60 }), "alvo"),
    ).resolves.toBe(false);
  });

  it("age sobre membro sem nenhum cargo", async () => {
    findUnique.mockResolvedValue(targetRow({ userId: "alvo", positions: [] }));
    await expect(
      canActOnUser(actor({ highestRolePosition: 10 }), "alvo"),
    ).resolves.toBe(true);
  });

  it("ator sem cargo nenhum nao age sobre ninguem", async () => {
    /** position 0 nao e estritamente maior que os 0 do alvo sem cargo. */
    findUnique.mockResolvedValue(targetRow({ userId: "alvo", positions: [] }));
    await expect(
      canActOnUser(actor({ highestRolePosition: 0 }), "alvo"),
    ).resolves.toBe(false);
  });

  it("procura o alvo no servidor do ATOR, nao em outro", async () => {
    /**
     * O serverId vem do contexto ja autorizado, nunca do cliente. Se viesse do
     * payload, daria para moderar em servidor alheio usando o proprio cargo.
     */
    findUnique.mockResolvedValue(targetRow({ userId: "alvo", positions: [1] }));
    await canActOnUser(actor({ highestRolePosition: 60 }), "alvo");

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { serverId_userId: { serverId: SERVER, userId: "alvo" } },
      }),
    );
  });
});
