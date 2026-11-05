import { prisma } from "@aether/db";
import {
  flagLigada,
  getChannelPermissions,
  loadBlockedBothWays,
  loadMemberAccess,
} from "@aether/access";
import { has, room, type PublicUser, type VoiceJoinAck } from "@aether/shared";
import type { AetherServer } from "./types";
import { createMediaCredentials } from "./livekit";
import { talvezRemoverSalaEfemera } from "./voz/salas-efemeras";
import { remocoesDoHub } from "./voz/remocoes-do-hub";
import { marcarVozAlterada } from "./voz/voz-de-amigos";
import {
  countInChannel,
  joinVoice,
  leaveVoice,
  voiceDeparture,
  voiceOfServer,
  voiceParticipant,
} from "./state";

/**
 * Entrar/sair de canal de voz — autorizacao, ocupacao e token de midia, num
 * lugar so.
 *
 * Extraido de dentro do handler `voice:join`/`voice:leave` (`handlers/voice.ts`)
 * para o Music Bot experimental entrar pela MESMA porta que o humano usa, via
 * REST (`/internal/voice-token`), sem reimplementar a checagem de permissao
 * nem o registro de ocupacao. `handlers/voice.ts` agora so faz o que e do
 * socket (payload, rate limit, ack) e delega para ca — o mesmo desenho que
 * `enviar-mensagem.ts` ja usa para chat.
 *
 * NAO faz rate limit nem valida o formato do payload — isso e responsabilidade
 * de cada entrada (o handler do socket tem o proprio limitador; a REST de bot
 * usa o limitador do bot). Aqui so mora a REGRA.
 */

/** Por que `entrarNaVoz` recusou — para a REST de bot traduzir em status HTTP. */
export type CodigoDeRecusaDeVoz =
  | "nao_encontrada"
  | "sem_permissao"
  | "cheio"
  | "voz_desligada";

export interface EntradaDeVoz {
  userId: string;
  user: PublicUser;
  channelId: string;
  /**
   * Identificador de ocupacao — `socket.id` para o humano, um id sintetico
   * ("bot:<userId>") para o Music Bot, que nao tem socket nenhum aberto no
   * gateway (ele fala por REST). E o que `leaveVoice(userId, onlyIfSocket)`
   * usa para nao remover a ocupacao errada.
   */
  socketId: string;
  /**
   * Socket a EXCLUIR do aviso de saida do servidor anterior — evita que quem
   * esta se MOVENDO de servidor veja a propria saida e derrube a call que
   * acabou de comecar. So o humano tem isso; o bot passa `undefined`.
   */
  excluirDoAvisoAnterior?: string;
}

/**
 * Entra num canal de voz. Devolve o mesmo formato do ack de `voice:join`
 * (`VoiceJoinAck`, de `@aether/shared`), com `codigo` preenchido nas recusas —
 * o socket ignora o campo, a REST de bot usa para mapear o status HTTP.
 */
