"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  UserStatus,
} from "@aether/shared";

/**
 * Conexao com o gateway.
 *
 * Um socket por aba, criado uma vez e mantido entre navegacoes — trocar de
 * canal nao derruba a conexao. A entrada no servidor e um efeito separado,
 * porque ela depende do `serverId` e a conexao nao.
 *
 * Nao passamos token nenhum daqui: o cookie de sessao e httpOnly e vai sozinho
 * no handshake, desde que `withCredentials` esteja ligado e a origem esteja
 * liberada no CORS do gateway. E por isso que o token nunca fica ao alcance de
 * um XSS nesta pagina.
 */

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const REALTIME_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000";

interface RealtimeValue {
  connected: boolean;
  /** presenca efetiva; quem nao esta no mapa esta offline */
  presence: Record<string, UserStatus>;
  statusOf: (userId: string) => UserStatus;
  setStatus: (status: UserStatus) => void;
  /** erro de entrada no servidor, se houver — util para nao falhar em silencio */
  error: string | null;
}

const RealtimeContext = createContext<RealtimeValue>({
  connected: false,
  presence: {},
  statusOf: () => "OFFLINE",
  setStatus: () => undefined,
  error: null,
});

export function useRealtime(): RealtimeValue {
  return useContext(RealtimeContext);
}

export function RealtimeProvider({
  serverId,
  children,
}: {
  serverId: string;
  children: React.ReactNode;
}) {
  const socketRef = useRef<TypedSocket | null>(null);
  const serverIdRef = useRef(serverId);
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState<Record<string, UserStatus>>({});
  const [error, setError] = useState<string | null>(null);

  serverIdRef.current = serverId;

  // 1. conexao — vive enquanto o provider viver
  useEffect(() => {
    const socket: TypedSocket = io(REALTIME_URL, {
      path: "/ws",
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setError(null);
    });
    socket.on("disconnect", () => {
      setConnected(false);
      // Presenca e conhecimento do gateway: sem conexao nao sabemos de nada,
      // e mostrar o ultimo estado conhecido como se fosse atual seria mentira.
      setPresence({});
    });
    socket.on("connect_error", () => {
      setConnected(false);
    });

    socket.on("presence:sync", ({ serverId: incoming, entries }) => {
      if (incoming !== serverIdRef.current) return;
      setPresence(Object.fromEntries(entries.map((e) => [e.userId, e.status])));
    });

    socket.on("presence:update", ({ serverId: incoming, entry }) => {
      if (incoming !== serverIdRef.current) return;
      setPresence((current) => {
        if (entry.status === "OFFLINE") {
          const { [entry.userId]: _gone, ...rest } = current;
          return rest;
        }
        return { ...current, [entry.userId]: entry.status };
      });
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  // 2. entrada no servidor — refeita a cada reconexao, senao o socket volta mudo
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    function join() {
      socket?.emit("server:join", serverId, (result) => {
        if (!result.ok) {
          setError(result.error);
          setPresence({});
          return;
        }
        setError(null);
        setPresence(
          Object.fromEntries(result.presence.map((e) => [e.userId, e.status])),
        );
      });
    }

    if (socket.connected) join();
    socket.on("connect", join);

    return () => {
      socket.off("connect", join);
      if (socket.connected) socket.emit("server:leave", serverId);
      setPresence({});
    };
  }, [serverId]);

  const statusOf = useCallback(
    (userId: string): UserStatus => presence[userId] ?? "OFFLINE",
    [presence],
  );

  const setStatus = useCallback((status: UserStatus) => {
    socketRef.current?.emit("presence:set", status);
  }, []);

  const value = useMemo<RealtimeValue>(
    () => ({ connected, presence, statusOf, setStatus, error }),
    [connected, presence, statusOf, setStatus, error],
  );

  return (
    <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
  );
}
