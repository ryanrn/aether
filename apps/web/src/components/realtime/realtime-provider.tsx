"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@aether/shared";
import { createSocketTicketAction } from "@/server/actions/realtime";
import { useRealtimeStore } from "@/lib/stores/realtime-store";

/**
 * Dono da conexao com o gateway.
 *
 * Este componente nao guarda estado de aplicacao — ele traduz eventos do
 * socket para a store Zustand e devolve o socket para quem precisa emitir.
 *
 * Autenticacao: pedimos ao servidor um TICKET curto e de uso unico e o
 * enviamos no handshake. Em desenvolvimento o cookie de sessao tambem
 * funciona (app e gateway sao o mesmo site em localhost), mas em producao eles
 * ficam em dominios diferentes e o navegador nao envia cookie SameSite=Lax
 * para outro site. O ticket atravessa essa fronteira sem afrouxar o cookie da
 * aplicacao inteira.
 */

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const REALTIME_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000";

const SocketContext = createContext<TypedSocket | null>(null);

export function useSocket(): TypedSocket | null {
  return useContext(SocketContext);
}

/**
 * `serverId` e `null` nas telas que ficam FORA de um servidor — hoje, a de
 * amigos. O socket abre igual (e a sala pessoal do gateway que entrega a
 * presenca dos amigos), so o `server:join` nao acontece: nao ha servidor em
 * que entrar, e chamar com `null` faria o gateway recusar.
 */
