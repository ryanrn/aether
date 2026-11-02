import { prisma } from "@aether/db";
import {
  room,
  SELECT_USUARIO_PUBLICO,
  toPublicUser,
  type ConviteAck,
  type ConviteDeJogo,
} from "@aether/shared";
import { log } from "@aether/shared/log";
import type { AetherServer, AetherSocket } from "../types";
import { createRateLimiter } from "../rate-limit";
import { armazemDeConvites } from "../convites/armazem";
import {
  cancelarConvite,
  enviarConvite,
  listarConvites,
  responderConvite,
  vencerSePreciso,
  type DependenciasDeConvite,
} from "../convites/convites";
import { friendsOf, isConnected, presenceEntryOf, statusOf } from "../state";

/**
 * Convites para jogos — a porta de socket das regras em `convites/convites.ts`.
 *
 * Aqui mora o que e de transporte: limite de ritmo, avisar as DUAS salas
 * pessoais a cada mudanca e o timer de expiracao. O limite de envio e o freio
 * de spam de verdade: cada convite vira uma notificacao na tela de outra
 * pessoa, e 6 de rajada com 1 a cada 10 s cobre qualquer uso honesto.
 */
const enviarLimiter = createRateLimiter({ capacity: 6, refillPerSecond: 0.1 });
const agirLimiter = createRateLimiter({ capacity: 20, refillPerSecond: 2 });
const listarLimiter = createRateLimiter({ capacity: 6, refillPerSecond: 0.2 });

const deps: DependenciasDeConvite = {
  armazem: armazemDeConvites,
  friendsOf,
  isConnected,
  presenceEntryOf,
  statusOf,
  async usuarioPublico(userId) {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: SELECT_USUARIO_PUBLICO,
    });
    return row ? toPublicUser(row) : null;
  },
};

function avisar(io: AetherServer, convite: ConviteDeJogo): void {
  io.to([room.user(convite.de.id), room.user(convite.para.id)]).emit(
    "game-invite:update",
    { convite },
  );
}

/**
 * Expira na hora certa, nesta instancia. Se o gateway reiniciar antes, a
 * leitura seguinte (`vencerSePreciso`) faz o mesmo — o timer so adianta o
 * aviso. `unref` para um timer de 5 min nao segurar o processo no desligamento.
 */
function agendarExpiracao(io: AetherServer, convite: ConviteDeJogo): void {
  const ms = new Date(convite.expiraEm).getTime() - Date.now() + 250;
  setTimeout(() => {
    void (async () => {
      const atual = await armazemDeConvites.buscar(convite.id);
      if (!atual) return;
      const r = await vencerSePreciso(deps, atual);
      if (r.mudou) avisar(io, r.convite);
    })().catch((erro) =>
      log.warn("gateway.convites.expirar", "não expirei o convite", { err: erro, id: convite.id }),
    );
  }, Math.max(0, ms)).unref?.();
}

export function registerConviteHandlers(io: AetherServer, socket: AetherSocket): void {
  const { userId } = socket.data;

  /** Erro inesperado vira recusa generica — o cliente sempre recebe um ack. */
  async function seguro(
    nome: string,
    respond: (r: ConviteAck) => void,
    fn: () => Promise<ConviteAck>,
  ): Promise<ConviteAck | null> {
    try {
      const r = await fn();
      respond(r);
      return r;
    } catch (erro) {
      log.error(`gateway.convites.${nome}`, `game-invite:${nome} falhou`, { err: erro, userId });
      respond({ ok: false, codigo: "invalido", error: "Nao deu para concluir agora." });
      return null;
    }
  }

  socket.on("game-invite:send", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;
    if (!enviarLimiter.take(userId)) {
      respond({ ok: false, codigo: "ritmo", error: "Espere um pouco antes de convidar de novo." });
      return;
    }
    let novo = false;
    const r = await seguro("send", respond, async () => {
      const resultado = await enviarConvite(deps, socket.data.user, payload);
      novo = resultado.novo;
      return resultado.resposta;
    });
    // So convite NOVO avisa e agenda; o repetido volta no ack e pronto.
    if (r?.ok && novo) {
      avisar(io, r.convite);
      agendarExpiracao(io, r.convite);
    }
  });

  socket.on("game-invite:respond", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;
    if (!agirLimiter.take(userId)) {
      respond({ ok: false, codigo: "ritmo", error: "Devagar — tente de novo." });
      return;
    }
    const r = await seguro("respond", respond, () => responderConvite(deps, userId, payload));
    if (r?.ok) avisar(io, r.convite);
  });

  socket.on("game-invite:cancel", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;
    if (!agirLimiter.take(userId)) {
      respond({ ok: false, codigo: "ritmo", error: "Devagar — tente de novo." });
      return;
    }
    const r = await seguro("cancel", respond, () => cancelarConvite(deps, userId, payload));
    if (r?.ok) avisar(io, r.convite);
  });

  socket.on("game-invite:list", async (ack) => {
    if (typeof ack !== "function") return;
    if (!listarLimiter.take(userId)) return;
    try {
      const { convites, vencidos } = await listarConvites(deps, userId);
      // Quem venceu nesta leitura: o outro lado tambem precisa saber.
      for (const c of vencidos) avisar(io, c);
      const meuJogo = (await presenceEntryOf(userId))?.game ?? null;
      ack({ convites, meuJogo });
    } catch (erro) {
      log.warn("gateway.convites.list", "game-invite:list falhou", { err: erro, userId });
    }
  });
}
