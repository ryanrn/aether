import "server-only";

/**
 * Avisos do app web para o gateway.
 *
 * Existe por um motivo de seguranca, nao de conveniencia: o socket entra nas
 * salas de um servidor quando a pessoa entra nele e nunca recalcula sozinho.
 * Duas situacoes, duas funcoes: `evictFromGateway` para quando a pessoa
 * DEIXOU de ser membro, `resyncGatewayRooms` para quando ela continua membro
 * mas o que pode VER mudou.
 *
 * Autenticado pelo AUTH_SECRET que os dois lados ja compartilham para validar
 * sessao. Nunca chamado pelo navegador: este modulo e `server-only`.
 */

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000";

/**
 * POST para uma rota interna do gateway. Falha de proposito de forma
 * silenciosa (so registrando): a mudanca que motivou a chamada ja aconteceu
 * no banco, que e a fonte de verdade. Se o gateway estiver fora do ar, quem
 * foi afetado sente o efeito assim que reconectar — degradar assim e melhor
 * do que desfazer uma acao ja concluida esperando o gateway responder.
 */
async function callInternal(
  path: string,
  params: Record<string, unknown>,
  errorLabel: string,
): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return;

  try {
    const response = await fetch(`${GATEWAY_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aether-internal": secret,
      },
      body: JSON.stringify(params),
      // Nenhuma acao pode ficar pendurada esperando o gateway.
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      console.error(
        `[realtime] gateway recusou ${errorLabel}:`,
        response.status,
        await response.text().catch(() => ""),
      );
    }
  } catch (error) {
    console.error(`[realtime] nao consegui avisar o gateway (${errorLabel}):`, error);
  }
}

/** Remove o usuario das salas do servidor no gateway (expulsao, banimento, saida). */
export async function evictFromGateway(params: {
  serverId: string;
  userId: string;
}): Promise<void> {
  await callInternal("/internal/evict", params, "o despejo");
}

/**
 * Pede ao gateway para recalcular as salas de canal de todo mundo presente
 * no servidor.
 *
 * Chamar depois de qualquer mudanca que altere o que alguem PODE VER sem
 * tira-lo do servidor: cargo editado ou excluido, cargo atribuido/removido de
 * um membro, canal virando privado, ou o acesso de um canal privado mudando.
 * Sem isto, quem perdeu VIEW_CHANNEL de um canal continuaria recebendo as
 * mensagens dele ate reconectar.
 */
export async function resyncGatewayRooms(params: {
  serverId: string;
}): Promise<void> {
  await callInternal("/internal/resync-rooms", params, "o recalculo de salas");
}

/**
 * Avisa o gateway que a lista de amizades destas pessoas mudou.
 *
 * Necessario porque o gateway guarda os amigos EM MEMORIA — sem isso, aceitar
 * um pedido so passaria a valer na proxima vez que os dois reconectassem, e a
 * pessoa recem-aceita ficaria offline na tela do amigo por horas.
 *
 * Sempre com os DOIS lados: amizade e simetrica, e atualizar so quem clicou
 * deixaria o outro com a lista velha.
 */
export async function notifyFriendsChanged(params: {
  userIds: string[];
}): Promise<void> {
  await callInternal("/internal/friends-changed", params, "a mudanca de amizade");
}