export function RealtimeProvider({
  serverId,
  children,
}: {
  serverId: string | null;
  children: React.ReactNode;
}) {
  const [socket, setSocket] = useState<TypedSocket | null>(null);
  /** distingue a primeira conexao de uma reconexao — a segunda recupera o intervalo */
  const hadConnected = useRef(false);
  const router = useRouter();
  /**
   * `router.refresh()` mora numa ref para o efeito da conexao nao depender
   * dele: o router e recriado a cada render, e listar como dependencia
   * derrubaria e reabriria o socket sem motivo.
   */
  const refreshRef = useRef(() => router.refresh());
  refreshRef.current = () => router.refresh();

  // 1. conexao: criada uma vez e mantida entre navegacoes de canal
  useEffect(() => {
    let instance: TypedSocket | null = null;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Deixa um ticket novo em maos para a PROXIMA tentativa. O socket.io
     * reconecta sozinho e de forma sincrona — nao da para buscar credencial no
     * meio da tentativa, entao ela precisa estar pronta antes.
     */
    async function stageNextTicket(target: TypedSocket) {
      const ticket = await createSocketTicketAction();
      if (ticket) target.auth = { ticket };
    }

    void (async () => {
      const ticket = await createSocketTicketAction();
      if (cancelled) return;

      instance = io(REALTIME_URL, {
        path: "/ws",
        // Mantido para o caminho de desenvolvimento, onde o cookie basta.
        withCredentials: true,
        auth: ticket ? { ticket } : {},
        /**
         * Backoff exponencial explicito. O socket.io-client ja faz isso por
         * padrao, mas padrao implicito muda numa atualizacao de dependencia
         * sem ninguem notar. 1s -> 8s com jitter de 50% para nao sincronizar
         * todos os clientes num mesmo instante depois de uma queda.
         */
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 8000,
        randomizationFactor: 0.5,
      });

      const socketInstance = instance;

      socketInstance.on("connect", () => {
        const state = useRealtimeStore.getState();
        state.setConnectionStatus("online");
        state.setError(null);
        // O ticket usado agora ja foi consumido; prepara o proximo.
        void stageNextTicket(socketInstance);
      });

      socketInstance.on("disconnect", () => {
        const state = useRealtimeStore.getState();
        state.setConnectionStatus("offline");
        state.clearVolatile();
      });

      socketInstance.on("connect_error", () => {
        useRealtimeStore.getState().setConnectionStatus("offline");
        // Recusa pode ser ticket expirado ou ja usado: renova antes da
        // proxima tentativa do backoff.
        void stageNextTicket(socketInstance);
      });

      socketInstance.on("ready", ({ user }) => {
        useRealtimeStore.getState().setSelfUserId(user.id);
      });

      socketInstance.on("presence:sync", ({ serverId: incoming, entries }) => {
        const state = useRealtimeStore.getState();
        if (incoming !== state.serverId) return;
        state.syncPresence(entries);
      });

      socketInstance.on("presence:update", ({ serverId: incoming, entry }) => {
        const state = useRealtimeStore.getState();
        if (incoming !== state.serverId) return;
        state.updatePresence(entry);
      });

      /**
       * Presenca de amigo, pela sala pessoal. Sem `serverId` para conferir:
       * este evento nao pertence a servidor nenhum, e e exatamente por isso
       * que ele existe separado do `presence:update`.
       */
      socketInstance.on("friend:presence", ({ entry }) => {
        useRealtimeStore.getState().updatePresence(entry);
      });

      /**
       * `mergePresence`, nunca `syncPresence`: este evento chega tambem
       * enquanto voce esta dentro de um servidor, e substituir o mapa apagaria
       * a presenca de todo mundo dali.
       */
      socketInstance.on("friend:sync", ({ entries }) => {
        useRealtimeStore.getState().mergePresence(entries);
      });

      /**
       * A lista de amizades mudou. Igual ao `server:changed`: o evento nao
       * carrega o que mudou, so pede a tela nova ao Next — quem sabe montar
       * "pendente"/"aceito" e o servidor, e duplicar isso aqui seria uma
       * segunda versao da mesma consulta.
       */
      socketInstance.on("friend:changed", () => {
        refreshRef.current();
      });

      socketInstance.on("voice:sync", ({ serverId: incoming, participants }) => {
        const state = useRealtimeStore.getState();
        if (incoming !== state.serverId) return;
        state.syncVoice(participants);
      });

      socketInstance.on("voice:update", ({ serverId: incoming, participant }) => {
        const state = useRealtimeStore.getState();
        if (incoming !== state.serverId) return;
        state.updateVoice(participant);
      });

      /**
       * Fui movido de canal por um moderador. As credenciais novas vem junto
       * porque cada canal e uma sala propria no SFU — sem elas eu ficaria mudo
       * ate pedir acesso. O canal em si chega pelo voice:update.
       */
      socketInstance.on("voice:moved", ({ media }) => {
        useRealtimeStore.getState().setMedia(media);
      });

      socketInstance.on("message:new", ({ message, nonce }) => {
        useRealtimeStore.getState().receiveMessage(message, nonce);
      });

      /**
       * Fui removido do servidor. O gateway ja tirou este socket das salas, o
       * que corta o acesso; aqui so tiramos a pessoa de uma tela que nao existe
       * mais para ela.
       *
       * Carga completa da pagina, e nao navegacao do router, de proposito:
       * a barra de servidores mora no layout `/app`, COMPARTILHADO entre `/app`
       * e `/app/s/[serverId]`. Navegar entre as duas nao re-renderiza esse
       * layout, entao o icone do servidor continuava la — e clicar nele dava
       * 404. `router.refresh()` junto de `replace()` ainda disputava com a
       * navegacao.
       *
       * Despejo e evento raro; recarregar garante estado limpo e nao ha
       * beneficio em economizar aqui.
       */
      socketInstance.on("server:evicted", ({ serverId: incoming }) => {
        if (incoming !== useRealtimeStore.getState().serverId) return;
        window.location.assign("/app");
      });

      /**
       * Minha sessao nao vale mais (logout, revogacao, expiracao). O gateway
       * revalida periodicamente, e sem este aviso o socket cairia num retry
       * infinito e silencioso: `reconnectionAttempts: Infinity` tentaria de
       * novo a cada poucos segundos com um ticket que nunca vai validar,
       * sem a pessoa nunca saber que precisa logar de novo.
       *
       * Carga completa para /login, mesmo raciocinio do server:evicted: o
       * unload da pagina e o que garante que o loop de reconexao para de
       * verdade, em vez de so trocar o estado de uma tela que segue viva.
       */
      socketInstance.on("session:revoked", () => {
        window.location.assign("/login");
      });

      /**
       * A estrutura do servidor mudou (canal, categoria, cargo, acesso).
       *
       * O evento nao diz O QUE mudou de proposito — pedimos ao Next para
       * re-renderizar, e o servidor devolve a arvore ja filtrada pelas
       * permissoes de quem esta olhando. Sem isso, um canal criado agora so
       * aparecia para os outros depois de um F5.
       *
       * Debounce porque reordenar canal e uma sequencia de cliques: sem ele,
       * cada seta viraria um re-render para todo mundo no servidor.
       */
      socketInstance.on("server:changed", ({ serverId: incoming }) => {
        if (incoming !== useRealtimeStore.getState().serverId) return;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          refreshRef.current();
        }, 300);
      });

      setSocket(socketInstance);
    })();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      instance?.removeAllListeners();
      instance?.close();
      setSocket(null);
    };
  }, []);

  // 2. entrada no servidor, refeita a cada reconexao
  useEffect(() => {
    if (!socket) return;
    /**
     * Fora de servidor nao ha nada a entrar nem a limpar: `enterServer` zeraria
     * presenca, voz e mensagens, e o `friend:sync` que ja chegou junto com a
     * conexao seria perdido.
     */
    if (!serverId) return;
    // Amarrado numa const para o TypeScript manter o estreitamento dentro das
    // funcoes abaixo: `serverId` e `string | null`, e o guard acima nao
    // atravessa fronteira de closure.
    const alvo: string = serverId;
    useRealtimeStore.getState().enterServer(alvo);

    function join() {
      const reconnecting = hadConnected.current;
      hadConnected.current = true;

      socket?.emit("server:join", alvo, (result) => {
        const state = useRealtimeStore.getState();
        if (!result.ok) {
          state.setError(result.error);
          return;
        }
        state.setError(null);
        state.syncPresence(result.presence);
        if (reconnecting) recoverMissedMessages();
      });
    }

    /**
     * Recupera o intervalo perdido durante a queda.
     * Socket.IO reconecta sozinho, mas o que passou enquanto o socket estava
     * fora nao volta por magica: pedimos, por canal ja visitado, tudo que veio
     * depois da ultima mensagem que temos.
     */
    function recoverMissedMessages() {
      const state = useRealtimeStore.getState();
      for (const [channelId, messages] of Object.entries(state.messages)) {
        const last = [...messages].reverse().find((m) => !m.pending);
        if (!last) continue;
        socket?.emit(
          "message:history",
          { channelId, after: last.id },
          (result) => {
            if (!result.ok) return;
            useRealtimeStore
              .getState()
              .seedMessages(channelId, result.messages);
          },
        );
      }
    }

    if (socket.connected) join();
    socket.on("connect", join);

    return () => {
      socket.off("connect", join);
      if (socket.connected) socket.emit("server:leave", alvo);
    };
  }, [socket, serverId]);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}
