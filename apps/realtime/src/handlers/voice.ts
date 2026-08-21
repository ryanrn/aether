import { prisma } from "@aether/db";
import { getChannelPermissions, loadMemberAccess } from "@aether/access";
import { has, room } from "@aether/shared";
import type { AetherServer, AetherSocket } from "../types";
import { createRateLimiter } from "../rate-limit";
import { createMediaCredentials } from "../livekit";
import {
  countInChannel,
  joinVoice,
  leaveVoice,
  setVoiceFlags,
  setVoiceSpeaking,
  setVoiceStreaming,
  voiceDeparture,
  voiceLocation,
  voiceParticipant,
  voiceOfServer,
} from "../state";

/**
 * Ocupacao de canal de voz — quem esta em qual call.
 *
 * A MIDIA NAO PASSA POR AQUI. O audio trafega entre o navegador e o SFU
 * (LiveKit); este handler e a fonte de verdade de QUEM ocupa qual canal e o
 * emissor do token que da acesso a sala de midia correspondente.
 *
 * Separar assim tem uma consequencia boa: o gateway nao vira gargalo de banda,
 * e a autorizacao continua num lugar so — o token carrega, assinada, a decisao
 * que o @aether/access tomou.
 *
 * Uma pessoa ocupa no maximo um canal por vez: entrar em outro move.
 */

/**
 * O cliente so deve emitir na transicao fala/silencio, mas cliente e coisa que
 * se pode reescrever. Um limitador generoso corta o abuso sem atrapalhar quem
 * fala normalmente.
 */
const speakingLimiter = createRateLimiter({ capacity: 12, refillPerSecond: 6 });

export function registerVoiceHandlers(
  io: AetherServer,
  socket: AetherSocket,
): void {
  const { userId, user } = socket.data;

  /** Publica a mudanca para o servidor inteiro — a arvore de canais e comum a todos. */
  function broadcast(serverId: string, participant: ReturnType<typeof voiceDeparture>) {
    io.to(room.server(serverId)).emit("voice:update", {
      serverId,
      participant,
    });
  }

  socket.on("voice:join", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;
    const channelId = payload?.channelId;

    if (typeof channelId !== "string" || channelId.length === 0) {
      respond({ ok: false, error: "Canal invalido" });
      return;
    }

    try {
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { serverId: true, type: true, userLimit: true },
      });
      if (!channel || channel.type !== "VOICE") {
        respond({ ok: false, error: "Canal nao encontrado" });
        return;
      }

      const access = await loadMemberAccess(channel.serverId, userId);
      if (!access) {
        // Mesma politica do resto do sistema: nao revelamos o que existe.
        respond({ ok: false, error: "Canal nao encontrado" });
        return;
      }

      const bits = await getChannelPermissions(access, channelId);
      if (bits === null || !has(bits, "VIEW_CHANNEL")) {
        respond({ ok: false, error: "Canal nao encontrado" });
        return;
      }
      if (!has(bits, "CONNECT")) {
        respond({ ok: false, error: "Seu cargo nao permite conectar aqui" });
        return;
      }

      // O limite so vale para quem esta entrando de fora: trocar de aba dentro
      // do mesmo canal nao pode ser bloqueado pelo proprio ocupante.
      const current = voiceParticipant(userId);
      if (
        channel.userLimit !== null &&
        current?.channelId !== channelId &&
        countInChannel(channelId) >= channel.userLimit
      ) {
        respond({ ok: false, error: "Canal cheio" });
        return;
      }

      const { previousServerId } = joinVoice({
        socketId: socket.id,
        userId,
        user,
        serverId: channel.serverId,
        channelId,
      });

      // Trocou de servidor: quem ficou para tras precisa ver a saida.
      if (previousServerId) {
        broadcast(previousServerId, voiceDeparture(userId, user));
      }

      const participant = voiceParticipant(userId);
      if (participant) broadcast(channel.serverId, participant);

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

      respond({
        ok: true,
        participants: voiceOfServer(channel.serverId),
        media,
      });
    } catch (error) {
      console.error("[gateway] voice:join falhou:", error);
      respond({ ok: false, error: "Falha ao conectar" });
    }
  });

  socket.on("voice:leave", () => {
    const left = leaveVoice(userId);
    if (left) broadcast(left.serverId, voiceDeparture(userId, left.user));
  });

  socket.on("voice:state", (patch) => {
    if (!patch || typeof patch !== "object") return;
    const updated = setVoiceFlags(userId, {
      selfMuted:
        typeof patch.selfMuted === "boolean" ? patch.selfMuted : undefined,
      selfDeafened:
        typeof patch.selfDeafened === "boolean"
          ? patch.selfDeafened
          : undefined,
    });
    if (updated) broadcast(updated.serverId, updated.participant);
  });

  socket.on("voice:speaking", (speaking) => {
    if (typeof speaking !== "boolean") return;
    if (!speakingLimiter.take(socket.id)) return;

    // Devolve null quando o estado ja era esse — nao republicamos valor
    // identico para a sala inteira.
    const updated = setVoiceSpeaking(userId, speaking);
    if (updated) broadcast(updated.serverId, updated.participant);
  });

  socket.on("voice:streaming", async (streaming) => {
    if (typeof streaming !== "boolean") return;

    const location = voiceLocation(userId);
    if (!location) return;

    /**
     * Ligar o indicador exige SCREEN_SHARE de verdade.
     *
     * O token do SFU ja impede publicar a track sem essa permissao, entao
     * ninguem transmite de fato. Mas o indicador e outra coisa: sem checar,
     * um cliente reescrito poderia se anunciar "transmitindo" para o servidor
     * inteiro. Interface que mente e bug, mesmo sem dado vazando.
     *
     * Desligar nunca precisa de permissao — parar de transmitir e sempre
     * legitimo, e exigir permissao para parar deixaria alguem preso ao
     * indicador aceso apos perder o cargo.
     */
    if (streaming) {
      try {
        const access = await loadMemberAccess(location.serverId, userId);
        const bits = access
          ? await getChannelPermissions(access, location.channelId)
          : null;
        if (bits === null || !has(bits, "SCREEN_SHARE")) return;
      } catch (error) {
        console.error("[gateway] voice:streaming falhou:", error);
        return;
      }
    }

    const updated = setVoiceStreaming(userId, streaming);
    if (updated) broadcast(updated.serverId, updated.participant);
  });

  socket.on("disconnect", () => {
    speakingLimiter.forget(socket.id);
    // So derruba a voz se foi ESTE socket que entrou nela: outras abas da
    // mesma pessoa nao devem tirar ninguem da call.
    const left = leaveVoice(userId, socket.id);
    if (left) broadcast(left.serverId, voiceDeparture(userId, left.user));
  });
}
