import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vinculo da identidade Google com conta existente (auditoria 28/09 item 2).
 *
 * O ataque: alguem cadastra o e-mail da vitima com senha propria e espera.
 * Quando a vitima entra com o Google, o vinculo por e-mail cai na conta do
 * atacante. O que este teste prende e que, nesse caso, nada da conta que
 * nunca provou o e-mail sobrevive — senha, sessoes, 2FA, links pendentes.
 *
 * O banco e DUBLADO: o que importa e o que o resolvedor manda gravar. O
 * Postgres real fica com os verify-* contra servicos no ar.
 */

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const userCreate = vi.fn();
const sessionUpdateMany = vi.fn();
const passwordResetUpdateMany = vi.fn();
const verificacaoUpdateMany = vi.fn();
const codigoDesktopUpdateMany = vi.fn();
const backupDeleteMany = vi.fn();
const transaction = vi.fn(async (ops: unknown[]) => ops);

vi.mock("@aether/db", () => ({
  prisma: {
    user: { findUnique: userFindUnique, update: userUpdate, create: userCreate },
    session: { updateMany: sessionUpdateMany },
    passwordReset: { updateMany: passwordResetUpdateMany },
    verificacaoEmail: { updateMany: verificacaoUpdateMany },
    codigoLoginDesktop: { updateMany: codigoDesktopUpdateMany },
    totpBackupCode: { deleteMany: backupDeleteMany },
    $transaction: transaction,
  },
}));

const { resolverUsuarioGoogle } = await import(
  "../../apps/web/src/server/services/google-auth"
);

const IDENTIDADE = {
  sub: "google-sub-1",
  email: "vitima@example.com",
  nome: "Vitima",
  avatarUrl: null,
};

/** Primeira busca e por googleId, a segunda por e-mail. */
function contas(porGoogleId: unknown, porEmail: unknown) {
  userFindUnique
    .mockResolvedValueOnce(porGoogleId)
    .mockResolvedValueOnce(porEmail);
}

beforeEach(() => {
  for (const fn of [
    userFindUnique,
    userUpdate,
    userCreate,
    sessionUpdateMany,
    passwordResetUpdateMany,
    verificacaoUpdateMany,
    codigoDesktopUpdateMany,
    backupDeleteMany,
    transaction,
  ]) {
    fn.mockClear();
  }
  userFindUnique.mockReset();
});

describe("resolverUsuarioGoogle", () => {
  it("conta ja vinculada ao googleId entra direto, sem gravar nada", async () => {
    contas({ id: "u1", totpHabilitadoEm: null }, undefined);

    const r = await resolverUsuarioGoogle(IDENTIDADE);

    expect(r.id).toBe("u1");
    expect(userUpdate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("conta com e-mail confirmado so ganha o googleId — senha, sessoes e 2FA ficam", async () => {
    const totp = new Date("2026-09-01");
    contas(null, {
      id: "u2",
      totpHabilitadoEm: totp,
      emailVerificadoEm: new Date("2026-08-01"),
    });

    const r = await resolverUsuarioGoogle(IDENTIDADE);

    expect(r).toEqual({ id: "u2", totpHabilitadoEm: totp });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { googleId: "google-sub-1" },
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(sessionUpdateMany).not.toHaveBeenCalled();
  });

  it("conta que NUNCA confirmou o e-mail perde senha, sessoes, 2FA e links, numa transacao", async () => {
    contas(null, {
      id: "u3",
      totpHabilitadoEm: new Date("2026-09-01"),
      emailVerificadoEm: null,
    });

    const r = await resolverUsuarioGoogle(IDENTIDADE);

    // O 2FA de quem cadastrou nao pode pedir codigo ao dono da caixa.
    expect(r).toEqual({ id: "u3", totpHabilitadoEm: null });
    expect(transaction).toHaveBeenCalledOnce();

    const data = userUpdate.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      googleId: "google-sub-1",
      passwordHash: null,
      totpSecretCifrado: null,
      totpHabilitadoEm: null,
      totpUltimoPassoUsado: null,
    });
    expect(data.emailVerificadoEm).toBeInstanceOf(Date);

    const soDaConta = { userId: "u3" };
    expect(backupDeleteMany).toHaveBeenCalledWith({ where: soDaConta });
    expect(sessionUpdateMany.mock.calls[0]![0].where).toEqual({
      ...soDaConta,
      revokedAt: null,
    });
    for (const pendentes of [
      passwordResetUpdateMany,
      verificacaoUpdateMany,
      codigoDesktopUpdateMany,
    ]) {
      expect(pendentes.mock.calls[0]![0].where).toEqual({
        ...soDaConta,
        usedAt: null,
      });
    }
  });

  it("e-mail sem conta cria uma nova, ja confirmada e sem senha", async () => {
    contas(null, null);
    // usernameDisponivelParaEmail: "vitima" esta livre.
    userFindUnique.mockResolvedValueOnce(null);
    userCreate.mockResolvedValue({ id: "u4", totpHabilitadoEm: null });

    const r = await resolverUsuarioGoogle(IDENTIDADE);

    expect(r.id).toBe("u4");
    const data = userCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      username: "vitima",
      email: "vitima@example.com",
      passwordHash: null,
      googleId: "google-sub-1",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
