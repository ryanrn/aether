"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import type {
  PerfilParaCartao,
  PublicUser,
  RelacaoComUsuario,
  UserStatus,
} from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Avatar } from "@/components/ui/avatar";
import { AvatarDecorado } from "@/components/profile/avatar-decorado";
import { CamadaDeEfeito } from "@/components/profile/cosmeticos-de-perfil";
import { SeloPlano } from "@/components/ui/selo-plano";
import { GameArt } from "@/components/profile/game-art";
import { MusicActivityRow } from "@/components/profile/music-activity";
import {
  useListening,
  usePresenceStatus,
  useRealtimeStore,
} from "@/lib/stores/realtime-store";
import { useAbrirConversa } from "@/lib/chat/use-abrir-conversa";
import { useElapsed } from "@/lib/use-elapsed";
import {
  buscarPerfil,
  guardarPerfil,
  perfilEmCache,
} from "@/lib/perfil-cache";
import {
  removeFriendAction,
  respondFriendRequestAction,
  sendFriendRequestAction,
  sendFriendRequestFromServerAction,
} from "@/server/actions/friends";
import { cn } from "@/lib/utils";

/**
 * Cartao de perfil — abre ao clicar no avatar ou no nome de alguem no chat.
 *
 * O `PublicUser` ja vem da mensagem (avatar, nome, @, status, plano). O resto —
 * bio, cargos e apelido do servidor aberto, estado da amizade — e buscado
 * quando o cartao abre (`carregarPerfilAction`), porque so esta tela usa.
 *
 * Ancorado ao elemento clicado: abre abaixo; se nao couber, acima; e nunca
 * passa da borda lateral. Fecha com Esc, clique fora, ou clique de novo na
 * mesma pessoa (o pai controla o toggle).
 *
 * Secao vazia nao aparece. Presenca/atividade vem da store em tempo real —
 * enquanto o cartao esta aberto, a pessoa comecar a jogar muda o que se ve.
 */
const LARGURA = 320;
const FOLGA = 8;

