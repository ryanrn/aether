"use server";

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@aether/db";
import { emailSchema, passwordSchema, type ActionResult } from "@aether/shared";
import { log } from "@aether/shared/log";
import { hashPassword } from "@/server/auth/password";
import { clientKey, rateLimit } from "@/server/auth/rate-limit";
import { emailDeRedefinicao, enviarEmail } from "@/server/email";

/**
 * Redefinicao de senha por e-mail.
 *
 * As decisoes de seguranca deste arquivo, e o motivo de cada uma:
 *
 * 1. RESPOSTA CONSTANTE. Pedir o link responde a mesma coisa exista ou nao a
 *    conta. Dizer "e-mail nao encontrado" transformaria esta tela num oraculo
 *    de quem tem conta aqui — util para quem quer montar lista de alvos.
 *
 * 2. TOKEN GUARDADO COMO HASH. O que vai no e-mail nunca e escrito no banco.
 *    Se o banco vazar (ou o dump de backup, que carrega esta tabela), token
 *    legivel deixaria qualquer um redefinir qualquer conta.
 *
 * 3. USO UNICO E VALIDADE CURTA. Uma hora, e `usedAt` carimbado ao redefinir.
 *
 * 4. REVOGA TODAS AS SESSOES. Quem redefine senha costuma estar justamente
 *    tirando alguem de dentro. Deixar as sessoes antigas vivas manteria o
 *    invasor conectado com a senha nova.
 *
 * 5. RATE LIMIT EM DUAS CHAVES: por IP e por e-mail. So por IP, daria para
 *    bombardear a caixa de uma pessoa trocando de rede; so por e-mail, daria
 *    para varrer muitos enderecos de um IP so.
 */

/** Uma hora: tempo de sobra para abrir o e-mail, curto para um link roubado. */
const VALIDADE_MS = 60 * 60 * 1000;

function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Pede o link de redefinicao.
 *
 * SEMPRE devolve sucesso — ver decisao 1. O unico erro que aparece na tela e
 * o de formato de e-mail (que nao revela nada) e o de rate limit.
 */
export async function requestPasswordResetAction(
  email: string,
): Promise<ActionResult<{ enviado: true }>> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return { ok: false, error: "E-mail invalido", field: "email" };
  }
  const alvo = parsed.data.toLowerCase();

  // Por IP: impede varrer muitos enderecos de uma vez. `failClosed` porque um
  // flood de pedidos de reset e email-bombing de uma vitima — nao pode ficar
  // sem freio se o Redis piscar (auditoria H2).
  const porIp = await rateLimit(await clientKey("reset-ip"), 5, 15 * 60_000, {
    failClosed: true,
  });
  if (!porIp.ok) {
    return {
      ok: false,
      error: `Muitas tentativas. Tente de novo em ${porIp.retryAfter}s.`,
    };
  }
  // Por e-mail: impede encher a caixa de UMA pessoa trocando de rede.
  const porEmail = await rateLimit(`reset-email:${alvo}`, 3, 15 * 60_000, {
    failClosed: true,
  });
  if (!porEmail.ok) {
    // Mesma mensagem do caso acima: nao dizemos que este e-mail existe.
    return {
      ok: false,
      error: `Muitas tentativas. Tente de novo em ${porEmail.retryAfter}s.`,
    };
  }

  const user = await prisma.user.findUnique({
    where: { email: alvo },
    select: { id: true, email: true, displayName: true },
  });

  // Conta inexistente: sai em silencio, com a MESMA resposta de sucesso.
  if (!user) return { ok: true, data: { enviado: true } };

  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashDoToken(token),
      expiresAt: new Date(Date.now() + VALIDADE_MS),
    },
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const link = `${base}/redefinir?token=${token}`;
  const { html, texto } = emailDeRedefinicao(link, user.displayName);

  const envio = await enviarEmail({
    para: user.email,
    assunto: "Redefinir sua senha no AETHER",
    html,
    texto,
  });

  if (!envio.ok) {
    /**
     * Falha de envio NAO vira erro na tela — ver decisao 1: a mensagem
     * mudaria conforme a conta existir. Fica no log do servidor, e em
     * desenvolvimento o link vai junto para dar para testar o fluxo inteiro
     * sem provedor de e-mail nenhum.
     */
    log.error("web.password_reset.envio", "envio do e-mail de redefinição falhou", {
      motivo: envio.motivo,
    });
    if (process.env.NODE_ENV !== "production") {
      console.log("[reset] link (so em desenvolvimento):", link);
    }
  }

  return { ok: true, data: { enviado: true } };
}

/**
 * Confere um token sem gastar. Serve para a pagina decidir se mostra o
 * formulario ou a mensagem de link vencido.
 */
export async function checkResetTokenAction(
  token: string,
): Promise<ActionResult<{ valido: boolean }>> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: true, data: { valido: false } };
  }
  const registro = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashDoToken(token) },
    select: { expiresAt: true, usedAt: true },
  });
  const valido =
    registro !== null &&
    registro.usedAt === null &&
    registro.expiresAt.getTime() > Date.now();
  return { ok: true, data: { valido } };
}

/** Redefine a senha e derruba todas as sessoes daquela conta. */
export async function resetPasswordAction(
  token: string,
  novaSenha: string,
): Promise<ActionResult<{ pronto: true }>> {
  const senha = passwordSchema.safeParse(novaSenha);
  if (!senha.success) {
    return {
      ok: false,
      error: senha.error.issues[0]?.message ?? "Senha invalida",
      field: "password",
    };
  }

  // Impede forca bruta sobre o token: 32 bytes ja sao inadivinhaveis, mas o
  // custo desta linha e zero e o teto vale por qualquer descuido futuro.
  const limite = await rateLimit(
    await clientKey("reset-confirm"),
    10,
    15 * 60_000,
  );
  if (!limite.ok) {
    return {
      ok: false,
      error: `Muitas tentativas. Tente de novo em ${limite.retryAfter}s.`,
    };
  }

  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, error: "Link invalido ou ja usado." };
  }

  const registro = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashDoToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  // Uma unica mensagem para os tres casos (nao existe, vencido, ja usado):
  // distinguir diria a quem tem o link o que exatamente aconteceu com ele.
  const invalido =
    !registro ||
    registro.usedAt !== null ||
    registro.expiresAt.getTime() <= Date.now();
  if (invalido) {
    return {
      ok: false,
      error: "Link invalido, vencido ou ja usado. Peca um novo.",
    };
  }

  const passwordHash = await hashPassword(senha.data);

  /**
   * Tudo numa transacao: se a senha trocar e a revogacao de sessao falhar,
   * o invasor continuaria dentro com a senha NOVA — o pior resultado
   * possivel deste fluxo.
   */
  await prisma.$transaction([
    prisma.user.update({
      where: { id: registro.userId },
      data: { passwordHash },
    }),
    prisma.passwordReset.update({
      where: { id: registro.id },
      data: { usedAt: new Date() },
    }),
    // Os OUTROS pedidos pendentes tambem morrem: pedir tres links e usar um
    // nao pode deixar dois vivos por ai.
    prisma.passwordReset.updateMany({
      where: { userId: registro.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.session.updateMany({
      where: { userId: registro.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return { ok: true, data: { pronto: true } };
}
