import "server-only";

/**
 * Avisos do app web para o gateway.
 *
 * Existe por um motivo de seguranca, nao de conveniencia: o socket entra nas
 * salas de um servidor quando a pessoa entra nele e nunca recalcula. Ao
 * expulsar ou banir alguem, apagar a linha no banco nao tira o socket da sala
 * — a pessoa continuaria recebendo o chat ate recarregar a pagina.
 *
 * Autenticado pelo AUTH_SECRET que os dois lados ja compartilham para validar
 * sessao. Nunca chamado pelo navegador: este modulo e `server-only`.
 */

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000";

/**
 * Remove o usuario das salas do servidor no gateway.
 *
 * Falha de propósito de forma silenciosa (apenas registrando): a expulsao ja
 * aconteceu no banco, que e a fonte de verdade. Se o gateway estiver fora do
 * ar, a pessoa perde o acesso assim que recarregar — degradar assim e melhor
 * do que desfazer uma acao de moderacao ja concluida.
 */
export async function evictFromGateway(params: {
  serverId: string;
  userId: string;
}): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return;

  try {
    const response = await fetch(`${GATEWAY_URL}/internal/evict`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aether-internal": secret,
      },
      body: JSON.stringify(params),
      // Moderacao nao pode ficar pendurada esperando o gateway.
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      console.error(
        "[realtime] gateway recusou o despejo:",
        response.status,
        await response.text().catch(() => ""),
      );
    }
  } catch (error) {
    console.error("[realtime] nao consegui avisar o gateway:", error);
  }
}