export function CartaoDePerfil({
  user,
  serverId,
  serverName,
  ancora,
  onClose,
}: {
  user: PublicUser;
  /** servidor aberto — ausente em conversa direta */
  serverId?: string;
  serverName?: string;
  /** retangulo do elemento clicado, em coordenadas de viewport */
  ancora: DOMRect;
  onClose: () => void;
}) {
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Comeca do cache (o hover no nome costuma ter buscado) e revalida abaixo.
  const [perfil, setPerfil] = useState<PerfilParaCartao | null>(() =>
    perfilEmCache(user.id, serverId),
  );
  /** tela estreita: o cartao vira uma folha colada embaixo, largura toda */
  const [folha, setFolha] = useState(false);

  const status = usePresenceStatus(user.id);
  const jogo = useRealtimeStore((s) => s.activity[user.id] ?? null);
  const musica = useListening(user.id);
  const selfUserId = useRealtimeStore((s) => s.selfUserId);
  const jogoDesde = useElapsed(jogo?.since ?? null);
  const isSelf = user.id === selfUserId;

  useEffect(() => {
    let vivo = true;
    void buscarPerfil(user.id, serverId).then((p) => {
      if (vivo && p) setPerfil(p);
    });
    return () => {
      vivo = false;
    };
  }, [user.id, serverId]);

  // Esc + clique fora
  useEffect(() => {
    function noClique(e: MouseEvent) {
      if (!caixaRef.current?.contains(e.target as Node)) onClose();
    }
    function naTecla(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    const t = setTimeout(() => document.addEventListener("mousedown", noClique));
    document.addEventListener("keydown", naTecla);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", noClique);
      document.removeEventListener("keydown", naTecla);
    };
  }, [onClose]);

  // posiciona depois de medir a altura real
  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (vw < 480) {
      setFolha(true);
      setPos({ left: FOLGA, top: 0 }); // top real vem do CSS da folha
      return;
    }
    setFolha(false);

    const alt = caixaRef.current?.offsetHeight ?? 320;
    let top = ancora.bottom + FOLGA;
    if (top + alt > vh - FOLGA) {
      const acima = ancora.top - alt - FOLGA;
      top = acima >= FOLGA ? acima : Math.max(FOLGA, vh - alt - FOLGA);
    }
    const left = Math.max(FOLGA, Math.min(ancora.left, vw - LARGURA - FOLGA));
    setPos({ left, top });
  }, [ancora, perfil, jogo, musica]);

  if (typeof document === "undefined") return null;

  const nome = perfil?.nickname ?? user.displayName;
  const temAtividade = Boolean(jogo?.game || musica);
  const temCargos = (perfil?.roles.length ?? 0) > 0;

  return createPortal(
    <>
      {folha ? (
        <button
          type="button"
          aria-label="Fechar"
          onClick={onClose}
          className="fixed inset-0 z-[74] bg-black/40"
        />
      ) : null}
      <div
        ref={caixaRef}
        style={
          folha
            ? { left: FOLGA, right: FOLGA, bottom: FOLGA }
            : { left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: LARGURA }
        }
        className={cn(
          "fixed z-[75] animate-rise border border-line bg-base-900 shadow-2xl",
          folha ? "max-h-[80vh] overflow-y-auto rounded-2xl" : "rounded-xl",
        )}
        role="dialog"
      >
      {perfil?.efeito ? <CamadaDeEfeito url={perfil.efeito} /> : null}
      {/*
        A faixa clipa SO A SI MESMA (nao o card inteiro) — antes o
        `overflow-hidden` estava no card, e com `DECORACAO_ESCALA` maior a
        decoracao (que sobe pra cima do avatar, que sobe pra cima da faixa)
        estourava o topo do card e ficava cortada. Arredondar so aqui mantem
        o canto bonito sem clipar o cosmetico.
      */}
      <div className={cn("overflow-hidden", folha ? "rounded-t-2xl" : "rounded-t-xl")}>
        {/*
          Altura fixa nos tres estados, e neutra ate a resposta chegar: mostrar
          a cor padrao e trocar pelo banner logo depois era um "pisca".
        */}
        {!perfil ? (
          <div className="h-[76px] bg-base-800" />
        ) : perfil.banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={perfil.banner}
            alt=""
            className="h-[76px] w-full object-cover"
          />
        ) : (
          <div className="h-[76px] bg-gradient-to-r from-accent-700/40 to-accent-500/15" />
        )}
      </div>

      <div className="px-4 pb-4">
        {/*
          O maior avatar da interface: e aqui que a pessoa ve a foto, a
          moldura, a decoracao e o indicador de presenca com folga. Sobe metade
          para dentro da faixa (`-mt-12` ~ metade de 96) para "se apoiar" nela.
        */}
        <div className="-mt-12 mb-2">
          {user.decoracao ? (
            <AvatarDecorado
              userId={user.id}
              name={nome}
              src={user.avatarUrl}
              moldura={user.moldura}
              status={status}
              px={96}
              ring="border-base-900"
              decoracao={{
                frenteUrl: user.decoracao.frente,
                trasUrl: user.decoracao.tras,
              }}
            />
          ) : (
            <Avatar
              userId={user.id}
              name={nome}
              src={user.avatarUrl}
              moldura={user.moldura}
              status={status}
              size="xl"
              ring="border-base-900"
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <p className="min-w-0 truncate text-[16px] font-semibold text-ink-100">
            {nome}
          </p>
          <SeloPlano tier={user.plano} />
        </div>
        <p className="select-text truncate font-mono text-[11px] text-ink-500">
          @{user.username}
          {perfil?.nickname ? ` · ${user.displayName}` : ""}
        </p>

        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={cn("h-2 w-2 rounded-full", COR_STATUS[status])}
            aria-hidden
          />
          <span className="text-[12px] text-ink-300">{ROTULO_STATUS[status]}</span>
        </div>

        {perfil?.bio ? (
          <p className="mt-2.5 select-text whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink-300">
            {perfil.bio}
          </p>
        ) : null}

        {temAtividade ? (
          <Secao titulo="Atividade">
            {musica ? <MusicActivityRow musica={musica} /> : null}
            {jogo?.game ? (
              <div
                className={cn(
                  "flex items-start gap-2",
                  musica && "mt-2",
                )}
              >
                <GameArt
                  cover={jogo.cover}
                  icon={jogo.icon}
                  className="h-12 w-9 rounded-[4px]"
                  iconClassName="h-3.5 w-3.5"
                />
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-ink-100">
                    Jogando {jogo.game}
                  </p>
                  {jogoDesde ? (
                    <p className="flex items-center gap-1 text-[11px] tabular-nums text-ink-500">
                      <AetherIcon name="clock" className="h-3 w-3 shrink-0" />
                      {jogoDesde}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </Secao>
        ) : null}

        {temCargos ? (
          <Secao titulo={serverName ? `Cargos em ${serverName}` : "Cargos"}>
            <div className="flex flex-wrap gap-1.5">
              {perfil!.roles.map((r) => (
                <span
                  key={r.id}
                  className="flex items-center gap-1.5 rounded-md border border-line bg-base-850 px-1.5 py-0.5 text-[11px] text-ink-200"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: r.color || "#8b929c" }}
                    aria-hidden
                  />
                  {r.name}
                </span>
              ))}
            </div>
          </Secao>
        ) : null}

        {!isSelf ? (
          <div className="mt-3.5 border-t border-line pt-3">
            <AcoesSociais
              user={user}
              serverId={serverId}
              perfil={perfil}
              onMudou={(p) => {
                setPerfil(p);
                guardarPerfil(user.id, serverId, p);
              }}
              onClose={onClose}
            />
          </div>
        ) : null}
      </div>
      </div>
    </>,
    document.body,
  );
}

function Secao({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
        {titulo}
      </p>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AcoesSociais({
  user,
  serverId,
  perfil,
  onMudou,
  onClose,
}: {
  user: PublicUser;
  serverId?: string;
  perfil: PerfilParaCartao | null;
  onMudou: (p: PerfilParaCartao) => void;
  onClose: () => void;
}) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const { abrir, abrindo, erro: erroConversa } = useAbrirConversa();

  const relacao: RelacaoComUsuario = perfil?.relacao ?? "nenhuma";

  function comResultado(
    promessa: Promise<{ ok: boolean; error?: string }>,
    proximaRelacao: RelacaoComUsuario,
    friendshipId: string | null = null,
  ) {
    setErro(null);
    iniciar(async () => {
      const r = await promessa;
      if (!r.ok) {
        setErro(r.error ?? "Nao deu certo.");
        return;
      }
      if (perfil) onMudou({ ...perfil, relacao: proximaRelacao, friendshipId });
    });
  }

  function adicionar() {
    comResultado(
      serverId
        ? sendFriendRequestFromServerAction(user.id)
        : sendFriendRequestAction(user.username),
      "pedido-enviado",
    );
  }
  function cancelarOuRemover(proxima: RelacaoComUsuario) {
    comResultado(removeFriendAction(user.id), proxima);
  }
  function responder(aceitar: boolean) {
    if (!perfil?.friendshipId) return;
    comResultado(
      respondFriendRequestAction(perfil.friendshipId, aceitar),
      aceitar ? "amigos" : "nenhuma",
      aceitar ? perfil.friendshipId : null,
    );
  }

  function mandarMensagem() {
    abrir(user.id, onClose);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {relacao === "pedido-recebido" ? (
          <>
            <BotaoAcao onClick={() => responder(true)} disabled={pendente} destaque>
              Aceitar
            </BotaoAcao>
            <BotaoAcao onClick={() => responder(false)} disabled={pendente}>
              Recusar
            </BotaoAcao>
          </>
        ) : relacao === "pedido-enviado" ? (
          <BotaoAcao
            onClick={() => cancelarOuRemover("nenhuma")}
            disabled={pendente}
          >
            <AetherIcon name="clock" size="sm" />
            Pedido enviado — cancelar
          </BotaoAcao>
        ) : relacao === "amigos" ? (
          <BotaoAcao
            onClick={() => cancelarOuRemover("nenhuma")}
            disabled={pendente}
          >
            <AetherIcon name="user-minus" size="sm" />
            Desfazer amizade
          </BotaoAcao>
        ) : relacao === "bloqueado" ? (
          <p className="flex-1 rounded-md border border-line px-2 py-2 text-center text-[11px] text-ink-500">
            Voce bloqueou esta pessoa.
          </p>
        ) : relacao === "bloqueou-voce" ? null : (
          <BotaoAcao onClick={adicionar} disabled={pendente} destaque>
            <AetherIcon name="user-plus" size="sm" />
            Adicionar amigo
          </BotaoAcao>
        )}
      </div>

      {relacao !== "bloqueado" && relacao !== "bloqueou-voce" ? (
        <BotaoAcao onClick={mandarMensagem} disabled={abrindo}>
          <AetherIcon name="message" size="sm" />
          {abrindo ? "Abrindo..." : "Mensagem"}
        </BotaoAcao>
      ) : null}

      {erro ?? erroConversa ? (
        <p className="text-[11px] leading-snug text-signal-dnd">
          {erro ?? erroConversa}
        </p>
      ) : null}
    </div>
  );
}

function BotaoAcao({
  children,
  onClick,
  disabled,
  destaque,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destaque?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        destaque
          ? "border border-accent-600/50 bg-accent-600/10 text-accent-200 hover:bg-accent-600/20"
          : "border border-line bg-base-850 text-ink-200 hover:bg-base-800",
      )}
    >
      {children}
    </button>
  );
}

const COR_STATUS: Record<UserStatus, string> = {
  ONLINE: "bg-signal-online",
  IDLE: "bg-signal-idle",
  DND: "bg-signal-dnd",
  OFFLINE: "bg-ink-600",
};
const ROTULO_STATUS: Record<UserStatus, string> = {
  ONLINE: "Online",
  IDLE: "Ausente",
  DND: "Nao perturbe",
  OFFLINE: "Offline",
};
