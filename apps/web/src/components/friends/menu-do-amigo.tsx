"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicUser } from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import {
  ContextMenu,
  ItemDoMenu,
  SeparadorDoMenu,
  useMenuDeContexto,
} from "@/components/ui/context-menu";
import { Modal } from "@/components/ui/modal";
import { CartaoDePerfil } from "@/components/profile/cartao-de-perfil";
import { useSocket } from "@/components/realtime/realtime-provider";
import { useAbrirConversa } from "@/lib/chat/use-abrir-conversa";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { useVozDoAmigo } from "@/lib/stores/voz-de-amigos-store";
import { useChamadaDm } from "@/lib/voice/use-chamada-dm";
import { useEntrarNaVoz } from "@/lib/voice/use-entrar-na-voz";
import { toast } from "@/lib/stores/toast-store";
import { estaPendente, useConvites, useJogoComAmigo } from "@/lib/use-convites";
import { ChamadaDoAmigo, caminhoDoCanal } from "./chamada-do-amigo";

/**
 * Menu de um amigo (botao direito na linha ou no cartao do "Ativo agora", ou
 * o botao "Mais"). CONTEXTUAL: cada item so aparece quando a acao existe de
 * verdade para aquela pessoa naquele momento.
 *
 * - Sempre: mensagem, perfil, ligar.
 * - Em call (que o gateway deixou voce ver): entrar no canal, ir para o
 *   servidor, ver quem esta na call. Canal cheio nao oferece "entrar".
 * - Jogando: ver atividade (o cartao de perfil mostra o jogo ao vivo).
 *
 * - Ele jogando: pedir para entrar (ou cancelar o pedido pendente).
 * - Voce jogando (detectado pelo app de desktop): convidar para o seu jogo.
 *
 * Nenhuma decisao de permissao aqui: o que chega em `useVozDoAmigo` ja foi
 * filtrado no gateway, e entrar/ligar/convidar sao revalidados la
 * (`voice:join`, `dmcall:ring`, `game-invite:send`). "Convidar para a call"
 * nao aparece porque nao existe — item que nao faz nada nao entra no menu.
 */
