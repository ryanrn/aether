import { prisma } from "@aether/db";
import { podeRemoverDaSalaDoHub } from "@aether/access";
import { room } from "@aether/shared";
import { log } from "@aether/shared/log";
import type { AetherServer, AetherSocket } from "../types";
import { createRateLimiter } from "../rate-limit";
import { sairDaVoz } from "../entrar-em-voz";
import { voiceParticipant } from "../state";
import { remocoesDoHub } from "../voz/remocoes-do-hub";

/**
 * Hub global (fase 2, estagio 4b-2) — o criador tira alguem da propria sala.
 *
 * A regra e `podeRemoverDaSalaDoHub` (@aether/access): so quem CRIOU a sala,
 * so numa sala do hub, nunca a si mesmo. O gateway confere o resto: o alvo
 * tem de estar NESTA sala agora (senao "remover" viraria um jeito de barrar
 * alguem de uma sala onde ele nem esta).
 *
 * Efeito: a ocupacao acaba (`sairDaVoz`, a mesma de qualquer saida), o alvo
 * recebe `hub:removido` (o cliente derruba a midia e explica) e fica
 * `HUB_ESPERA_APOS_REMOCAO_MIN` sem voltar AQUELA sala (`entrarNaVoz` confere).
 */

const removerLimiter = createRateLimiter({ capacity: 5, refillPerSecond: 0.5 });

export function registerHubHandlers(io: AetherServer, socket: AetherSocket): void {
  const { userId } = socket.data;

  socket.on("hub:remover", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;
    if (!removerLimiter.take(userId)) {
      respond({ ok: false, error: "Espere um instante." });
      return;
    }
    const channelId = payload?.channelId;
    const alvoId = payload?.userId;
    if (typeof channelId !== "string" || typeof alvoId !== "string") {
      respond({ ok: false, error: "Pedido invalido" });
      return;
    }

    try {
      const canal = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { criadaPor: true, server: { select: { hub: true } } },
      });
      if (
        !canal ||
        !podeRemoverDaSalaDoHub({
          solicitanteId: userId,
          alvoId,
          sala: { hub: canal.server.hub, criadaPor: canal.criadaPor },
        })
      ) {
        // Nao revela se a sala existe nem de quem e.
        respond({ ok: false, error: "Voce nao pode remover ninguem desta sala." });
        return;
      }

      const alvo = await voiceParticipant(alvoId);
      if (alvo?.channelId !== channelId) {
        respond({ ok: false, error: "Essa pessoa nao esta na sua sala." });
        return;
      }

      // O prazo ANTES de tirar: sem isso, o cliente do alvo poderia reentrar
      // (reconexao automatica) na janela entre a saida e o registro.
      await remocoesDoHub.registrar(channelId, alvoId);
      await sairDaVoz(io, { userId: alvoId });
      io.to(room.user(alvoId)).emit("hub:removido", { channelId });

      log.info("gateway.hub.removido", "criador removeu alguem da sala do hub", {
        channelId,
        por: userId,
        alvo: alvoId,
      });
      respond({ ok: true });
    } catch (error) {
      log.error("gateway.hub.remover_falhou", "hub:remover falhou", { err: error });
      respond({ ok: false, error: "Nao consegui remover agora." });
    }
  });
}
