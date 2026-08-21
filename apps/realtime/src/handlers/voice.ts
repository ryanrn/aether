import { prisma } from "@aether/db";
import { getChannelPermissions, loadMemberAccess } from "@aether/access";
import { has, room } from "@aether/shared";
import type { AetherServer, AetherSocket } from "../types";
import {
  countInChannel,
  joinVoice,
  leaveVoice,
  setVoiceFlags,
  voiceDeparture,
  voiceParticipant,
  voiceOfServer,
} from "../state";

/**
 * Ocupacao de canal de voz — quem esta em qual call.
 *
 * SEM MIDIA. Nao existe audio aqui: nenhum getUserMedia, nenhum WebRTC,
 * nenhuma faixa. O que este handler faz e ser a FONTE DE VERDADE de quem
 * ocupa qual canal, que e o dado do qual a fase 4 vai depender para saber a
 * quem conectar. O efeito visivel hoje e o nome da pessoa aparecendo sob o
 * canal para todos os membros do servidor.
 *
 * Uma pessoa ocupa no maximo um canal por vez: entrar em outro move.
 */

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

      respond({ ok: true, participants: voiceOfServer(channel.serverId) });
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

  socket.on("disconnect", () => {
    // So derruba a voz se foi ESTE socket que entrou nela: outras abas da
    // mesma pessoa nao devem tirar ninguem da call.
    const left = leaveVoice(userId, socket.id);
    if (left) broadcast(left.serverId, voiceDeparture(userId, left.user));
  });
}
