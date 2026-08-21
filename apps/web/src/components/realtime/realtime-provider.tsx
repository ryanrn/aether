"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@aether/shared";
import { useRealtimeStore } from "@/lib/stores/realtime-store";

/**
 * Dono da conexao com o gateway.
 *
 * Este componente nao guarda estado de aplicacao — ele traduz eventos do
 * socket para a store Zustand e devolve o socket para quem precisa emitir.
 * A separacao importa: a conexao tem ciclo de vida de componente, o estado
 * nao.
 *
 * Nao passamos token nenhum daqui: o cookie de sessao e httpOnly e vai sozinho
 * no handshake, com `withCredentials`. Por isso o token nunca fica ao alcance
 * de um XSS nesta pagina.
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
  /** distingue a primeira conexao de uma reconexao — a segunda precisa recuperar o intervalo */
  const hadConnected = useRef(false);

  // 1. conexao: criada uma vez e mantida entre navegacoes de canal
  useEffect(() => {
    const store = useRealtimeStore.getState();

    const instance: TypedSocket = io(REALTIME_URL, {
      path: "/ws",
      withCredentials: true,
      /**
       * Backoff exponencial explicito. O socket.io-client ja faz isso por
       * padrao, mas padrao implicito muda numa atualizacao de dependencia sem
       * ninguem notar. 1s -> 8s com jitter de 50% para nao sincronizar todos
       * os clientes num mesmo instante depois de uma queda do gateway.
       */
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      randomizationFactor: 0.5,
    });

    instance.on("connect", () => {
      store.setConnectionStatus("online");
      store.setError(null);
    });

    instance.on("disconnect", () => {
      const state = useRealtimeStore.getState();
      state.setConnectionStatus("offline");
      state.clearVolatile();
    });

    instance.on("connect_error", () => {
      useRealtimeStore.getState().setConnectionStatus("offline");
    });

    instance.on("ready", ({ user }) => {
      useRealtimeStore.getState().setSelfUserId(user.id);
    });

    instance.on("presence:sync", ({ serverId: incoming, entries }) => {
      const state = useRealtimeStore.getState();
      if (incoming !== state.serverId) return;
      state.syncPresence(entries);
    });

    instance.on("presence:update", ({ serverId: incoming, entry }) => {
      const state = useRealtimeStore.getState();
      if (incoming !== state.serverId) return;
      state.updatePresence(entry);
    });

    instance.on("voice:sync", ({ serverId: incoming, participants }) => {
      const state = useRealtimeStore.getState();
      if (incoming !== state.serverId) return;
      state.syncVoice(participants);
    });

    instance.on("voice:update", ({ serverId: incoming, participant }) => {
      const state = useRealtimeStore.getState();
      if (incoming !== state.serverId) return;
      state.updateVoice(participant);
    });

    instance.on("message:new", ({ message, nonce }) => {
      useRealtimeStore.getState().receiveMessage(message, nonce);
    });

    setSocket(instance);

    return () => {
      instance.removeAllListeners();
      instance.close();
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