export async function entrarNaVoz(
  io: AetherServer,
  entrada: EntradaDeVoz,
): Promise<VoiceJoinAck> {
  const { userId, user, channelId, socketId, excluirDoAvisoAnterior } = entrada;

  /**
   * Kill switch de voz. NAO e retriable: e um estado deliberado, tentar de
   * novo em laco nao ajuda.
   */
  if (!(await flagLigada("voz_habilitada"))) {
    return {
      ok: false,
      error: "A voz esta temporariamente indisponivel.",
      codigo: "voz_desligada",
    };
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      serverId: true,
      type: true,
      userLimit: true,
      server: { select: { hub: true } },
    },
  });
  if (!channel || channel.type !== "VOICE") {
    return { ok: false, error: "Canal nao encontrado", codigo: "nao_encontrada" };
  }

  const access = await loadMemberAccess(channel.serverId, userId);
  if (!access) {
    // Mesma politica do resto do sistema: nao revelamos o que existe.
    return { ok: false, error: "Canal nao encontrado", codigo: "nao_encontrada" };
  }

  const bits = await getChannelPermissions(access, channelId);
  if (bits === null || !has(bits, "VIEW_CHANNEL")) {
    return { ok: false, error: "Canal nao encontrado", codigo: "nao_encontrada" };
  }
  if (!has(bits, "CONNECT")) {
    return {
      ok: false,
      error: "Seu cargo nao permite conectar aqui",
      codigo: "sem_permissao",
    };
  }

  const current = await voiceParticipant(userId);

  /**
   * HUB (fase 2, estagio 4b-2) — duas portas a mais, so nas salas do hub, so
   * para quem entra de fora (quem ja esta dentro nao e barrado ao reconectar).
   *
   *  1. Removido pelo criador ha pouco: espera o prazo (`remocoes-do-hub`).
   *  2. Bloqueio com alguem LA DENTRO, em qualquer direcao. A sala junta
   *     desconhecidos; bloqueio que nao vale na call seria bloqueio de enfeite.
   *     A resposta nao diz QUEM — "indisponivel" so —, para nao revelar quem
   *     te bloqueou nem que a pessoa esta ali.
   *
   * Servidor comum fica como sempre: la quem decide e a moderacao do servidor.
   */
  if (channel.server.hub && current?.channelId !== channelId) {
    const espera = await remocoesDoHub.esperaRestante(channelId, userId);
    if (espera > 0) {
      return {
        ok: false,
        error: `Voce foi removido desta sala. Pode voltar em ${Math.ceil(espera / 60_000)} min.`,
        codigo: "sem_permissao",
      };
    }

    const ocupantes = (await voiceOfServer(channel.serverId))
      .filter((p) => p.channelId === channelId)
      .map((p) => p.userId);
    if (ocupantes.length > 0) {
      const bloqueados = await loadBlockedBothWays(userId);
      if (ocupantes.some((id) => bloqueados.has(id))) {
        return {
          ok: false,
          error: "Esta sala nao esta disponivel para voce.",
          codigo: "sem_permissao",
        };
      }
    }
  }

  // O limite so vale para quem esta entrando de fora: trocar de aba (ou, no
  // bot, pedir de novo) dentro do mesmo canal nao pode ser bloqueado pelo
  // proprio ocupante.
  const canalAnterior = current?.channelId ?? null;
  if (
    channel.userLimit !== null &&
    current?.channelId !== channelId &&
    (await countInChannel(channelId)) >= channel.userLimit
  ) {
    return { ok: false, error: "Canal cheio", codigo: "cheio" };
  }

  const { previousServerId } = await joinVoice({
    socketId,
    userId,
    user,
    serverId: channel.serverId,
    channelId,
  });

  if (previousServerId) {
    const alvo = io.to(room.server(previousServerId));
    (excluirDoAvisoAnterior ? alvo.except(excluirDoAvisoAnterior) : alvo).emit(
      "voice:update",
      { serverId: previousServerId, participant: voiceDeparture(userId, user) },
    );
  }

  const participant = await voiceParticipant(userId);
  if (participant) {
    io.to(room.server(channel.serverId)).emit("voice:update", {
      serverId: channel.serverId,
      participant,
    });
  }

  // Tela Amigos: a call nova (e a saida da antiga, se trocou de servidor).
  marcarVozAlterada(io, channel.serverId, [userId]);
  if (previousServerId && previousServerId !== channel.serverId) {
    marcarVozAlterada(io, previousServerId, [userId]);
  }

  // Saiu de uma sala de grupo para entrar aqui — ela pode ter esvaziado.
  if (canalAnterior && canalAnterior !== channelId) {
    void talvezRemoverSalaEfemera(io, canalAnterior);
  }

  /**
   * O token sai daqui, depois da checagem de permissao que ja foi feita
   * acima. As permissoes viram grants assinados: sem SPEAK o token nao
   * permite publicar microfone, e quem impoe isso passa a ser o SFU.
   */
  const media = await createMediaCredentials({
    channelId,
    userId,
    displayName: user.displayName,
    permissions: bits,
  });

  return { ok: true, participants: await voiceOfServer(channel.serverId), media };
}

/**
 * Sai do canal de voz que ocupa agora. Usado por `voice:leave`, pelo
 * `disconnect` do socket, e pelo `/internal/voice-leave` do Music Bot.
 *
 * Devolve `false` quando nao havia ocupacao a sair (ou ela era de outro
 * socket, com `onlyIfSocket`) — chamar isto sem estar em voz nao e erro.
 */
export async function sairDaVoz(
  io: AetherServer,
  params: { userId: string; onlyIfSocket?: string },
): Promise<boolean> {
  const left = await leaveVoice(params.userId, params.onlyIfSocket);
  if (!left) return false;

  io.to(room.server(left.serverId)).emit("voice:update", {
    serverId: left.serverId,
    participant: voiceDeparture(params.userId, left.user),
  });
  marcarVozAlterada(io, left.serverId, [params.userId]);
  void talvezRemoverSalaEfemera(io, left.channelId);
  return true;
}

/**
 * Tira todo mundo de um canal de voz especifico — usado quando o CANAL em si
 * deixou de existir (excluido pelo dono/admin).
 *
 * Antes disto, apagar um canal de voz so atualizava a arvore de quem via a
 * lista (`resyncServerRooms`, que mexe em salas de ROTEAMENTO de chat, nunca
 * em ocupacao de voz) — quem estava DENTRO da call continuava conectado ao
 * LiveKit e com a ocupacao apontando para um `channelId` que nao existe mais
 * no banco. `sairDaVoz` por pessoa (nao um "apagar ocupacao" em lote) porque e
 * a MESMA funcao que qualquer saida de voz usa — a call encerra do jeito que
 * a pessoa ja reconhece (evento de saida, sala efemera reavaliada), sem uma
 * segunda forma de "desligar voz" so para este caso.
 */
export async function sairDaVozDoCanal(
  io: AetherServer,
  serverId: string,
  channelId: string,
): Promise<void> {
  const participantes = await voiceOfServer(serverId);
  const alvos = participantes.filter((p) => p.channelId === channelId);
  await Promise.all(alvos.map((p) => sairDaVoz(io, { userId: p.userId })));
}
