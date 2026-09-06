import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@aether/db";
import { flagLigada } from "./flags";

/**
 * Confirmacao de e-mail.
 *
 * Mesma postura do `password-reset` do app web: o token que vai para a caixa
 * NUNCA e gravado — so o sha256 —, vale UMA vez e por pouco tempo. Um dump de
 * backup com token legivel deixaria qualquer um confirmar a conta de qualquer
 * um.
 *
 * MORA EM `@aether/access` (e nao em `apps/web/src/server` como o reset)
 * porque `precisaVerificarEmail` e consultado nos DOIS lados — o web para
 * mostrar a parede, e um dia o gateway para recusar `message:send` de conta
 * nao confirmada. Regra que os dois respondem: mora aqui.
 */

/** 24h: tempo de sobra para abrir o e-mail, sem deixar link vivo por semanas. */
const VALIDADE_MS = 24 * 60 * 60 * 1000;

function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Cria um token novo e devolve o valor EM CLARO (para o link do e-mail).
 * Invalida os anteriores da mesma conta — um "reenviar" nao pode deixar cinco
 * links validos por ai.
 */
export async function criarTokenDeVerificacao(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.verificacaoEmail.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.verificacaoEmail.create({
      data: {
        userId,
        tokenHash: hashDoToken(token),
        expiresAt: new Date(Date.now() + VALIDADE_MS),
      },
    }),
  ]);
  return token;
}

export type ResultadoDeVerificacao =
  | { ok: true; userId: string; jaEstava: boolean }
  | { ok: false; motivo: "invalido" | "expirado" | "usado" };

/**
 * Consome um token. Carimba `usedAt` e `User.emailVerificadoEm` na mesma
 * transacao. `jaEstava` cobre o clique-duplo no link: a segunda vez o token ja
 * foi usado, mas a conta ja esta confirmada, entao a tela pode dizer "pronto"
 * em vez de "link invalido".
 */
export async function consumirTokenDeVerificacao(
  token: string,
): Promise<ResultadoDeVerificacao> {
  if (!token || typeof token !== "string") return { ok: false, motivo: "invalido" };

  const linha = await prisma.verificacaoEmail.findUnique({
    where: { tokenHash: hashDoToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!linha) return { ok: false, motivo: "invalido" };

  if (linha.usedAt) {
    const user = await prisma.user.findUnique({
      where: { id: linha.userId },
      select: { emailVerificadoEm: true },
    });
    if (user?.emailVerificadoEm) {
      return { ok: true, userId: linha.userId, jaEstava: true };
    }
    return { ok: false, motivo: "usado" };
  }

  if (linha.expiresAt.getTime() < Date.now()) {
    return { ok: false, motivo: "expirado" };
  }

  await prisma.$transaction([
    prisma.verificacaoEmail.update({
      where: { id: linha.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: linha.userId },
      data: { emailVerificadoEm: new Date() },
    }),
  ]);

  return { ok: true, userId: linha.userId, jaEstava: false };
}

/**
 * Esta conta precisa confirmar o e-mail ANTES de usar o app?
 *
 * `true` so quando a flag `exige_email_verificado` esta ligada E a conta ainda
 * nao confirmou. Equipe nunca bate na parede — quem administra o produto nao
 * pode se trancar para fora dele.
 */
export async function precisaVerificarEmail(user: {
  emailVerificadoEm: Date | null;
  equipe?: boolean;
}): Promise<boolean> {
  if (user.emailVerificadoEm) return false;
  if (user.equipe) return false;
  return await flagLigada("exige_email_verificado");
}
