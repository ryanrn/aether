"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
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

export function RealtimeProvider({
  serverId,
  children,
}: {
  serverId: string;
  children: React.ReactNode;
}) {
  const [socket, setSocket] = useState<TypedSocket | null>(null);
  /** distingue a primeira conexao de uma reconexao — a segunda recupera o intervalo */
  const hadConnected = useRef(false);

  // 1. conexao: criada uma vez e mantida entre navegacoes de canal
  useEffect(() => {
    let instance: TypedSocket | null = null;
    let cancelled = false;

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

      setSocket(socketInstance);
    })();

    return () => {
      cancelled = true;
      instance?.removeAllListeners();
      instance?.close();
      setSocket(null);
    };
  }, []);

  // 2. entrada no servidor, refeita a cada reconexao
  useEffect(() => {
    if (!socket) return;
    useRealtimeStore.getState().enterServer(serverId);

    function join() {
      const reconnecting = hadConnected.current;
      hadConnected.current = true;

      socket?.emit("server:join", serverId, (result) => {
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
      if (socket.connected) socket.emit("server:leave", serverId);
    };
  }, [socket, serverId]);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}
