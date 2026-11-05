"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AetherIcon, type AetherIconName } from "@/components/ui/aether-icon";
import type {
  PublicChannel,
  PublicUser,
  UserStatus,
  ViewerContext,
} from "@aether/shared";
import { useTransition } from "react";
import {
  blockUserAction,
  sendFriendRequestFromServerAction,
} from "@/server/actions/friends";
import { useSocket } from "@/components/realtime/realtime-provider";
import { useAbrirConversa } from "@/lib/chat/use-abrir-conversa";
import { encerrarChamadaDm } from "@/lib/voice/use-chamada-dm";
import { useListening, useRealtimeStore } from "@/lib/stores/realtime-store";
import { Avatar } from "@/components/ui/avatar";
import { SeloPlano } from "@/components/ui/selo-plano";
import { cn } from "@/lib/utils";
import { viewerCan } from "@/lib/permissions";
import {
  DEFAULT_VOLUME,
  readUserVolumes,
  saveUserVolume,
} from "@/lib/voice/volumes";
import { VolumeSlider } from "@/components/ui/volume-slider";
import { useElapsed } from "@/lib/use-elapsed";
import { GameArt } from "@/components/profile/game-art";
import { MusicActivityRow } from "@/components/profile/music-activity";
import {
  CamadaDeEfeito,
  FaixaDeBanner,
} from "@/components/profile/cosmeticos-de-perfil";
import { useImagensDoPerfil } from "@/lib/use-imagens-do-perfil";
import { DenunciarDialog } from "@/components/chat/denunciar-dialog";

/**
 * AETHER Activity — o cartao de perfil com o que a pessoa esta fazendo agora.
 *
 * Nao existe um "objeto de presenca" novo por tras disto de proposito. Tudo
 * que aparece aqui ja viajava em tempo real: `presence` da o online/ausente e
 * `voice` da canal, mudo, surdo, tela e falando. Inventar uma segunda fonte
 * para os mesmos fatos criaria duas verdades sobre a mesma pessoa — e quando
 * elas divergissem, nao haveria qual acreditar.
 *
 * Por isso o cartao le da store a CADA render em vez de receber um retrato
 * congelado: com ele aberto, a pessoa entrar num canal, mutar ou comecar a
 * transmitir muda o que esta na tela na hora.
 *
 * O unico dado novo e o `joinedAt`, carimbado pelo gateway — relogio de
 * navegador erra, e um cliente poderia dizer que esta ali ha oito horas.
 */

export interface CardAnchor {
  x: number;
  y: number;
}

const CARD_WIDTH = 272;
/** Margem para o cartao nunca encostar na borda da janela. */
const EDGE_GAP = 8;

const STATUS_LABEL: Record<UserStatus, string> = {
  ONLINE: "Online",
  IDLE: "Ausente",
  DND: "Nao perturbe",
  OFFLINE: "Offline",
};

const STATUS_COLOR: Record<UserStatus, string> = {
  ONLINE: "bg-signal-online",
  IDLE: "bg-signal-idle",
  DND: "bg-signal-dnd",
  OFFLINE: "bg-ink-600",
};

/**
 * Ha quanto tempo, contado a partir do carimbo do servidor.
 *
 * Um intervalo de 1s so enquanto o cartao esta aberto: e um contador visivel,
 * e parar de contar enquanto alguem olha seria pior que nao mostrar.
 */

