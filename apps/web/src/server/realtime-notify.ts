import "server-only";

import { log } from "@aether/shared/log";
import type { SendMessageAck } from "@aether/shared";

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
      log.warn("web.gateway_notify.recusado", "gateway recusou o aviso", {
        aviso: errorLabel,
        status: response.status,
        corpo: await response.text().catch(() => ""),
      });
    }
  } catch (error) {
    log.warn("web.gateway_notify.falhou", "não avisei o gateway", {
      err: error,
      aviso: errorLabel,
    });
  }
}

/**
 * Publica uma mensagem PELO gateway, no lugar de um ator.
 *
 * Hoje so a REST v1 de bots (`POST /api/v1/channels/:id/messages`): ela roda
 * na Vercel, sem o `io` do gateway, e o gateway continua sendo o unico que
 * escreve mensagem. Diferente dos outros avisos, esta chamada LE a resposta —
 * precisa da mensagem criada (ou do motivo da recusa).
 *
 * Devolve `null` quando o gateway nao respondeu — a rota traduz em `503`.
 */
export async function enviarMensagemPeloGateway(params: {
  atorUserId: string;
  conversationId: string;
  content: string;
  replyToId?: string;
}): Promise<SendMessageAck | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;

  try {
    const response = await fetch(`${GATEWAY_URL}/internal/send-message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aether-internal": secret,
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      log.warn("web.gateway_notify.send_message", "gateway recusou o envio", {
        status: response.status,
      });
      return null;
    }
    return (await response.json()) as SendMessageAck;
  } catch (error) {
    log.warn("web.gateway_notify.send_message", "nao publiquei a mensagem", {
      err: error,
    });
    return null;
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
 * Avisa o gateway que um servidor inteiro foi excluido, para tirar todo
 * mundo das salas dele de uma vez.
 *
 * PRECISA SER CHAMADO ANTES de `prisma.server.delete`: o gateway consulta os
 * canais do servidor para saber de quais salas tirar cada socket, e depois do
 * cascade essa consulta voltaria vazia. `userIds` vem de quem chama porque,
 * pelo mesmo motivo, ler os membros tambem precisa acontecer antes.
 */
export async function notifyServerDeleted(params: {
  serverId: string;
  userIds: string[];
}): Promise<void> {
  if (params.userIds.length === 0) return;
  await callInternal(
    "/internal/server-deleted",
    params,
    "a exclusao do servidor",
  );
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
  await callInternal(
    "/internal/friends-changed",
    params,
    "a mudanca de amizade",
  );
}

/**
 * Avisa o gateway que a pessoa mudou o proprio perfil (foto, moldura, nome de
 * exibicao).
 *
 * Necessario porque o gateway congela o `PublicUser` de cada um no handshake e
 * grava uma copia dele na ocupacao de voz — sem este aviso, a foto nova so
 * apareceria no card de voz depois de reconectar o socket, e nem "sair e
 * entrar na call" resolvia. O `revalidatePath` da action so alcanca a propria
 * sessao; isto alcanca quem esta na call e os amigos.
 */
export async function notifyProfileChanged(params: {
  userId: string;
}): Promise<void> {
  await callInternal(
    "/internal/profile-changed",
    params,
    "a mudanca de perfil",
  );
}

/**
 * Derruba TODOS os sockets de um usuario no gateway.
 *
 * Usado ao silenciar globalmente: as sessoes ja foram revogadas, mas o
 * `socket.data` do gateway congela no handshake — sem isto a pessoa continuaria
 * mandando mensagem pelo socket ja aberto ate ele cair sozinho. Depois de
 * desconectar, a proxima conexao refaz o handshake e ja pega o silenciamento
 * (a sessao revogada tambem impede reconectar sem novo login).
 */
export async function desconectarUsuarioDoGateway(
  userId: string,
): Promise<void> {
  await callInternal(
    "/internal/desconectar-usuario",
    { userId },
    "a desconexao do usuario",
  );
}

/**
 * Quantos estao online agora em cada servidor.
 *
 * A UNICA chamada interna que LE resposta — as outras avisam e esquecem. A
 * diferenca de forma tem razao: as outras notificam algo que ja aconteceu no
 * banco, e o banco e a fonte de verdade; esta pergunta algo que SO existe na
 * memoria do gateway, e sem a resposta nao ha de onde tirar o numero.
 *
 * Devolve `null` — e nao um mapa de zeros — quando o gateway nao responde.
 * "Ninguem online" e "nao sei" nao sao a mesma coisa: mostrar zero afirmaria
 * algo falso sobre uma comunidade cheia, e a tela precisa poder omitir o
 * numero em vez de mentir.
 *
 * Tempo limite curto: uma vitrine que demora nao vale mais do que uma vitrine
 * sem o contador de online.
 */
export async function presencaDeServidores(
  serverIds: string[],
): Promise<Record<string, number> | null> {
  if (serverIds.length === 0) return {};

  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;

  try {
    const response = await fetch(
      `${GATEWAY_URL}/internal/presenca-de-servidores`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-aether-internal": secret,
        },
        body: JSON.stringify({ serverIds }),
        signal: AbortSignal.timeout(2000),
      },
    );
    if (!response.ok) return null;
    const corpo = (await response.json()) as {
      online?: Record<string, number>;
    };
    return corpo.online ?? null;
  } catch {
    // Gateway fora do ar ou lento: a vitrine sai sem o contador de online.
    return null;
  }
}

/**
 * Quantas pessoas ocupam agora cada canal de voz da lista.
 *
 * Mesma forma do `presencaDeServidores` e pelo mesmo motivo: a tela de Grupos
 * monta a lista de salas pelo banco, mas quem esta dentro de cada uma so o
 * gateway sabe. Devolve `null` (nao um mapa de zeros) quando o gateway nao
 * responde — a tela mostra as salas sem o contador em vez de dizer "vazia".
 */
export async function ocupacaoDeCanais(
  channelIds: string[],
): Promise<Record<string, number> | null> {
  if (channelIds.length === 0) return {};

  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;

  try {
    const response = await fetch(`${GATEWAY_URL}/internal/ocupacao-de-canais`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aether-internal": secret,
      },
      body: JSON.stringify({ channelIds }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const corpo = (await response.json()) as {
      ocupacao?: Record<string, number>;
    };
    return corpo.ocupacao ?? null;
  } catch {
    return null;
  }
}
