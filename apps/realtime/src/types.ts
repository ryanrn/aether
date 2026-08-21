import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@aether/shared";

/**
 * Socket.IO tipado com os contratos de @aether/shared. Um alias em vez de
 * repetir os quatro parametros genericos em cada arquivo — e, mais importante,
 * um lugar so para trocar se os contratos mudarem.
 */
export type AetherServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export type AetherSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