export function UserActivityCard({
  user,
  nickname,
  serverName,
  voiceChannels,
  podeAdicionarAmigo = false,
  viewer,
  anchor,
  onClose,
}: {
  user: PublicUser;
  /** apelido no servidor aberto; o cartao mostra o apelido e o nome real */
  nickname?: string | null;
  serverName: string;
  voiceChannels: PublicChannel[];
  /**
   * A pessoa ainda NAO tem relacao comigo (nem amizade, nem pedido pendente,
   * nem bloqueio). Vem calculado do servidor: quem sabe montar isso e o banco,
   * e uma copia no cliente seria uma segunda versao da mesma consulta.
   */
  podeAdicionarAmigo?: boolean;
  /**
   * Cargo de quem esta OLHANDO, para decidir o que pode moderar.
   *
   * Ausente = cartao sem moderacao. Nao e o mesmo que "nao pode": e o servidor
   * que decide de novo a cada acao. Aqui so escondemos o que seria recusado.
   */
  viewer?: ViewerContext;
  anchor: CardAnchor;
  onClose: () => void;
}) {
  const socket = useSocket();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const imagens = useImagensDoPerfil(user.id);
  const [position, setPosition] = useState(anchor);
  const { abrir, abrindo: abrindoConversa, erro: erroConversa } = useAbrirConversa();
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoBloqueio, setConfirmandoBloqueio] = useState(false);
  const [bloqueando, startBloqueio] = useTransition();
  const [pedidoEnviado, setPedidoEnviado] = useState(false);
  const roomControls = useRealtimeStore((state) => state.roomControls);
  const [volume, setVolume] = useState(
    () => readUserVolumes()[user.id] ?? DEFAULT_VOLUME,
  );
  const [erroModeracao, setErroModeracao] = useState<string | null>(null);
  const [pedindo, startPedido] = useTransition();

  const presence = useRealtimeStore((state) => state.presence);
  const activity = useRealtimeStore((state) => state.activity);
  const voice = useRealtimeStore((state) => state.voice);
  const selfUserId = useRealtimeStore((state) => state.selfUserId);
  const setMedia = useRealtimeStore((state) => state.setMedia);
  const setVoiceError = useRealtimeStore((state) => state.setVoiceError);

  /**
   * Abre conversa a partir do servidor.
   *
   * O ERRO FICA NO CARTAO, e nao some. Quando a pessoa nao aceita mensagem de
   * quem nao e amigo, o gateway responde dizendo isso — e a frase precisa
   * aparecer onde a pessoa clicou. Aceitar em silencio faria quem mandou ir
   * embora achando que esta sendo ignorado.
   */
  function mandarMensagem() {
    abrir(user.id, onClose);
  }

  /**
   * Bloquear pede CONFIRMACAO no proprio cartao, e nao age no primeiro clique.
   *
   * E destrutivo de um jeito que nao se desfaz sozinho: apaga a amizade, e
   * desbloquear depois nao a traz de volta. Um clique errado ao lado de
   * "Mandar mensagem" custaria caro, e o cartao e pequeno — os dois botoes
   * ficam perto.
   */
  function bloquear() {
    startBloqueio(async () => {
      const resultado = await blockUserAction(user.id);
      if (!resultado.ok) {
        setErro(resultado.error);
        return;
      }
      onClose();
    });
  }

  function pedirAmizade() {
    startPedido(async () => {
      const resultado = await sendFriendRequestFromServerAction(user.id);
      if (!resultado.ok) {
        setErro(resultado.error);
        return;
      }
      /**
       * Nao fecha o cartao: quem clicou precisa ver que deu certo, e sumir a
       * janela deixaria a pessoa sem saber se o pedido foi. "Ja sao amigos"
       * aparece quando os dois pediram um ao outro.
       */
      setErro(null);
      setPedidoEnviado(true);
    });
  }

  /**
   * Volume so faz sentido para OUTRA pessoa que esteja numa call: regular o
   * proprio microfone aqui nao quer dizer nada, e regular quem nao esta
   * falando nao tem o que aplicar.
   */
  function mudarVolume(proximo: number) {
    setVolume(proximo);
    saveUserVolume(user.id, proximo);
    roomControls?.setUserVolume(user.id, proximo);
  }

  function moderar(patch: { serverMuted?: boolean; serverDeafened?: boolean }) {
    setErroModeracao(null);
    socket?.emit(
      "voice:moderate",
      { userId: user.id, ...patch },
      (resultado) => {
        if (!resultado.ok) {
          setErroModeracao(resultado.error);
          return;
        }
        onClose();
      },
    );
  }

  function mover(channelId: string) {
    setErroModeracao(null);
    socket?.emit("voice:move", { userId: user.id, channelId }, (resultado) => {
      if (!resultado.ok) {
        setErroModeracao(resultado.error);
        return;
      }
      onClose();
    });
  }

  /** Mesma permissao de mover — ver o comentario em `voice:disconnect` no gateway. */
  function desconectar() {
    setErroModeracao(null);
    socket?.emit("voice:disconnect", { userId: user.id }, (resultado) => {
      if (!resultado.ok) {
        setErroModeracao(resultado.error);
        return;
      }
      onClose();
    });
  }

  const status = presence[user.id] ?? "OFFLINE";
  const participant = voice[user.id] ?? null;
  const channel = participant?.channelId
    ? (voiceChannels.find((item) => item.id === participant.channelId) ?? null)
    : null;

  // Quantos dividem o canal — derivado da mesma store, sem pedir nada a mais.
  const inChannel = participant?.channelId
    ? Object.values(voice).filter(
        (item) => item.channelId === participant.channelId,
      ).length
    : 0;

  const elapsed = useElapsed(participant?.joinedAt ?? null);

  const game = activity[user.id] ?? null;
  const gameElapsed = useElapsed(game?.since ?? null);
  const musica = useListening(user.id);

  /**
   * Reposiciona depois de medir: perto da borda o cartao sairia da tela.
   * `useLayoutEffect` para o ajuste acontecer antes da pintura — senao ele
   * pisca na posicao errada.
   */
  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      x: Math.max(
        EDGE_GAP,
        Math.min(anchor.x, window.innerWidth - width - EDGE_GAP),
      ),
      y: Math.max(
        EDGE_GAP,
        Math.min(anchor.y, window.innerHeight - height - EDGE_GAP),
      ),
    });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const muted = participant
    ? participant.selfMuted || participant.serverMuted
    : false;
  const deafened = participant
    ? participant.selfDeafened || participant.serverDeafened
    : false;

  /**
   * A atividade e a coisa MAIS especifica que sabemos, nao a soma de tudo:
   * "compartilhando" ja implica estar em chamada, e listar os dois viraria
   * ruido em vez de informacao.
   */
  const estado = participant?.streaming
    ? {
        icon: "screen-share" as AetherIconName,
        label: "Compartilhando a tela",
        tone: "text-signal-live",
      }
    : participant?.speaking && !muted
      ? {
          icon: "mic" as AetherIconName,
          label: "Falando",
          tone: "text-accent-300",
        }
      : participant
        ? {
            icon: "headset" as AetherIconName,
            label: "Em chamada",
            tone: "text-ink-200",
          }
        : status === "OFFLINE"
          ? null
          : {
              icon: null as AetherIconName | null,
              label: "No AETHER",
              tone: "text-ink-400",
            };

  const isSelf = user.id === selfUserId;
  const selfVoice = selfUserId ? (voice[selfUserId] ?? null) : null;
  const canJoin =
    !isSelf &&
    channel !== null &&
    selfVoice?.channelId !== channel.id &&
    socket !== null;

  /**
   * O que este cartao pode oferecer de moderacao.
   *
   * Tudo depende de a pessoa estar NUMA CALL: silenciar quem nao esta em canal
   * de voz nao tem onde ser aplicado, e mover exige ter de onde mover.
   */
  const naCall = participant !== null;
  const podeVolume = !isSelf && naCall;
  const podeSilenciar = naCall && !!viewer && viewerCan(viewer, "MUTE_MEMBERS");
  const podeEnsurdecer =
    naCall && !!viewer && viewerCan(viewer, "DEAFEN_MEMBERS");
  const podeMover = naCall && !!viewer && viewerCan(viewer, "MOVE_MEMBERS");
  const destinos = (voiceChannels ?? []).filter(
    (item) => item.id !== participant?.channelId,
  );

  /**
   * Hub (4b-2): quem CRIOU a sala pode tirar alguem dela. A tela so mostra; o
   * gateway confere a regra (`podeRemoverDaSalaDoHub`) de novo.
   */
  const podeRemoverDaSala =
    naCall &&
    viewer?.hub === true &&
    !isSelf &&
    selfUserId !== null &&
    channel?.criadaPor === selfUserId;
  const [removendoDaSala, setRemovendoDaSala] = useState(false);
  const [denunciando, setDenunciando] = useState(false);

  function removerDaSala() {
    if (!socket || !participant?.channelId) return;
    setErroModeracao(null);
    setRemovendoDaSala(true);
    socket.emit(
      "hub:remover",
      { channelId: participant.channelId, userId: user.id },
      (resultado) => {
        setRemovendoDaSala(false);
        if (!resultado.ok) {
          setErroModeracao(resultado.error);
          return;
        }
        onClose();
      },
    );
  }

  function joinChannel() {
    if (!socket || !channel) return;
    // Voz de servidor e chamada direta se excluem (salas diferentes do SFU).
    encerrarChamadaDm(socket);
    socket.emit("voice:join", { channelId: channel.id }, (result) => {
      if (!result.ok) {
        setVoiceError(result.error);
        return;
      }
      setVoiceError(null);
      setMedia(result.media);
      onClose();
    });
  }

  if (typeof document === "undefined") return null;

  // Denunciar troca o cartao pelo dialogo — o cartao e quem monta o dialogo,
  // e fechar um desmontaria o outro.
  if (denunciando) {
    return (
      <DenunciarDialog
        open
        onClose={onClose}
        tipo="USUARIO"
        alvoId={user.id}
        oQue={user.displayName}
      />
    );
  }

  const nomeEstado = estado?.icon ?? null;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="fixed inset-0 z-[60] cursor-default"
      />
      <div
        ref={cardRef}
        style={{ left: position.x, top: position.y, width: CARD_WIDTH }}
        className="fixed z-[61] animate-rise overflow-hidden rounded-lg border border-line bg-base-900 shadow-xl"
      >
        {imagens.efeito ? <CamadaDeEfeito url={imagens.efeito} /> : null}
        {/* Faixa superior: o banner, ou so cor, para o avatar se apoiar. */}
        <FaixaDeBanner url={imagens.banner} pronto={imagens.pronto} />

        <div className="px-3.5 pb-3.5">
          <div className="-mt-6 mb-2.5">
            <Avatar
              userId={user.id}
              name={nickname ?? user.displayName}
              src={user.avatarUrl}
              moldura={user.moldura}
              status={status}
              size="lg"
            />
          </div>

          <div className="flex items-center gap-2">
            <p className="min-w-0 truncate text-[15px] font-semibold text-ink-100">
              {nickname ?? user.displayName}
            </p>
            {/*
              Aqui o selo vai no tamanho grande, com o nome do plano escrito.
              E a tela em que alguem esta olhando QUEM e a outra pessoa — o
              lugar em que o rotulo por extenso vale a largura que ocupa.
            */}
            <SeloPlano tier={user.plano} />
          </div>
          <p className="select-text truncate font-mono text-[11px] text-ink-500">
            @{user.username}
            {/* Com apelido, o nome real deixa de aparecer em qualquer lugar. */}
            {nickname ? ` · ${user.displayName}` : ""}
          </p>

          <div className="mt-2 flex items-center gap-1.5">
            <span
              className={cn("h-2 w-2 rounded-full", STATUS_COLOR[status])}
              aria-hidden
            />
            <span className="text-[12px] text-ink-300">
              {STATUS_LABEL[status]}
            </span>
          </div>

          {estado || game || musica ? (
            <div className="mt-3 border-t border-line pt-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
                atividade
              </p>

              {musica ? (
                <div className="mb-2">
                  <MusicActivityRow musica={musica} />
                </div>
              ) : null}

              {/*
                O jogo vem PRIMEIRO, e nao junto do estado de voz: e o dado
                mais especifico sobre a pessoa. "Em chamada" muita gente esta;
                "jogando Hollow Knight" e o que diz o que ela esta fazendo.
              */}
              {game ? (
                <div className="mb-2 flex items-start gap-2">
                  <GameArt
                    cover={game.cover}
                    icon={game.icon}
                    className="h-14 w-10 rounded-[4px]"
                    iconClassName="h-3.5 w-3.5"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink-100">
                      Jogando {game.game}
                    </p>
                    {gameElapsed ? (
                      <p className="flex items-center gap-1 text-[11px] tabular-nums text-ink-500">
                        <AetherIcon
                          name="clock"
                          size="sm"
                          className="h-3 w-3 shrink-0"
                        />
                        {gameElapsed}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {estado ? (
                <div className="mt-1.5 flex items-center gap-1.5">
                  {nomeEstado ? (
                    <AetherIcon
                      name={nomeEstado}
                      className={cn("h-3.5 w-3.5 shrink-0", estado.tone)}
                    />
                  ) : null}
                  <span className={cn("text-[13px]", estado.tone)}>
                    {estado.label}
                  </span>
                  {muted ? (
                    <AetherIcon
                      name="mic-off"
                      className="h-3 w-3 shrink-0 text-signal-dnd"
                      aria-label="Mutado"
                    />
                  ) : null}
                  {deafened ? (
                    <AetherIcon
                      name="volume-off"
                      className="h-3 w-3 shrink-0 text-signal-dnd"
                      aria-label="Surdo"
                    />
                  ) : null}
                </div>
              ) : null}

              {channel ? (
                <>
                  <div className="mt-2 flex items-start gap-1.5">
                    <AetherIcon
                      name="volume"
                      size="sm"
                      className="mt-[3px] shrink-0 text-ink-500"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-ink-200">
                        {channel.name}
                      </p>
                      <p className="truncate text-[11px] text-ink-500">
                        {serverName}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-500">
                    <span className="flex items-center gap-1">
                      <AetherIcon
                        name="users"
                        size="sm"
                        className="h-3 w-3 shrink-0"
                      />
                      {inChannel}
                      {channel.userLimit ? ` / ${channel.userLimit}` : ""}
                    </span>
                    {elapsed ? (
                      <span className="flex items-center gap-1 tabular-nums">
                        <AetherIcon
                          name="clock"
                          size="sm"
                          className="h-3 w-3 shrink-0"
                        />
                        {elapsed}
                      </span>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {/*
            "Mandar mensagem" vem ANTES de "Entrar no canal": e o que mais se
            quer fazer ao abrir o cartao de alguem, e nao depende de a pessoa
            estar numa call.
          */}
          {user.id !== selfUserId ? (
            <button
              type="button"
              onClick={mandarMensagem}
              disabled={abrindoConversa}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-line bg-base-800 px-3 py-2 text-[12px] font-medium text-ink-200 transition-colors hover:bg-base-750 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AetherIcon name="message" size="sm" />
              {abrindoConversa ? "Abrindo..." : "Mandar mensagem"}
            </button>
          ) : null}

          {erro ?? erroConversa ? (
            <p className="mt-2 text-[11px] leading-snug text-signal-dnd">
              {erro ?? erroConversa}
            </p>
          ) : null}

          {/*
            VOLUME. Veio do menu dos tres pontinhos, que foi removido da lista
            de membros: aquele alvo tinha 12px e so aparecia no hover, e a
            queixa era justamente nao conseguir acerta-lo. Agora clicar na
            PESSOA abre tudo, e isto passou a morar aqui.
          */}
          {podeVolume ? (
            <div className="mt-3 border-t border-line pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-ink-300">Volume</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
                  {Math.round(volume * 100)}%
                </span>
              </div>
              <VolumeSlider
                value={volume}
                onChange={mudarVolume}
                label={`Volume de ${user.displayName}`}
                className="mt-2.5"
              />
            </div>
          ) : null}

          {podeSilenciar || podeEnsurdecer ? (
            <div className="mt-3 flex gap-2">
              {podeSilenciar ? (
                <button
                  type="button"
                  onClick={() =>
                    moderar({ serverMuted: !participant?.serverMuted })
                  }
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                    participant?.serverMuted
                      ? "border-line text-ink-200 hover:bg-base-800"
                      : "border-signal-dnd/40 text-signal-dnd hover:bg-signal-dnd/10",
                  )}
                >
                  {participant?.serverMuted ? (
                    <AetherIcon name="mic" size="sm" className="h-3 w-3" />
                  ) : (
                    <AetherIcon name="mic-off" size="sm" className="h-3 w-3" />
                  )}
                  {participant?.serverMuted ? "Devolver mic" : "Silenciar"}
                </button>
              ) : null}

              {podeEnsurdecer ? (
                <button
                  type="button"
                  onClick={() =>
                    moderar({ serverDeafened: !participant?.serverDeafened })
                  }
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                    participant?.serverDeafened
                      ? "border-line text-ink-200 hover:bg-base-800"
                      : "border-signal-dnd/40 text-signal-dnd hover:bg-signal-dnd/10",
                  )}
                >
                  {participant?.serverDeafened ? (
                    <AetherIcon name="volume" size="sm" className="h-3 w-3" />
                  ) : (
                    <AetherIcon
                      name="volume-off"
                      size="sm"
                      className="h-3 w-3"
                    />
                  )}
                  {participant?.serverDeafened
                    ? "Devolver audio"
                    : "Ensurdecer"}
                </button>
              ) : null}
            </div>
          ) : null}

          {podeMover && destinos.length > 0 ? (
            <div className="mt-2">
              <label className="block text-[11px] text-ink-500">
                Mover para
              </label>
              <select
                value=""
                onChange={(evento) => {
                  if (evento.target.value) mover(evento.target.value);
                }}
                className="mt-1 w-full rounded-md border border-line bg-base-950 px-2 py-1.5 text-[12px] text-ink-200"
              >
                <option value="">Escolher canal...</option>
                {destinos.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {podeMover ? (
            <button
              type="button"
              onClick={desconectar}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-signal-dnd/40 px-2 py-1.5 text-[11px] text-signal-dnd transition-colors hover:bg-signal-dnd/10"
            >
              <AetherIcon name="disconnect" size="sm" className="h-3 w-3" />
              Desconectar da call
            </button>
          ) : null}

          {podeRemoverDaSala ? (
            <button
              type="button"
              onClick={removerDaSala}
              disabled={removendoDaSala}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-signal-dnd/40 px-2 py-1.5 text-[11px] text-signal-dnd transition-colors hover:bg-signal-dnd/10 disabled:opacity-50"
            >
              <AetherIcon name="disconnect" size="sm" className="h-3 w-3" />
              {removendoDaSala ? "Removendo..." : "Remover da sala"}
            </button>
          ) : null}

          {erroModeracao ? (
            <p className="mt-2 text-[11px] leading-snug text-signal-dnd">
              {erroModeracao}
            </p>
          ) : null}

          {podeAdicionarAmigo && user.id !== selfUserId && !pedidoEnviado ? (
            <button
              type="button"
              onClick={pedirAmizade}
              disabled={pedindo}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-accent-600/50 bg-accent-600/10 px-3 py-2 text-[12px] font-medium text-accent-300 transition-colors hover:bg-accent-600/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AetherIcon name="user-plus" size="sm" />
              {pedindo ? "Enviando..." : "Adicionar amigo"}
            </button>
          ) : null}

          {pedidoEnviado ? (
            <p className="mt-2 text-center text-[11px] text-signal-online">
              Pedido enviado.
            </p>
          ) : null}

          {user.id !== selfUserId ? (
            confirmandoBloqueio ? (
              <div className="mt-2 rounded-md border border-signal-dnd/40 bg-signal-dnd/[0.07] p-2.5">
                <p className="text-[11px] leading-snug text-ink-300">
                  Bloquear <strong>{user.displayName}</strong> desfaz a amizade
                  de voces e impede a pessoa de te mandar mensagem, mesmo
                  dividindo um servidor. Desbloquear depois nao devolve a
                  amizade.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={bloquear}
                    disabled={bloqueando}
                    className="flex-1 rounded-md bg-signal-dnd/90 px-2 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-signal-dnd disabled:opacity-50"
                  >
                    {bloqueando ? "Bloqueando..." : "Bloquear"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmandoBloqueio(false)}
                    className="flex-1 rounded-md border border-line px-2 py-1.5 text-[11px] text-ink-300 transition-colors hover:bg-base-800"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmandoBloqueio(true)}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-line px-3 py-1.5 text-[11px] text-ink-400 transition-colors hover:border-signal-dnd/40 hover:text-signal-dnd"
              >
                <AetherIcon name="ban" size="sm" className="h-3 w-3" />
                Bloquear
              </button>
            )
          ) : null}

          {user.id !== selfUserId ? (
            <button
              type="button"
              onClick={() => setDenunciando(true)}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-line px-3 py-1.5 text-[11px] text-ink-400 transition-colors hover:border-signal-dnd/40 hover:text-signal-dnd"
            >
              <AetherIcon name="alert" size="sm" className="h-3 w-3" />
              Denunciar
            </button>
          ) : null}

          {canJoin ? (
            <button
              type="button"
              onClick={joinChannel}
              className="mt-3 w-full rounded-md border border-accent-600/50 bg-accent-600/10 px-3 py-2 text-[12px] font-medium text-accent-300 transition-colors hover:bg-accent-600/20"
            >
              Entrar no canal
            </button>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}
