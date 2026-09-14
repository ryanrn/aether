"use server";

import { prisma } from "@aether/db";
import type { ActionResult } from "@aether/shared";
import { requireUser } from "../guards";
import { verifyPassword } from "../auth/password";
import { clientKey, rateLimit } from "../auth/rate-limit";
import {
  confirmarConfiguracao,
  desativar,
  estadoTotp,
  iniciarConfiguracao,
  regenerarCodigosDeBackup,
  TotpCodigoInvalido,
  TotpJaAtivo,
  TotpNaoConfigurado,
  type EstadoTotp,
} from "../services/totp";
import { fail, ok, toActionError } from "./action-result";

/**
 * Configuracao do 2FA pela propria pessoa (aba Seguranca). O uso durante o
 * LOGIN (segundo fator apos a senha) mora em `actions/auth.ts` — e outro
 * momento, com outro guard (nao ha sessao completa ainda).
 *
 * DESATIVAR e REGENERAR CODIGOS exigem a SENHA de novo, nao so a sessao
 * ativa — sao acoes que reduzem ou revelam de novo a proteção da conta;
 * mesma exigencia que qualquer app serio pede aqui.
 */

async function confirmarSenha(userId: string, senha: string): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user.passwordHash) return false;
  return verifyPassword(senha, user.passwordHash);
}

export async function estadoTotpAction(): Promise<ActionResult<EstadoTotp>> {
  try {
    const sessao = await requireUser();
    return ok(await estadoTotp(sessao.user.id));
  } catch (error) {
    return toActionError(error);
  }
}

export async function iniciarConfiguracaoTotpAction(): Promise<
  ActionResult<{ segredoBase32: string; otpauthUri: string }>
> {
  try {
    const sessao = await requireUser();
    const dados = await iniciarConfiguracao(sessao.user.id, sessao.user.username);
    return ok(dados);
  } catch (error) {
    if (error instanceof TotpJaAtivo) {
      return fail("O 2FA ja esta ativo nesta conta. Desative antes de reconfigurar.");
    }
    return toActionError(error);
  }
}

export async function confirmarConfiguracaoTotpAction(
  codigo: string,
): Promise<ActionResult<{ codigosDeBackup: string[] }>> {
  try {
    const sessao = await requireUser();
    if (typeof codigo !== "string" || codigo.trim().length === 0) {
      return fail("Digite o codigo do aplicativo autenticador.", "codigo");
    }

    // Por conta: um segredo pendente aceita 6 digitos, sem isto vira um
    // oraculo de forca bruta contra os proprios 10^6 valores possiveis.
    const limite = await rateLimit(
      `totp-confirmar:${sessao.user.id}`,
      8,
      10 * 60_000,
      { failClosed: true },
    );
    if (!limite.ok) {
      return fail(`Muitas tentativas. Aguarde ${limite.retryAfter}s.`);
    }

    const codigosDeBackup = await confirmarConfiguracao(sessao.user.id, codigo);
    return ok({ codigosDeBackup });
  } catch (error) {
    if (error instanceof TotpNaoConfigurado) {
      return fail("Nenhuma configuracao pendente. Comece de novo.");
    }
    if (error instanceof TotpJaAtivo) {
      return fail("O 2FA ja esta ativo nesta conta.");
    }
    if (error instanceof TotpCodigoInvalido) {
      return fail("Codigo invalido ou vencido.", "codigo");
    }
    return toActionError(error);
  }
}

export async function desativarTotpAction(senha: string): Promise<ActionResult<undefined>> {
  try {
    const sessao = await requireUser();

    const limite = await rateLimit(
      await clientKey("totp-desativar"),
      8,
      10 * 60_000,
      { failClosed: true },
    );
    if (!limite.ok) {
      return fail(`Muitas tentativas. Aguarde ${limite.retryAfter}s.`);
    }

    if (typeof senha !== "string" || !(await confirmarSenha(sessao.user.id, senha))) {
      return fail("Senha incorreta.", "senha");
    }

    await desativar(sessao.user.id);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function regenerarCodigosDeBackupAction(
  senha: string,
): Promise<ActionResult<{ codigosDeBackup: string[] }>> {
  try {
    const sessao = await requireUser();

    const limite = await rateLimit(
      await clientKey("totp-regenerar"),
      8,
      10 * 60_000,
      { failClosed: true },
    );
    if (!limite.ok) {
      return fail(`Muitas tentativas. Aguarde ${limite.retryAfter}s.`);
    }

    if (typeof senha !== "string" || !(await confirmarSenha(sessao.user.id, senha))) {
      return fail("Senha incorreta.", "senha");
    }

    const codigosDeBackup = await regenerarCodigosDeBackup(sessao.user.id);
    return ok({ codigosDeBackup });
  } catch (error) {
    if (error instanceof TotpNaoConfigurado) {
      return fail("O 2FA nao esta ativo nesta conta.");
    }
    return toActionError(error);
  }
}
