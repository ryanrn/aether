import { prisma } from "@aether/db";
import { log } from "@aether/shared/log";
import type { AetherServer } from "../types";
import { resyncEavisarServidor } from "../rooms";
import { countInChannel } from "../state";

/**
 * Salas de voz efemeras (fase 2, estagio 3).
 *
 * `Channel.isTemporary` era so um selo — nada apagava o canal. Agora o gateway
 * apaga quando a sala esvazia. A fonte de verdade da ocupacao e a MEMORIA do
 * gateway (`countInChannel`), nao o banco: quem esta na call so existe aqui.
 *
 * Dois caminhos, um por evento e um por varredura, porque nenhum sozinho
 * cobre tudo:
 *  - por evento (`talvezRemoverSalaEfemera`) pega o caso comum — a ultima
 *    pessoa saiu;
 *  - a varredura pega o resto — sala criada e ninguem entrou, ou gateway
 *    reiniciado (a ocupacao em memoria zera no restart e nao ha `leaveVoice`).
 */

/**
 * Carencia entre criar a sala e alguem entrar. Abaixo disto a sala vazia NAO e
 * apagada — senao a sala recem-criada morreria no intervalo entre o
 * `channel.create` e o `voice:join` do criador.
 */
export const CARENCIA_SALA_EFEMERA_MS = 30_000;

/**
 * Chamado depois de alguem SAIR de um canal de voz. Se o canal era uma sala
 * efemera e ficou vazio (passada a carencia), apaga e re-sincroniza o servidor.
 *
 * `channelId` pode ser de canal comum — a consulta filtra por `isTemporary`.
 * Silencioso em erro: a varredura pega a sala vazia depois.
 */
export async function talvezRemoverSalaEfemera(
  io: AetherServer,
  channelId: string | null | undefined,
): Promise<void> {
  if (!channelId) return;
  try {
    if ((await countInChannel(channelId)) > 0) return;

    const canal = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true, isTemporary: true, createdAt: true },
    });
    if (!canal?.isTemporary) return;
    if (Date.now() - canal.createdAt.getTime() < CARENCIA_SALA_EFEMERA_MS) {
      return;
    }

    // Corrida: alguem pode ter entrado entre o primeiro count e agora.
    if ((await countInChannel(channelId)) > 0) return;

    await prisma.channel.delete({ where: { id: channelId } });
    await resyncEavisarServidor(io, canal.serverId);
    log.info("gateway.sala_efemera.removida", "sala efemera vazia removida", {
      channelId,
      serverId: canal.serverId,
    });
  } catch (erro) {
    log.warn("gateway.sala_efemera.falhou", "não removi a sala efemera", {
      err: erro,
      channelId,
    });
  }
}

/**
 * Varredura periodica das salas efemeras. Chamada por `setInterval` no
 * `index.ts`. So apaga sala mais velha que a carencia E com ocupacao zero
 * AGORA (na memoria deste gateway — com varias instancias, `countInChannel`
 * ja consulta todas via Redis).
 */
export async function varrerSalasEfemeras(io: AetherServer): Promise<void> {
  try {
    const limite = new Date(Date.now() - CARENCIA_SALA_EFEMERA_MS);
    const efemeras = await prisma.channel.findMany({
      where: { isTemporary: true, createdAt: { lt: limite } },
      select: { id: true, serverId: true },
    });
    if (efemeras.length === 0) return;

    const servidoresMexidos = new Set<string>();
    for (const canal of efemeras) {
      if ((await countInChannel(canal.id)) > 0) continue;
      try {
        await prisma.channel.delete({ where: { id: canal.id } });
        servidoresMexidos.add(canal.serverId);
      } catch (erro) {
        // Ja apagada por outro caminho — nada a fazer.
        log.warn("gateway.sala_efemera.varredura_item", "não apaguei uma sala", {
          err: erro,
          channelId: canal.id,
        });
      }
    }

    for (const serverId of servidoresMexidos) {
      await resyncEavisarServidor(io, serverId);
    }
    if (servidoresMexidos.size > 0) {
      log.info("gateway.sala_efemera.varredura", "varredura de salas efemeras", {
        candidatas: efemeras.length,
        servidores: servidoresMexidos.size,
      });
    }
  } catch (erro) {
    log.warn(
      "gateway.sala_efemera.varredura_falhou",
      "varredura de salas efemeras falhou",
      { err: erro },
    );
  }
}
