"use server";

import { signSocketTicket } from "@aether/access";
import { requireUser } from "@/server/guards";

/**
 * Emite um ticket para abrir o WebSocket.
 *
 * O cliente pede isto ANTES de conectar. Em producao o gateway vive em outro
 * dominio, e o navegador nao envia o cookie de sessao para outro site — o
 * ticket e o que atravessa essa fronteira sem afrouxar o cookie.
 *
 * A autorizacao continua sendo a de sempre: requireUser() exige sessao valida,
 * e o gateway ainda revalida a linha `Session` no banco quando o ticket chega.
 * O ticket nao concede nada por si — ele apenas prova, por alguns minutos, que
 * quem pediu tinha uma sessao viva.
 */
export async function createSocketTicketAction(): Promise<string | null> {
  try {
    const session = await requireUser();
    return await signSocketTicket({
      sid: session.sessionId,
      sub: session.user.id,
    });
  } catch {
    // Sem sessao nao ha ticket. O cliente trata como "nao conectar".
    return null;
  }
}
