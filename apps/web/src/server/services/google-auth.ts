import "server-only";

import { prisma } from "@aether/db";
import { usernameSchema } from "@aether/shared";
import type { IdentidadeGoogle } from "@/server/auth/google";

/**
 * Acha, vincula ou cria a conta AETHER para uma identidade Google.
 *
 * DECISAO DE VINCULO (confirmada com o dono do produto): se o e-mail da conta
 * Google bate com uma conta ja existente, vincula automaticamente — o Google
 * so devolve `email_verified: true` para quem provou ser dono da caixa, e por
 * isso confiamos nele do mesmo jeito que confiamos no nosso proprio link de
 * confirmacao por e-mail (`@aether/access/verificacao`). Mesmo padrao usado
 * por GitHub/Discord/Slack.
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
  if (porEmail) {
    await prisma.user.update({
      where: { id: porEmail.id },
      data: {
        googleId: identidade.sub,
        // O Google ja confirmou o dono deste e-mail — se por algum motivo a
        // conta local ainda nao tinha confirmado, isto conta como confirmacao.
        emailVerificadoEm: porEmail.emailVerificadoEm ?? new Date(),
      },
    });
    return { id: porEmail.id, totpHabilitadoEm: porEmail.totpHabilitadoEm };
  }

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
