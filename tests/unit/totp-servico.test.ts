import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Servico de 2FA (TOTP) — banco dublado, cifra REAL (o `AUTH_SECRET` fixo da
 * suite, ver `tests/setup.ts`, e o mesmo que `cifrar`/`decifrar` usam).
 *
 * O que se trava aqui, alem da matematica ja coberta em `totp.test.ts`:
 *  - so pode configurar quando NAO esta ativo (`TotpJaAtivo`);
 *  - so confirma com segredo pendente de verdade (`TotpNaoConfigurado`) e
 *    codigo certo (`TotpCodigoInvalido`);
 *  - confirmar gera exatamente o lote de codigos de backup, e SO ai o 2FA
 *    passa a valer;
 *  - o MESMO codigo TOTP nao serve duas vezes (RFC 6238 — reuso dentro da
 *    propria janela de 30s);
 *  - o MESMO codigo de backup nao serve duas vezes;
 *  - desativar apaga segredo E todos os codigos de backup, numa transacao.
 */

const userFindUniqueOrThrow = vi.fn();
const userUpdate = vi.fn();
const backupDeleteMany = vi.fn();
const backupCreateMany = vi.fn();
const backupCount = vi.fn();
const backupUpdateMany = vi.fn();
const transaction = vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));

vi.mock("@aether/db", async () => {
  const real = await vi.importActual<typeof import("@aether/db")>("@aether/db");
  return {
    ...real,
    prisma: {
      user: { findUniqueOrThrow: userFindUniqueOrThrow, update: userUpdate },
      totpBackupCode: {
        deleteMany: backupDeleteMany,
        createMany: backupCreateMany,
        count: backupCount,
        updateMany: backupUpdateMany,
      },
      $transaction: transaction,
    },
  };
});

const {
  confirmarConfiguracao,
  desativar,
  estadoTotp,
  iniciarConfiguracao,
  TotpCodigoInvalido,
  TotpJaAtivo,
  TotpNaoConfigurado,
  verificarCodigoDeLogin,
} = await import("../../apps/web/src/server/services/totp");
const { cifrar } = await import("@aether/db");
const { totpAtual } = await import("../../packages/shared/src/totp");

/** Segredo fixo (vetor de teste da propria RFC 6238) — so para os testes. */
const SEGREDO = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

beforeEach(() => {
  for (const m of [
    userFindUniqueOrThrow,
    userUpdate,
    backupDeleteMany,
    backupCreateMany,
    backupCount,
    backupUpdateMany,
  ]) {
    m.mockReset();
  }
  transaction.mockReset();
  transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  backupDeleteMany.mockResolvedValue({ count: 0 });
  backupCreateMany.mockResolvedValue({ count: 10 });
  userUpdate.mockResolvedValue({});
});

describe("iniciarConfiguracao", () => {
  it("recusa quando o 2FA ja esta ativo", async () => {
    userFindUniqueOrThrow.mockResolvedValue({ totpHabilitadoEm: new Date() });
    await expect(iniciarConfiguracao("u1", "ryan")).rejects.toThrow(TotpJaAtivo);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("gera um segredo, cifra e grava como pendente", async () => {
    userFindUniqueOrThrow.mockResolvedValue({ totpHabilitadoEm: null });
    const r = await iniciarConfiguracao("u1", "ryan");
    expect(r.segredoBase32).toMatch(/^[A-Z2-7]{32}$/);
    expect(r.otpauthUri).toContain(encodeURIComponent("ryan"));
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        totpSecretCifrado: expect.stringContaining("v1."),
        totpUltimoPassoUsado: null,
      },
    });
  });
});

describe("confirmarConfiguracao", () => {
  it("recusa sem nenhuma configuracao pendente", async () => {
    userFindUniqueOrThrow.mockResolvedValue({
      totpSecretCifrado: null,
      totpHabilitadoEm: null,
    });
    await expect(confirmarConfiguracao("u1", "123456")).rejects.toThrow(
      TotpNaoConfigurado,
    );
  });

  it("recusa se ja estiver ativo", async () => {
    userFindUniqueOrThrow.mockResolvedValue({
      totpSecretCifrado: cifrar(SEGREDO),
      totpHabilitadoEm: new Date(),
    });
    await expect(confirmarConfiguracao("u1", "123456")).rejects.toThrow(TotpJaAtivo);
  });

  it("recusa codigo errado, sem ativar nem gerar codigo de backup", async () => {
    userFindUniqueOrThrow.mockResolvedValue({
      totpSecretCifrado: cifrar(SEGREDO),
      totpHabilitadoEm: null,
    });
    await expect(confirmarConfiguracao("u1", "000000")).rejects.toThrow(
      TotpCodigoInvalido,
    );
    expect(backupCreateMany).not.toHaveBeenCalled();
  });

  it("com o codigo certo, ativa e devolve 10 codigos de backup", async () => {
    userFindUniqueOrThrow.mockResolvedValue({
      totpSecretCifrado: cifrar(SEGREDO),
      totpHabilitadoEm: null,
    });
    const codigos = await confirmarConfiguracao("u1", totpAtual(SEGREDO));
    expect(codigos).toHaveLength(10);
    expect(new Set(codigos).size).toBe(10); // nenhum repetido
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totpHabilitadoEm: expect.any(Date) }),
      }),
    );
    expect(backupDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(backupCreateMany).toHaveBeenCalled();
  });
});