export function useMenuDoAmigo(user: PublicUser) {
  const router = useRouter();
  const socket = useSocket();
  const menu = useMenuDeContexto();
  const voz = useVozDoAmigo(user.id);
  const jogo = useRealtimeStore((estado) => estado.activity[user.id]?.game ?? null);
  const { abrir: abrirConversa } = useAbrirConversa();
  const { ligar } = useChamadaDm();
  const { entrar, canalAtual } = useEntrarNaVoz();
  const { jogoDoAmigo, meuJogo, pedido, convite } = useJogoComAmigo(user.id);
  const convites = useConvites();

  const [cartao, setCartao] = useState<DOMRect | null>(null);
  const [membros, setMembros] = useState(false);

  const jaEstouNaCall = voz !== null && canalAtual === voz.channelId;
  const cheio =
    voz !== null && voz.userLimit !== null && voz.total >= voz.userLimit && !jaEstouNaCall;

  /** Abre no botao "Mais": ancora no canto de baixo do botao, nao no cursor. */
  const abrirNoBotao = useCallback(
    (evento: React.MouseEvent<HTMLElement>) => {
      evento.stopPropagation();
      const r = evento.currentTarget.getBoundingClientRect();
      // O `ContextMenu` corrige se encostar na borda.
      menu.abrirEm({ x: r.right - 210, y: r.bottom + 4 });
    },
    [menu],
  );

  function fazer(acao: () => void) {
    return () => {
      menu.fechar();
      acao();
    };
  }

  function abrirCartao() {
    const { x, y } = menu.ponto ?? { x: window.innerWidth / 2, y: 120 };
    setCartao(new DOMRect(x, y, 0, 0));
  }

  /**
   * Ligar = abrir (ou achar) a conversa direta e tocar nela. O `dmcall:ring`
   * do gateway e quem decide se pode (bloqueio, amizade); a recusa volta como
   * aviso, pelo proprio `ligar`.
   */
  function iniciarChamada() {
    if (!socket) return;
    socket.emit("dm:open", { userId: user.id }, (resultado) => {
      if (!resultado.ok) {
        toast.erro(resultado.error);
        return;
      }
      ligar(resultado.dm.id, user);
      router.push(`/app/dm/${resultado.dm.id}`);
    });
  }

  const elemento = (
    <>
      <ContextMenu ponto={menu.ponto} onClose={menu.fechar} titulo={user.displayName}>
        <ItemDoMenu
          icone={<AetherIcon name="message" className="h-4 w-4" />}
          onClick={fazer(() => abrirConversa(user.id))}
        >
          Enviar mensagem
        </ItemDoMenu>
        <ItemDoMenu
          icone={<AetherIcon name="user" className="h-4 w-4" />}
          onClick={fazer(abrirCartao)}
        >
          {jogo ? "Ver perfil e atividade" : "Abrir perfil"}
        </ItemDoMenu>
        <ItemDoMenu
          icone={<AetherIcon name="phone" className="h-4 w-4" />}
          onClick={fazer(iniciarChamada)}
        >
          Iniciar chamada
        </ItemDoMenu>

        {jogoDoAmigo || meuJogo ? <SeparadorDoMenu /> : null}
        {jogoDoAmigo ? (
          estaPendente(pedido) ? (
            <ItemDoMenu
              icone={<AetherIcon name="x" className="h-4 w-4" />}
              onClick={fazer(() => convites.cancelar(pedido.id))}
            >
              Cancelar pedido para entrar
            </ItemDoMenu>
          ) : (
            <ItemDoMenu
              icone={<AetherIcon name="gamepad" className="h-4 w-4" />}
              onClick={fazer(() => convites.enviar(user.id, "pedir"))}
            >
              Pedir para entrar em {jogoDoAmigo}
            </ItemDoMenu>
          )
        ) : null}
        {meuJogo ? (
          estaPendente(convite) ? (
            <ItemDoMenu
              icone={<AetherIcon name="x" className="h-4 w-4" />}
              onClick={fazer(() => convites.cancelar(convite.id))}
            >
              Cancelar convite
            </ItemDoMenu>
          ) : (
            <ItemDoMenu
              icone={<AetherIcon name="user-plus" className="h-4 w-4" />}
              onClick={fazer(() => convites.enviar(user.id, "convidar"))}
            >
              Convidar para {meuJogo}
            </ItemDoMenu>
          )
        ) : null}

        {voz ? (
          <>
            <SeparadorDoMenu />
            <p className="truncate px-2 pb-1 pt-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">
              {voz.channelName} · {voz.serverName}
            </p>
            {jaEstouNaCall ? null : cheio ? (
              <ItemDoMenu
                icone={<AetherIcon name="lock" className="h-4 w-4" />}
                onClick={() => undefined}
                disabled
              >
                Canal cheio ({voz.total}/{voz.userLimit})
              </ItemDoMenu>
            ) : (
              <ItemDoMenu
                icone={<AetherIcon name="headset" className="h-4 w-4" />}
                onClick={fazer(() => {
                  entrar(voz.channelId);
                  router.push(caminhoDoCanal(voz));
                })}
              >
                Entrar no canal
              </ItemDoMenu>
            )}
            <ItemDoMenu
              icone={<AetherIcon name="server" className="h-4 w-4" />}
              onClick={fazer(() => router.push(caminhoDoCanal(voz)))}
            >
              Ir para o servidor
            </ItemDoMenu>
            <ItemDoMenu
              icone={<AetherIcon name="users" className="h-4 w-4" />}
              onClick={fazer(() => setMembros(true))}
            >
              Ver membros da call ({voz.total})
            </ItemDoMenu>
          </>
        ) : null}
      </ContextMenu>

      {cartao ? (
        <CartaoDePerfil user={user} ancora={cartao} onClose={() => setCartao(null)} />
      ) : null}

      <Modal
        open={membros && voz !== null}
        onClose={() => setMembros(false)}
        title={voz ? `Em ${voz.channelName}` : "Call"}
        description={voz?.serverName}
      >
        {voz ? <ChamadaDoAmigo voz={voz} membrosAbertosDeInicio /> : null}
      </Modal>
    </>
  );

  /**
   * So abre quando o clique foi DENTRO do alvo no DOM. O cartao de perfil e o
   * modal de membros sao portais filhos deste componente, e no React o evento
   * de portal sobe pela arvore de componentes: sem isto, clique direito dentro
   * deles abriria este menu por cima.
   */
  const abrir = useCallback(
    (evento: React.MouseEvent<HTMLElement>) => {
      if (!evento.currentTarget.contains(evento.target as Node)) return;
      menu.abrir(evento);
    },
    [menu],
  );

  return { abrir, abrirNoBotao, elemento };
}
