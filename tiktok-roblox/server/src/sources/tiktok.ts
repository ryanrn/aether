/**
 * Conexao com a live do TikTok, via `tiktok-live-connector` (v2).
 *
 * DUAS DECISOES QUE PARECEM DETALHE E NAO SAO:
 *
 * 1. O import e DINAMICO e com especificador em variavel. Assim a ponte inteira
 *    sobe, responde e e testavel sem nenhum `npm install` — a biblioteca so e
 *    carregada quando `TIKTOK_SOURCE=live`. Como o especificador nao e literal,
 *    o TypeScript devolve `any` e o typecheck nao depende do pacote instalado;
 *    o preco e a tipagem estrutural declarada aqui embaixo, que e o unico ponto
 *    do sistema que precisa acompanhar mudanca de versao da biblioteca.
 *
 * 2. A leitura do payload e defensiva. A v2 entrega o protobuf CRU: o texto do
 *    comentario e `content` (era `comment` na v1) e o @ e `user.displayId` (era
 *    `user.uniqueId`). Ler os dois nomes custa uma linha e evita que uma
 *    atualizacao de dependencia deixe todo mundo sem nome na cabeca.
 */
import type { RawEvent } from "../types.ts";
import type { EventSource, SourceOptions, SourceState } from "./types.ts";

interface LiveUser {
  id?: string;
  displayId?: string;
  uniqueId?: string;
  nickname?: string;
  avatarThumb?: { urls?: string[] };
}

interface ChatPayload {
  user?: LiveUser;
  content?: string;
  comment?: string;
}

interface GiftPayload {
  user?: LiveUser;
  giftId?: string;
  repeatCount?: number;
  repeatEnd?: number;
  gift?: { name?: string; diamondCount?: number; type?: number };
}

interface LikePayload {
  user?: LiveUser;
  count?: number;
}

interface Connection {
  connect(): Promise<unknown>;
  disconnect(): Promise<void>;
  on(event: string, handler: (payload: never) => void): void;
  removeAllListeners(): void;
}

interface TikTokLib {
  TikTokLiveConnection: new (uniqueId: string, options: Record<string, unknown>) => Connection;
  WebcastEvent: Record<string, string>;
  ControlEvent: Record<string, string>;
}

const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;

function toViewer(user: LiveUser | undefined): RawEvent["viewer"] | null {
  const handle = user?.displayId ?? user?.uniqueId ?? "";
  const id = user?.id ?? handle;
  if (id === "") return null; // sem identidade nao da para ter boneco proprio
  return {
    id: `tiktok:${id}`,
    handle,
    nickname: user?.nickname ?? handle,
    avatarUrl: user?.avatarThumb?.urls?.[0] ?? null,
    robloxUserId: null,
  };
}

export function createTikTokSource({
  username,
  signApiKey,
  emit,
  onState,
}: SourceOptions & { username: string; signApiKey: string | null }): EventSource {
  let connection: Connection | null = null;
  let current: SourceState = "stopped";
  let attempt = 0;
  let stopping = false;
  let retryTimer: NodeJS.Timeout | null = null;

  function setState(state: SourceState, detail?: string): void {
    current = state;
    onState(state, detail);
  }

  function scheduleReconnect(reason: string): void {
    if (stopping) return;
    attempt += 1;
    /**
     * Backoff com jitter. O jitter nao e enfeite: varias lives reconectando no
     * mesmo instante batem no mesmo servidor de assinatura e tomam 429 juntas.
     */
    const base = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
    const delay = base / 2 + Math.random() * (base / 2);
    setState("offline", `${reason} — tentando de novo em ${Math.round(delay / 1000)}s`);
    retryTimer = setTimeout(() => void open(), delay);
    retryTimer.unref?.();
  }

  async function open(): Promise<void> {
    if (stopping) return;
    setState("connecting", `@${username}`);
    try {
      const specifier = "tiktok-live-connector";
      const lib = (await import(specifier)) as TikTokLib;
      const { TikTokLiveConnection, WebcastEvent, ControlEvent } = lib;

      const options: Record<string, unknown> = { processInitialData: false };
      if (signApiKey) options.signApiKey = signApiKey;

      const live = new TikTokLiveConnection(username, options);
      connection = live;

      live.on(WebcastEvent.CHAT ?? "chat", (payload: ChatPayload) => {
        const viewer = toViewer(payload.user);
        const text = payload.content ?? payload.comment ?? "";
        if (!viewer || text === "") return;
        emit({ source: "chat", viewer, text });
      });

      live.on(WebcastEvent.GIFT ?? "gift", (payload: GiftPayload) => {
        const viewer = toViewer(payload.user);
        if (!viewer) return;
        /**
         * Presente "streakable" (type 1) dispara um evento por tique enquanto a
         * pessoa segura o botao. So o fim da sequencia (`repeatEnd === 1`) vale
         * — sem isso, um presente vira trinta explosoes.
         */
        if (payload.gift?.type === 1 && payload.repeatEnd !== 1) return;
        const count = payload.repeatCount ?? 1;
        emit({
          source: "gift",
          viewer,
          text: "",
          params: {
            giftName: payload.gift?.name ?? payload.giftId ?? "presente",
            diamonds: (payload.gift?.diamondCount ?? 0) * count,
            count,
          },
        });
      });

      live.on(WebcastEvent.LIKE ?? "like", (payload: LikePayload) => {
        const viewer = toViewer(payload.user);
        if (!viewer) return;
        emit({ source: "like", viewer, text: "", params: { count: payload.count ?? 1 } });
      });

      live.on(WebcastEvent.FOLLOW ?? "follow", (payload: { user?: LiveUser }) => {
        const viewer = toViewer(payload.user);
        if (viewer) emit({ source: "follow", viewer, text: "" });
      });

      live.on(WebcastEvent.SHARE ?? "share", (payload: { user?: LiveUser }) => {
        const viewer = toViewer(payload.user);
        if (viewer) emit({ source: "share", viewer, text: "" });
      });

      live.on(ControlEvent.DISCONNECTED ?? "disconnected", () => {
        if (!stopping) scheduleReconnect("desconectado");
      });

      live.on(WebcastEvent.STREAM_END ?? "streamEnd", () => {
        // Live acabou: reconectar rapido nao adianta, so gasta limite de taxa.
        attempt = 4;
        scheduleReconnect("a live terminou");
      });

      live.on(ControlEvent.ERROR ?? "error", (error: unknown) => {
        console.error(`[tiktok:${username}] erro`, error);
      });

      await live.connect();
      attempt = 0;
      setState("connected", `@${username}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Cannot find (module|package)/i.test(message)) {
        // Falta a dependencia: reconectar em laco nao resolve, so polui o log.
        stopping = true;
        setState(
          "offline",
          'biblioteca ausente — rode "npm install" na pasta tiktok-roblox, ' +
            'ou use "npm run sim" para trabalhar sem live',
        );
        return;
      }
      scheduleReconnect(message);
    }
  }

  return {
    label: `@${username}`,
    state: () => current,
    start() {
      stopping = false;
      void open();
    },
    async stop() {
      stopping = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (connection) {
        connection.removeAllListeners();
        await connection.disconnect().catch(() => undefined);
        connection = null;
      }
      setState("stopped");
    },
  };
}