describe("verificarCodigoDeLogin — codigo do autenticador", () => {
  it("aceita o codigo certo, e recusa o MESMO codigo de novo (reuso)", async () => {
    userFindUniqueOrThrow.mockResolvedValue({
      totpSecretCifrado: cifrar(SEGREDO),
      totpHabilitadoEm: new Date(),
      totpUltimoPassoUsado: null,
    });
    const codigo = totpAtual(SEGREDO);

    const r1 = await verificarCodigoDeLogin("u1", codigo);
    expect(r1).toEqual({ ok: true, usouCodigoDeBackup: false });

    // O banco "de verdade" agora teria o contador atualizado — simula isso
    // pegando o valor exato que o servico gravou.
    const contadorGravado = userUpdate.mock.calls[0]![0].data.totpUltimoPassoUsado;
    userFindUniqueOrThrow.mockResolvedValue({
      totpSecretCifrado: cifrar(SEGREDO),
      totpHabilitadoEm: new Date(),
      totpUltimoPassoUsado: contadorGravado,
    });

    const r2 = await verificarCodigoDeLogin("u1", codigo);
    expect(r2.ok).toBe(false);
  });

  it("recusa quando o 2FA nao esta ativo", async () => {
    userFindUniqueOrThrow.mockResolvedValue({
      totpSecretCifrado: null,
      totpHabilitadoEm: null,
      totpUltimoPassoUsado: null,
    });
    const r = await verificarCodigoDeLogin("u1", "123456");
    expect(r.ok).toBe(false);
  });
});

describe("verificarCodigoDeLogin — codigo de backup", () => {
  it("aceita um codigo de backup nao usado, e recusa o MESMO de novo", async () => {
    backupUpdateMany.mockResolvedValueOnce({ count: 1 });
    const r1 = await verificarCodigoDeLogin("u1", "ABCDE-FGHIJ");
    expect(r1).toEqual({ ok: true, usouCodigoDeBackup: true });

    backupUpdateMany.mockResolvedValueOnce({ count: 0 });
    const r2 = await verificarCodigoDeLogin("u1", "ABCDE-FGHIJ");
    expect(r2.ok).toBe(false);

    // nao devia bater no lado TOTP em nenhuma das duas chamadas
    expect(userFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("recusa formato vazio ou so espaco", async () => {
    backupUpdateMany.mockResolvedValue({ count: 0 });
    const r = await verificarCodigoDeLogin("u1", "   ");
    expect(r.ok).toBe(false);
  });
});

describe("desativar", () => {
  it("limpa os campos do usuario E apaga os codigos de backup, numa transacao", async () => {
    await desativar("u1");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        totpSecretCifrado: null,
        totpHabilitadoEm: null,
        totpUltimoPassoUsado: null,
      },
    });
    expect(backupDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });
});

describe("estadoTotp", () => {
  it("reporta 'pendente' quando ha segredo mas nao foi confirmado", async () => {
    userFindUniqueOrThrow.mockResolvedValue({
      totpSecretCifrado: "algo",
      totpHabilitadoEm: null,
    });
    backupCount.mockResolvedValue(0);
    await expect(estadoTotp("u1")).resolves.toEqual({
      configurado: true,
      habilitado: false,
      codigosDeBackupRestantes: 0,
    });
  });

  it("reporta 'habilitado' com a contagem de codigos restantes", async () => {
    userFindUniqueOrThrow.mockResolvedValue({
      totpSecretCifrado: "algo",
      totpHabilitadoEm: new Date(),
    });
    backupCount.mockResolvedValue(7);
    await expect(estadoTotp("u1")).resolves.toEqual({
      configurado: true,
      habilitado: true,
      codigosDeBackupRestantes: 7,
    });
  });
});
