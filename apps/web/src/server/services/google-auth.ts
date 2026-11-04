import "server-only";

import { prisma } from "@aether/db";
import { usernameSchema } from "@aether/shared";
import { log } from "@aether/shared/log";
import type { IdentidadeGoogle } from "@/server/auth/google";

/**
 * Acha, vincula ou cria a conta AETHER para uma identidade Google.
 *
 * DECISAO DE VINCULO (confirmada com o dono do produto): se o e-mail da conta
 * Google bate com uma conta ja existente E JA CONFIRMADA, vincula
 * automaticamente — o Google so devolve `email_verified: true` para quem
 * provou ser dono da caixa, e a conta local provou o mesmo pelo nosso link
 * (`@aether/access/verificacao`). Conta que nunca confirmou o e-mail cai em
 * `assumirContaNaoVerificada`, que nao confia em nada que veio dela.
 *
 * NAO cria um sistema de auth paralelo: o resultado e sempre um `User` normal
 * (mesma tabela, mesmo `createSession`) — so a MANEIRA de provar quem e a
 * pessoa muda.
 */

/** Gera um `username` disponivel a partir do e-mail — parte local, higienizada. */
async function usernameDisponivelParaEmail(email: string): Promise<string> {
  const local = email
    .split("@")[0]!
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  const base = (local.length >= 3 ? local : `pessoa${local}`).slice(0, 20);

  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const candidato = tentativa === 0 ? base : `${base}${tentativa}`;
    if (!usernameSchema.safeParse(candidato).success) continue;
    const existe = await prisma.user.findUnique({
      where: { username: candidato },
      select: { id: true },
    });
    if (!existe) return candidato;
  }
  // Praticamente inatingivel (50 colisoes seguidas) — sufixo aleatorio garante saida.
  return `${base}${Math.random().toString(36).slice(2, 8)}`;
}

export interface UsuarioResolvido {
  id: string;
  totpHabilitadoEm: Date | null;
}

/**
 * O e-mail bate com uma conta que NUNCA provou ser dona dele.
 *
 * O vinculo automatico so e seguro quando os dois lados provaram a mesma caixa.
 * Aqui so o Google provou: a senha local pode ser de quem cadastrou o e-mail
 * de outra pessoa para esperar ela entrar com o Google (pre-sequestro de
 * conta, auditoria 28/09 item 2). Vincular sem mais nada entregaria a conta
 * ao dono da caixa E manteria a senha, as sessoes e o 2FA de quem cadastrou.
 *
 * Por isso a identidade provada vence e tudo que veio da prova fraca morre na
 * mesma transacao: senha, sessoes, links de redefinicao/verificacao, codigos
 * de login do desktop e o 2FA (cujo segredo pode ser de quem cadastrou — se
 * ficasse, travaria o dono da caixa do lado de fora). Se a conta era mesmo da
 * pessoa e ela so nunca confirmou o e-mail, ela segue entrando pelo Google e
 * pode criar uma senha nova por "esqueci a senha".
 */
async function assumirContaNaoVerificada(
  userId: string,
  googleId: string,
): Promise<UsuarioResolvido> {
  const agora = new Date();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        googleId,
        emailVerificadoEm: agora,
        passwordHash: null,
        totpSecretCifrado: null,
        totpHabilitadoEm: null,
        totpUltimoPassoUsado: null,
      },
    }),
    prisma.totpBackupCode.deleteMany({ where: { userId } }),
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: agora },
    }),
    prisma.passwordReset.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: agora },
    }),
    prisma.verificacaoEmail.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: agora },
    }),
    prisma.codigoLoginDesktop.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: agora },
    }),
  ]);
  log.warn("web.google.assumiu_conta", "conta sem e-mail verificado assumida pelo Google", {
    userId,
  });
  return { id: userId, totpHabilitadoEm: null };
}

export async function resolverUsuarioGoogle(
  identidade: IdentidadeGoogle,
): Promise<UsuarioResolvido> {
  const porGoogleId = await prisma.user.findUnique({
    where: { googleId: identidade.sub },
    select: { id: true, totpHabilitadoEm: true },
  });
  if (porGoogleId) return porGoogleId;

  const porEmail = await prisma.user.findUnique({
    where: { email: identidade.email },
    select: { id: true, totpHabilitadoEm: true, emailVerificadoEm: true },
  });
  if (porEmail?.emailVerificadoEm) {
    await prisma.user.update({
      where: { id: porEmail.id },
      data: { googleId: identidade.sub },
    });
    return { id: porEmail.id, totpHabilitadoEm: porEmail.totpHabilitadoEm };
  }
  if (porEmail) return assumirContaNaoVerificada(porEmail.id, identidade.sub);

  const username = await usernameDisponivelParaEmail(identidade.email);
  const criado = await prisma.user.create({
    data: {
      username,
      displayName: identidade.nome?.trim() || username,
      email: identidade.email,
      passwordHash: null,
      googleId: identidade.sub,
      emailVerificadoEm: new Date(),
      avatarUrl: identidade.avatarUrl ?? undefined,
    },
    select: { id: true, totpHabilitadoEm: true },
  });
  return criado;
}
