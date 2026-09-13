import { prisma } from "@aether/db";
import {
  canActOnUser,
  getChannelPermissions,
  loadMemberAccess,
} from "@aether/access";
import { has, room, type VoiceParticipant } from "@aether/shared";
import { log } from "@aether/shared/log";
import { loadPlan } from "@aether/access";
import type { AetherServer, AetherSocket } from "../types";
import { createRateLimiter } from "../rate-limit";
import { talvezRemoverSalaEfemera } from "../voz/salas-efemeras";
import { entrarNaVoz, sairDaVoz } from "../entrar-em-voz";
import {
  applyServerMute,
  conferirQualidadeDaTela,
  createMediaCredentials,
} from "../livekit";
import {
  joinVoice,
  setVoiceFlags,
  setServerVoiceFlags,
  setVoiceSpeaking,
  setVoiceCamera,
  setVoiceStreaming,
  voiceSocketOf,
  voiceLocation,
  voiceParticipant,
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

/**
 * Limite de ENTRADA em canal de voz.
 *
 * `voice:join` e o evento mais caro do gateway: tres idas ao Postgres (canal,
 * acesso do membro, permissoes do canal) e, no fim, a EMISSAO DE UMA
 * CREDENCIAL de midia. Sem limite, um laco de `voice:join` e ao mesmo tempo
 * exaustao de banco e uma fabrica de tokens do SFU — cada resposta devolve um
 * token valido, e nada obriga o cliente a usa-lo para conectar.
 *
 * 5 de rajada cobre trocar de canal algumas vezes seguidas, que e o uso real;
 * 1 por segundo em regime nao atrapalha ninguem que esteja usando o app com a
 * mao.
 */
const joinLimiter = createRateLimiter({ capacity: 5, refillPerSecond: 1 });

/**
 * Limite dos eventos de AUTO-sinalizacao (mudo/surdo proprios, camera,
 * transmitindo) — cada um escreve no StateStore (HSET no Redis) e faz
 * broadcast pra sala do servidor inteira a cada chamada, exatamente como
 * `voice:join`, mas nenhum tinha limite: um cliente reescrito podia emitir em
 * loop apertado sem freio nenhum. Generoso o bastante pra alternar mudo/
 * camera varias vezes seguidas de proposito nao esbarrar nisso.
 */
const autoSinalLimiter = createRateLimiter({ capacity: 10, refillPerSecond: 4 });

/**
 * Limite das acoes de MODERACAO (mutar/ensurdecer/mover/desconectar
 * terceiro). Exigem cargo, entao a superficie de abuso e menor que a
 * auto-sinalizacao — mas "exige cargo" nao e "sem custo": cada chamada ainda
 * faz consultas ao banco (`loadMemberAccess`, `canActOnUser`) e broadcast.
 */
const moderarLimiter = createRateLimiter({ capacity: 8, refillPerSecond: 2 });

export function registerVoiceHandlers(
  io: AetherServer,
  socket: AetherSocket,
): void {
  const { userId, user } = socket.data;

  /** Publica a mudanca para o servidor inteiro — a arvore de canais e comum a todos. */
  function broadcast(serverId: string, participant: VoiceParticipant) {
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

    /**
     * Antes de tocar no banco. Recusar depois de tres consultas ja teria
     * pagado o custo que o limite existe para evitar.
     */
    if (!joinLimiter.take(userId)) {
      // `retriable`: a recusa e por ritmo, nao por permissao. O religa-a-call
      // do cliente tenta de novo em vez de abandonar a intencao de estar na
      // call.
      respond({
        ok: false,
        error: "Espere um instante para entrar de novo.",
        retriable: true,
      });
      return;
    }

    /**
     * A autorizacao, a ocupacao e o token de midia moram em `entrarNaVoz`
     * (`../entrar-em-voz.ts`) — o Music Bot experimental entra pela MESMA
     * porta, via REST (`/internal/voice-token`), em vez de reimplementar isto.
     *
     * `excluirDoAvisoAnterior: socket.id`: trocou de servidor, quem ficou para
     * tras precisa ver a saida — mas quem MOVEU a call, nao. Sem isto, se o
     * socket dele ainda estivesse na sala do servidor antigo (corrida com o
     * `server:leave` do cliente) ele receberia um `voice:update` de "voce
     * saiu" logo depois de ter entrado no canal novo — e a interface
     * derrubava a call que acabara de comecar.
     */
    try {
      const resultado = await entrarNaVoz(io, {
        userId,
        user,
        channelId,
        socketId: socket.id,
        excluirDoAvisoAnterior: socket.id,
      });
      respond(resultado);
    } catch (error) {
      log.error("gateway.voice.join", "voice:join falhou", {
        err: error,
        userId,
        socketId: socket.id,
        canalId: channelId,
      });
      // Erro de banco/rede e passageiro — o cliente pode tentar de novo.
      respond({ ok: false, error: "Falha ao conectar", retriable: true });
    }
  });

  socket.on("voice:leave", async () => {
    await sairDaVoz(io, { userId });
  });

  /**
   * Token de midia novo para a sala em que a pessoa JA esta.
   *
   * O SDK do LiveKit troca o token sozinho enquanto a conexao vive, mas se a
   * rede cai atravessando o vencimento a reconexao automatica dele esgota as
   * tentativas com um token morto. Ai o cliente pede aqui.
   *
   * Revalida a permissao antes de reemitir: quem perdeu CONNECT enquanto
   * falava recebe recusa e para de tentar, em vez de insistir com um token
   * que o SFU sempre vai negar. Mesmo limitador do `voice:join` — o custo
   * (consultas + emissao de token) e identico.
   */
  socket.on("voice:refresh-token", async (ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    if (!joinLimiter.take(userId)) {
      respond({ ok: false, error: "Espere um instante." });
      return;
    }

    try {
      const location = await voiceLocation(userId);
      if (!location) {
        respond({ ok: false, error: "Voce nao esta em um canal de voz" });
        return;
      }

      const access = await loadMemberAccess(location.serverId, userId);
      const bits = access
        ? await getChannelPermissions(access, location.channelId)
        : null;
      if (
        bits === null ||
        !has(bits, "VIEW_CHANNEL") ||
        !has(bits, "CONNECT")
      ) {
        respond({ ok: false, error: "Voce nao tem mais acesso a este canal" });
        return;
      }

      const media = await createMediaCredentials({
        channelId: location.channelId,
        userId,
        displayName: user.displayName,
        permissions: bits,
      });
      if (!media) {
        respond({ ok: false, error: "Midia indisponivel neste servidor" });
        return;
      }

      respond({ ok: true, media });
    } catch (error) {
      log.error("gateway.voice.refresh_token", "voice:refresh-token falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao renovar" });
    }
  });

  socket.on("voice:state", async (patch) => {
    if (!autoSinalLimiter.take(userId)) return;
    if (!patch || typeof patch !== "object") return;
    const updated = await setVoiceFlags(userId, {
      selfMuted:
        typeof patch.selfMuted === "boolean" ? patch.selfMuted : undefined,
      selfDeafened:
        typeof patch.selfDeafened === "boolean"
          ? patch.selfDeafened
          : undefined,
    });
    if (updated) broadcast(updated.serverId, updated.participant);
  });

  socket.on("voice:speaking", async (speaking) => {
    if (typeof speaking !== "boolean") return;
    if (!speakingLimiter.take(userId)) return;

    // Devolve null quando o estado ja era esse — nao republicamos valor
    // identico para a sala inteira.
    const updated = await setVoiceSpeaking(userId, speaking);
    if (updated) broadcast(updated.serverId, updated.participant);
  });

  /**
   * Espera a faixa aparecer e conferir contra o plano.
   *
   * Silenciar quem excede acontece no SFU (`conferirQualidadeDaTela`), e nao
   * na interface — cliente reescrito nao contorna. O aviso pelo socket serve
   * para a pessoa entender por que a tela dela ficou preta em vez de achar
   * que quebrou.
   */
  async function conferirTelaEmSegundoPlano(quem: string, canal: string) {
    const plano = await loadPlan(quem).catch(() => null);
    if (!plano) return;

    const ESPERAS = [2000, 4000, 8000];
    for (const espera of ESPERAS) {
      await new Promise((r) => setTimeout(r, espera));

      // Parou de transmitir no meio da espera: nao ha o que conferir.
      const aqui = await voiceLocation(quem);
      if (!aqui || aqui.channelId !== canal) return;

      const excedeu = await conferirQualidadeDaTela({
        channelId: canal,
        userId: quem,
        alturaMax: plano.limites.alturaMax,
      });
      if (!excedeu) continue;

      log.warn("gateway.voice.qualidade_excedida", "tela acima do plano", {
        userId: quem,
        canalId: canal,
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

  socket.on("voice:streaming", async (streaming) => {
    if (!autoSinalLimiter.take(userId)) return;
    if (typeof streaming !== "boolean") return;

    const location = await voiceLocation(userId);
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
        log.error("gateway.voice.streaming", "voice:streaming falhou", {
          err: error,
          userId,
          socketId: socket.id,
        });
        return;
      }
    }

    const updated = await setVoiceStreaming(userId, streaming);
    if (updated) broadcast(updated.serverId, updated.participant);

    /**
     * A QUALIDADE E CONFERIDA DEPOIS, e nao aqui na hora.
     *
     * Quando este evento chega, a faixa quase nunca esta publicada ainda: o
     * cliente avisa o servidor e comeca a subir a tela em paralelo. Perguntar
     * ao SFU agora devolveria "sem faixa" e a checagem passaria sempre.
     *
     * Por isso as tentativas espacadas: a primeira pega o caso rapido, as
     * seguintes cobrem conexao lenta e negociacao demorada. Param assim que
     * encontrarem a faixa — em resolucao boa ou ruim.
     *
     * `void` de proposito: nada disto pode segurar o handler. Quem comeca a
     * transmitir nao espera pela conferencia.
     */
    if (streaming) void conferirTelaEmSegundoPlano(userId, location.channelId);
  });

  /**
   * "estou com a camera ligada". So sinalizacao — o video vai pelo SFU.
   *
   * A checagem espelha a do `voice:streaming`, e pela mesma razao: o token do
   * SFU ja impede PUBLICAR a faixa sem a permissao CAMERA, entao ninguem
   * aparece de fato. Mas o indicador e outra coisa — sem checar aqui, um
   * cliente reescrito poderia se anunciar "com camera" para o servidor
   * inteiro. Interface que mente e bug, mesmo sem dado vazando.
   *
   * DESLIGAR nunca exige permissao. Parar e sempre legitimo, e exigir cargo
   * para parar prenderia alguem ao indicador aceso depois de perde-lo.
   */
  socket.on("voice:camera", async (camera) => {
    if (!autoSinalLimiter.take(userId)) return;
    if (typeof camera !== "boolean") return;

    const location = await voiceLocation(userId);
    if (!location) return;

    if (camera) {
      try {
        const access = await loadMemberAccess(location.serverId, userId);
        const bits = access
          ? await getChannelPermissions(access, location.channelId)
          : null;
        if (bits === null || !has(bits, "CAMERA")) return;
      } catch (error) {
        log.error("gateway.voice.camera", "voice:camera falhou", {
          err: error,
          userId,
          socketId: socket.id,
        });
        return;
      }
    }

    const atualizado = await setVoiceCamera(userId, camera);
    if (atualizado) broadcast(atualizado.serverId, atualizado.participant);
  });

  /**
   * Moderacao de voz sobre outra pessoa.
   *
   * A permissao e checada por acao: silenciar exige MUTE_MEMBERS, ensurdecer
   * exige DEAFEN_MEMBERS. Ter uma nao concede a outra.
   */
  socket.on("voice:moderate", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;
    if (!moderarLimiter.take(userId)) {
      respond({ ok: false, error: "Espere um instante." });
      return;
    }
    const targetId = payload?.userId;

    if (typeof targetId !== "string" || targetId.length === 0) {
      respond({ ok: false, error: "Usuario invalido" });
      return;
    }
    if (targetId === userId) {
      respond({
        ok: false,
        error: "Use os proprios controles para se silenciar.",
      });
      return;
    }

    const target = await voiceLocation(targetId);
    if (!target) {
      respond({ ok: false, error: "Essa pessoa nao esta em um canal de voz" });
      return;
    }

    try {
      const access = await loadMemberAccess(target.serverId, userId);
      if (!access) {
        respond({ ok: false, error: "Sem permissao" });
        return;
      }

      const wantsMute = typeof payload.serverMuted === "boolean";
      const wantsDeafen = typeof payload.serverDeafened === "boolean";
      if (!wantsMute && !wantsDeafen) {
        respond({ ok: false, error: "Nada a alterar" });
        return;
      }
      if (wantsMute && !has(access.permissions, "MUTE_MEMBERS")) {
        respond({ ok: false, error: "Seu cargo nao permite silenciar" });
        return;
      }
      if (wantsDeafen && !has(access.permissions, "DEAFEN_MEMBERS")) {
        respond({ ok: false, error: "Seu cargo nao permite ensurdecer" });
        return;
      }

      // Mesma hierarquia de expulsar e banir, vinda de @aether/access.
      if (!(await canActOnUser(access, targetId))) {
        respond({
          ok: false,
          error: "Voce so pode moderar quem tem cargo abaixo do seu",
        });
        return;
      }

      const updated = await setServerVoiceFlags(targetId, {
        serverMuted: payload.serverMuted,
        serverDeafened: payload.serverDeafened,
      });
      if (!updated) {
        respond({ ok: true });
        return;
      }

      /**
       * A imposicao acontece no SFU, nao na interface: desligamos a faixa de
       * audio na infraestrutura. O evento abaixo so mantem as telas em dia.
       *
       * Uma tentativa extra cobre uma instabilidade passageira do SFU sem
       * incomodar o moderador por nada. Se `wantsMute` pediu de verdade uma
       * mudanca de mudo e as duas tentativas devolverem `falhou` (SFU fora do
       * ar, nao so "sem faixa ainda"), o moderador PRECISA saber — responder
       * `ok:true` aqui e exatamente o bug que deixava alguem marcado como
       * mudo na tela com o audio real continuando a sair.
       */
      let resultadoSfu = await applyServerMute({
        channelId: updated.channelId,
        userId: targetId,
        muted: updated.participant.serverMuted,
      });
      if (resultadoSfu === "falhou") {
        resultadoSfu = await applyServerMute({
          channelId: updated.channelId,
          userId: targetId,
          muted: updated.participant.serverMuted,
        });
      }

      broadcast(updated.serverId, updated.participant);

      if (wantsMute && resultadoSfu === "falhou") {
        respond({
          ok: false,
          error:
            "Marcado na interface, mas o servidor de audio nao confirmou — tente de novo em instantes.",
        });
        return;
      }
      respond({ ok: true });
    } catch (error) {
      log.error("gateway.voice.moderate", "voice:moderate falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao moderar" });
    }
  });

  socket.on("voice:move", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;
    if (!moderarLimiter.take(userId)) {
      respond({ ok: false, error: "Espere um instante." });
      return;
    }
    const targetId = payload?.userId;
    const channelId = payload?.channelId;

    if (typeof targetId !== "string" || typeof channelId !== "string") {
      respond({ ok: false, error: "Dados invalidos" });
      return;
    }

    const target = await voiceLocation(targetId);
    if (!target) {
      respond({ ok: false, error: "Essa pessoa nao esta em um canal de voz" });
      return;
    }
    if (target.channelId === channelId) {
      respond({ ok: true });
      return;
    }

    try {
      const access = await loadMemberAccess(target.serverId, userId);
      if (!access || !has(access.permissions, "MOVE_MEMBERS")) {
        respond({ ok: false, error: "Seu cargo nao permite mover pessoas" });
        return;
      }
      if (targetId !== userId && !(await canActOnUser(access, targetId))) {
        respond({
          ok: false,
          error: "Voce so pode mover quem tem cargo abaixo do seu",
        });
        return;
      }

      const channel = await prisma.channel.findFirst({
        where: { id: channelId, serverId: target.serverId, type: "VOICE" },
        select: { id: true },
      });
      if (!channel) {
        respond({ ok: false, error: "Canal de voz nao encontrado" });
        return;
      }

      /**
       * O destino e checado com as permissoes de QUEM ESTA SENDO MOVIDO.
       * Sem isso, mover viraria um jeito de colocar alguem dentro de um canal
       * que ela nao poderia acessar por conta propria.
       */
      const targetAccess = await loadMemberAccess(target.serverId, targetId);
      const targetBits = targetAccess
        ? await getChannelPermissions(targetAccess, channelId)
        : null;
      if (
        targetBits === null ||
        !has(targetBits, "VIEW_CHANNEL") ||
        !has(targetBits, "CONNECT")
      ) {
        respond({
          ok: false,
          error: "Essa pessoa nao tem acesso ao canal de destino",
        });
        return;
      }

      /**
       * NAO buscamos o socket local (`io.sockets.sockets.get`, como fazia
       * antes da fase 7c-2): com mais de uma instancia de gateway, quem esta
       * sendo movido pode estar conectado numa maquina DIFERENTE da que
       * recebeu este evento, e essa busca so enxerga sockets LOCAIS. O
       * `PublicUser` ja esta gravado na propria ocupacao de voz (guardado
       * quando a pessoa entrou), e `io.to(room.user(...))` alcanca qualquer
       * instancia — nenhum dos dois exige saber ONDE o socket dela vive.
       */
      const targetSocketId = await voiceSocketOf(targetId);
      const currentParticipant = await voiceParticipant(targetId);
      if (!targetSocketId || !currentParticipant) {
        respond({ ok: false, error: "Essa pessoa saiu da call" });
        return;
      }
      const targetUser = currentParticipant.user;

      await joinVoice({
        socketId: targetSocketId,
        userId: targetId,
        user: targetUser,
        serverId: target.serverId,
        channelId,
      });

      /**
       * Cada canal e uma sala propria no SFU, entao o token antigo nao serve.
       * Emitimos as credenciais novas junto do aviso para a pessoa nao ficar
       * muda no intervalo entre ser movida e pedir acesso.
       */
      const media = await createMediaCredentials({
        channelId,
        userId: targetId,
        displayName: targetUser.displayName,
        permissions: targetBits,
      });
      io.to(room.user(targetId)).emit("voice:moved", { channelId, media });

      const participant = await voiceParticipant(targetId);
      if (participant) broadcast(target.serverId, participant);

      // Tiraram a pessoa de uma sala de grupo — ela pode ter esvaziado.
      void talvezRemoverSalaEfemera(io, target.channelId);

      respond({ ok: true });
    } catch (error) {
      log.error("gateway.voice.move", "voice:move falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao mover" });
    }
  });

  /**
   * Desconecta outra pessoa da call, sem mover para lugar nenhum.
   *
   * MESMA permissao de `voice:move` (`MOVE_MEMBERS`) e mesma hierarquia
   * (`canActOnUser`) — quem ja pode arrastar alguem para outro canal
   * conseguiria o mesmo efeito arrastando para um canal vazio; isto so
   * evita esse rodeio e deixa a intencao explicita na interface.
   *
   * Reaproveita `sairDaVoz` (a mesma funcao de `voice:leave` e do
   * `disconnect` do socket) em vez de reimplementar remocao de ocupacao —
   * ela ja emite o `voice:update` de saida que o CLIENTE da propria pessoa
   * escuta para se desconectar da sala do LiveKit (`realtime-store.ts::
   * updateVoice`, o caso `channelId === null` para `souEu`).
   */
  socket.on("voice:disconnect", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;
    if (!moderarLimiter.take(userId)) {
      respond({ ok: false, error: "Espere um instante." });
      return;
    }
    const targetId = payload?.userId;

    if (typeof targetId !== "string" || targetId.length === 0) {
      respond({ ok: false, error: "Usuario invalido" });
      return;
    }
    if (targetId === userId) {
      respond({ ok: false, error: "Use os proprios controles para sair." });
      return;
    }

    const target = await voiceLocation(targetId);
    if (!target) {
      respond({ ok: false, error: "Essa pessoa nao esta em um canal de voz" });
      return;
    }

    try {
      const access = await loadMemberAccess(target.serverId, userId);
      if (!access || !has(access.permissions, "MOVE_MEMBERS")) {
        respond({ ok: false, error: "Seu cargo nao permite desconectar pessoas" });
        return;
      }
      if (!(await canActOnUser(access, targetId))) {
        respond({
          ok: false,
          error: "Voce so pode desconectar quem tem cargo abaixo do seu",
        });
        return;
      }

      await sairDaVoz(io, { userId: targetId });

      // Pode ter esvaziado uma sala de grupo.
      void talvezRemoverSalaEfemera(io, target.channelId);

      respond({ ok: true });
    } catch (error) {
      log.error("gateway.voice.disconnect", "voice:disconnect falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao desconectar" });
    }
  });

  socket.on("disconnect", () => {
    // So derruba a voz se foi ESTE socket que entrou nela: outras abas da
    // mesma pessoa nao devem tirar ninguem da call.
    void sairDaVoz(io, { userId, onlyIfSocket: socket.id }).catch((erro) => {
      log.error("gateway.voice.disconnect", "disconnect (voice) falhou", {
        err: erro,
        userId,
        socketId: socket.id,
      });
    });
  });
}
