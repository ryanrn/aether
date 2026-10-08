import { prisma } from "@aether/db";
import {
  flagLigada,
  loadDmAccess,
  loadPlan,
  participanteDaDm,
} from "@aether/access";
import {
  SELECT_USUARIO_PUBLICO,
  room,
  toPublicUser,
  type DmCallAck,
  type MotivoFimDeChamada,
} from "@aether/shared";
import { log } from "@aether/shared/log";
import type { AetherServer, AetherSocket } from "../types";
import { createRateLimiter } from "../rate-limit";
import {
  conferirQualidadeDaTela,
  createDmCallCredentials,
  dmRoomName,
} from "../livekit";

/**
 * Chamada de voz numa conversa direta: tocar, atender, encerrar.
 *
 * SEM ESTADO AQUI, de proposito. O gateway so repassa avisos entre as salas
 * pessoais dos dois e emite o token da sala `dm:<dmId>` do SFU. Quem esta DE
 * FATO na chamada e o proprio SFU; quem esta "chamando" ou "recebendo" e a
 * tela de cada um. Um mapa de chamadas ativas aqui teria de existir nas duas
 * implementacoes do `StateStore` (memoria e Redis), sobreviver a restart e
 * concordar entre instancias — tudo para guardar algo que o SFU ja sabe.
 *
 * O preco: o gateway nao sabe dizer "fulano esta ocupado" nem derrubar uma
 * chamada sozinho. Os dois foram para o cliente (recusa automatica com
 * `ocupado`; fim por ausencia do outro na sala de midia) e estao nas
 * limitacoes do README.
 *
 * A AUTORIZACAO e a das mensagens: `loadDmAccess` — voce e um dos dois e
 * `podeFalarCom` ainda deixa (bloqueio, amizade, servidor em comum). Rechecada
 * em tocar, atender e renovar token. Encerrar usa so `participanteDaDm`: fechar
 * uma chamada nunca pode depender de a porta ainda estar aberta.
 */

/**
 * Tocar e atender EMITEM TOKEN de midia — sem limite, um laco de `dmcall:ring`
 * e uma fabrica de credenciais e uma campainha infinita no outro lado. 4 de
 * rajada cobre ligar, desistir e ligar de novo; 1 a cada 3s em regime.
 */
const tocarLimiter = createRateLimiter({ capacity: 4, refillPerSecond: 1 / 3 });

/** Encerrar e renovar sao baratos, mas ainda fazem consulta ao banco. */
const sinalLimiter = createRateLimiter({ capacity: 10, refillPerSecond: 2 });

const MOTIVOS: readonly MotivoFimDeChamada[] = [
  "recusada",
  "ocupado",
  "sem_resposta",
  "cancelada",
  "encerrada",
];

function ehMotivo(valor: unknown): valor is MotivoFimDeChamada {
  return MOTIVOS.includes(valor as MotivoFimDeChamada);
}

/**
 * Pode abrir midia nesta conversa? Devolve o id do outro lado, ou a recusa
 * pronta para o ack.
 *
 * Recusa de acesso diz "Conversa nao encontrada" — a mesma politica de 404 do
 * resto do sistema: conversa alheia e inexistente sao indistinguiveis.
 */
async function autorizar(
  userId: string,
  dmId: unknown,
): Promise<{ ok: true; outroId: string } | { ok: false; error: string }> {
  if (typeof dmId !== "string" || dmId.length === 0) {
    return { ok: false, error: "Conversa nao encontrada" };
  }
  if (!(await flagLigada("voz_habilitada"))) {
    return { ok: false, error: "A voz esta temporariamente indisponivel." };
  }
  const acesso = await loadDmAccess(userId, dmId);
  if (!acesso) return { ok: false, error: "Conversa nao encontrada" };
  return { ok: true, outroId: acesso.outroId };
}

