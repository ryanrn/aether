import { prisma } from "@aether/db";

/**
 * Silenciamento GLOBAL — a acao de moderacao que vale na base inteira, decidida
 * pela equipe a partir de uma denuncia.
 *
 * NAO CONFUNDIR COM BAN: ban e por servidor (dono decide, tira a pessoa do
 * servidor). Silenciamento e global (equipe decide, a pessoa continua em todo
 * lugar mas nao MANDA mensagem — texto e DM). Eixos diferentes, como
 * `equipe.ts` explica para a administracao global.
 *
 * MORA EM `@aether/access` porque o gateway (que barra o `message:send`) e o
 * web (que mostra o estado e aplica a acao) precisam da MESMA resposta para
 * "esta conta esta silenciada agora?".
 */

/**
 * Esta conta esta silenciada AGORA?
 *
 * `silenciadoEm` preenchido e (`silenciadoAte` nulo OU no futuro). Um
 * silenciamento com prazo que ja passou nao conta — mesma logica de "ban
 * vencido nao conta" da moderacao de servidor. A linha fica no banco como
 * historico; nao ha rotina que limpe.
 */
export function estaSilenciado(user: {
  silenciadoEm: Date | null;
  silenciadoAte: Date | null;
}): boolean {
  if (!user.silenciadoEm) return false;
  if (user.silenciadoAte && user.silenciadoAte.getTime() < Date.now()) {
    return false;
  }
  return true;
}

/**
 * Silencia uma conta. `ate` nulo = indefinido (a equipe tira a mao depois).
 *
 * Quem chama e responsavel por: (1) checar que e equipe; (2) revogar as
 * sessoes da pessoa depois, para o efeito valer nos sockets ja abertos — o
 * `socket.data` do gateway congela no handshake.
 */
export async function silenciarGlobalmente(
  userId: string,
  opcoes: { porQuem: string; motivo: string | null; ate: Date | null },
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      silenciadoEm: new Date(),
      silenciadoAte: opcoes.ate,
      silenciadoPor: opcoes.porQuem,
      silenciadoMotivo: opcoes.motivo,
    },
  });
}

/** Tira o silenciamento. Zera os quatro campos. */
export async function tirarSilenciamento(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      silenciadoEm: null,
      silenciadoAte: null,
      silenciadoPor: null,
      silenciadoMotivo: null,
    },
  });
}