export function registerDmCallHandlers(
  io: AetherServer,
  socket: AetherSocket,
): void {
  const { userId } = socket.data;

  async function credenciais(dmId: string): Promise<DmCallAck> {
    const media = await createDmCallCredentials({
      dmId,
      userId,
      displayName: socket.data.user.displayName,
    });
    // Sem SFU configurado nao ha chamada: tocar o telefone do outro para uma
    // ligacao muda seria prometer o que nao entrega.
    if (!media) {
      return { ok: false, error: "Chamadas de voz indisponiveis neste servidor." };
    }
    return { ok: true, media };
  }

  socket.on("dmcall:ring", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    if (!tocarLimiter.take(userId)) {
      respond({ ok: false, error: "Espere um instante para ligar de novo." });
      return;
    }

    try {
      const auth = await autorizar(userId, payload?.dmId);
      if (!auth.ok) {
        respond(auth);
        return;
      }
      const dmId = payload.dmId;

      const resultado = await credenciais(dmId);
      if (!resultado.ok) {
        respond(resultado);
        return;
      }

      /**
       * O cartao de quem liga sai do BANCO, pelo serializador, e nao de
       * `socket.data.user`: e ele que resolve moldura e avatar animado contra
       * o plano vigente. O do socket congelou no handshake.
       */
      const eu = await prisma.user.findUnique({
        where: { id: userId },
        select: SELECT_USUARIO_PUBLICO,
      });
      if (!eu) {
        respond({ ok: false, error: "Conversa nao encontrada" });
        return;
      }

      io.to(room.user(auth.outroId)).emit("dmcall:incoming", {
        dmId,
        de: toPublicUser(eu),
      });
      respond(resultado);
    } catch (error) {
      log.error("gateway.dmcall.ring", "dmcall:ring falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao iniciar a chamada" });
    }
  });

  socket.on("dmcall:accept", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    if (!tocarLimiter.take(userId)) {
      respond({ ok: false, error: "Espere um instante." });
      return;
    }

    try {
      const auth = await autorizar(userId, payload?.dmId);
      if (!auth.ok) {
        respond(auth);
        return;
      }
      const dmId = payload.dmId;

      const resultado = await credenciais(dmId);
      if (!resultado.ok) {
        respond(resultado);
        return;
      }

      /**
       * Para os DOIS: quem ligou passa a "em chamada"; as OUTRAS abas de quem
       * atendeu param de tocar. A aba que atendeu ja esta em chamada quando o
       * aviso volta e ignora o proprio eco.
       */
      io.to([room.user(userId), room.user(auth.outroId)]).emit(
        "dmcall:accepted",
        { dmId, por: userId },
      );
      respond(resultado);
    } catch (error) {
      log.error("gateway.dmcall.accept", "dmcall:accept falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao atender a chamada" });
    }
  });

  socket.on("dmcall:end", async (payload) => {
    const dmId = payload?.dmId;
    const motivo = payload?.motivo;
    if (typeof dmId !== "string" || !ehMotivo(motivo)) return;
    if (!sinalLimiter.take(userId)) return;

    try {
      const participante = await participanteDaDm(userId, dmId);
      if (!participante) return;

      io.to([room.user(userId), room.user(participante.outroId)]).emit(
        "dmcall:ended",
        { dmId, por: userId, motivo },
      );
    } catch (error) {
      log.error("gateway.dmcall.end", "dmcall:end falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
    }
  });

  /**
   * Confere a tela publicada contra o plano, em segundo plano.
   *
   * Mesma espera escalonada de `voice:streaming`: quando o aviso chega, a
   * faixa quase nunca esta publicada ainda. Para na primeira resposta (dentro
   * ou fora do teto). Silenciar acontece no SFU, entao cliente reescrito que
   * pule o menu de qualidade nao contorna.
   */
  async function conferirTela(dmId: string): Promise<void> {
    const plano = await loadPlan(userId).catch(() => null);
    if (!plano) return;

    for (const espera of [2000, 4000, 8000]) {
      await new Promise((r) => setTimeout(r, espera));
      const excedeu = await conferirQualidadeDaTela({
        sala: dmRoomName(dmId),
        userId,
        alturaMax: plano.limites.alturaMax,
      });
      if (!excedeu) continue;

      log.warn("gateway.dmcall.qualidade_excedida", "tela acima do plano", {
        userId,
        dmId,
        alturaPublicada: excedeu.alturaPublicada,
        alturaMax: excedeu.alturaMax,
        plano: plano.tier,
        silenciada: excedeu.silenciada,
      });
      socket.emit("voice:qualidade-excedida", {
        alturaPublicada: excedeu.alturaPublicada,
        alturaMax: excedeu.alturaMax,
        plano: plano.tier,
      });
      return;
    }
  }

  socket.on("dmcall:tela", async (payload) => {
    if (!sinalLimiter.take(userId)) return;
    try {
      const auth = await autorizar(userId, payload?.dmId);
      if (!auth.ok) return;
      void conferirTela(payload.dmId);
    } catch (error) {
      log.error("gateway.dmcall.tela", "dmcall:tela falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
    }
  });

  socket.on("dmcall:refresh-token", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    if (!sinalLimiter.take(userId)) {
      respond({ ok: false, error: "Espere um instante." });
      return;
    }

    try {
      const auth = await autorizar(userId, payload?.dmId);
      if (!auth.ok) {
        respond(auth);
        return;
      }
      respond(await credenciais(payload.dmId));
    } catch (error) {
      log.error("gateway.dmcall.refresh", "dmcall:refresh-token falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao renovar a chamada" });
    }
  });
}
