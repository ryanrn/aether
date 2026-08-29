/**
 * O miolo: pega evento cru da fonte, aplica os limites, vira acao e enfileira.
 *
 * Tambem e quem cuida do ciclo de vida das conexoes. Um jogo aponta para uma
 * conta do TikTok; contas iguais compartilham UMA conexao (abrir duas para o
 * mesmo @ so acelera o limite de taxa do TikTok), e conexao sem nenhum jogo
 * apontando para ela e fechada.
 */
import { env } from "./env.ts";
import { parseEvent } from "./commands.ts";
import { createQueue, type ActionQueue } from "./queue.ts";
import { createCooldown, createDedupe, createTokenBucket } from "./rate-limit.ts";
import { resolveRobloxUserId } from "./roblox-users.ts";
import { createSimulatorSource } from "./sources/simulator.ts";
import { createTikTokSource } from "./sources/tiktok.ts";
import type { EventSource, SourceState } from "./sources/types.ts";
import type { Doorbell } from "./push.ts";
import type { Action, GameConfig, RawEvent } from "./types.ts";

/** Quanto tempo uma conta vinculada do Roblox continua valendo. */
const LINK_TTL_MS = 6 * 60 * 60 * 1000;
const LINK_MAX = 5_000;

interface GameRuntime {
  config: GameConfig;
  queue: ActionQueue;
  /** Ultimo sinal de vida vindo do jogo, para saber se o host caiu. */
  lastHeartbeat: number | null;
  heartbeat: Record<string, number | string> | null;
  accepted: number;
  rejected: number;
}

export interface Hub {
  game(id: string): GameRuntime | null;
  reconcile(games: GameConfig[]): void;
  heartbeat(gameId: string, payload: Record<string, number | string>): void;
  stats(): Record<string, unknown>;
  stop(): Promise<void>;
}

export function createHub({ doorbell }: { doorbell: Doorbell }): Hub {
  const games = new Map<string, GameRuntime>();
  /** username do TikTok -> conexao. */
  const sources = new Map<string, { source: EventSource; state: SourceState; detail: string }>();
  const links = new Map<string, { robloxUserId: number; expiresAt: number }>();

  const viewerBucket = createTokenBucket({
    capacity: env.viewerRateCapacity,
    refillPerSecond: env.viewerRateRefillPerSec,
  });
  const globalBucket = createTokenBucket({
    capacity: Math.max(env.globalRatePerSec * 2, 10),
    refillPerSecond: env.globalRatePerSec,
  });
  const dedupe = createDedupe({ windowMs: env.dedupeWindowMs });
  const cooldown = createCooldown();

  function linkedIdFor(viewerId: string): number | null {
    const link = links.get(viewerId);
    if (!link) return null;
    if (link.expiresAt < Date.now()) {
      links.delete(viewerId);
      return null;
    }
    return link.robloxUserId;
  }

  function remember(viewerId: string, robloxUserId: number): void {
    if (links.size >= LINK_MAX) {
      // Mapa cheio: descarta o mais antigo inserido. Map preserva a ordem.
      const oldest = links.keys().next();
      if (!oldest.done) links.delete(oldest.value);
    }
    links.set(viewerId, { robloxUserId, expiresAt: Date.now() + LINK_TTL_MS });
  }

  function enqueue(runtime: GameRuntime, action: Omit<Action, "seq">): void {
    const stored = runtime.queue.push(action);
    runtime.accepted += 1;
    if (runtime.config.universeId) {
      doorbell.ring(runtime.config.universeId, runtime.config.id, stored.seq);
    }
  }

  /**
   * Ordem dos filtros, do mais barato para o mais caro — e nao e so
   * micro-otimizacao: o dedupe roda ANTES do balde de proposito, para que
   * comentario repetido nao consuma o token de quem esta so animado.
   */
  function ingest(runtime: GameRuntime, event: RawEvent): void {
    const { config } = runtime;

    if (event.source === "chat") {
      const fingerprint = `${config.id}|${event.viewer.id}|${event.text}`;
      if (!dedupe.accept(fingerprint)) {
        runtime.rejected += 1;
        return;
      }
    }

    const parsed = parseEvent(event, {
      profile: config.profile,
      spawnOnAnyComment: config.spawnOnAnyComment,
    });
    if (!parsed) return;

    if (parsed.rule?.cooldownMs) {
      if (!cooldown.ready(`${config.id}|${event.viewer.id}|${parsed.kind}`, parsed.rule.cooldownMs)) {
        runtime.rejected += 1;
        return;
      }
    }

    if (!viewerBucket.take(`${config.id}|${event.viewer.id}`)) {
      runtime.rejected += 1;
      return;
    }
    if (!globalBucket.take(config.id)) {
      runtime.rejected += 1;
      return;
    }

    const viewer = { ...event.viewer, robloxUserId: linkedIdFor(event.viewer.id) };

    /**
     * "roblox <usuario>" e o unico comando que espera rede. Nao da para segurar
     * o resto da fila esperando: resolve em paralelo e, quando volta, entra
     * como um spawn — ja com o avatar certo.
     */
    if (parsed.kind === "link") {
      const username = String(parsed.params.arg ?? "");
      if (!env.resolveRobloxUsers) return;
      void resolveRobloxUserId(username).then((robloxUserId) => {
        if (robloxUserId === null) return;
        remember(event.viewer.id, robloxUserId);
        enqueue(runtime, {
          at: Date.now(),
          kind: "spawn",
          keyword: parsed.keyword,
          source: event.source,
          viewer: { ...viewer, robloxUserId },
          params: { text: `@${username}`, linked: true },
        });
      });
      return;
    }

    enqueue(runtime, {
      at: Date.now(),
      kind: parsed.kind,
      keyword: parsed.keyword,
      source: event.source,
      viewer,
      params: parsed.params,
    });
  }

  function ensureSource(username: string): void {
    if (sources.has(username)) return;

    const entry = {
      source: null as unknown as EventSource,
      state: "connecting" as SourceState,
      detail: "",
    };

    const emit = (event: RawEvent): void => {
      for (const runtime of games.values()) {
        if (runtime.config.tiktok === username) ingest(runtime, event);
      }
    };
    const onState = (state: SourceState, detail = ""): void => {
      entry.state = state;
      entry.detail = detail;
      console.log(`[fonte ${username}] ${state}${detail ? ` — ${detail}` : ""}`);
    };

    entry.source =
      env.source === "simulator"
        ? createSimulatorSource({ emit, onState, intervalMs: env.simIntervalMs })
        : createTikTokSource({ username, signApiKey: env.signApiKey, emit, onState });

    sources.set(username, entry);
    entry.source.start();
  }

  return {
    game: (id) => games.get(id) ?? null,

    reconcile(list) {
      const wanted = new Set(list.map((game) => game.id));

      for (const game of list) {
        const existing = games.get(game.id);
        if (existing) {
          // Trocar chave ou perfil NAO pode zerar a fila: o jogo esta rodando.
          existing.config = game;
        } else {
          games.set(game.id, {
            config: game,
            queue: createQueue({ capacity: env.queueCapacity, ttlMs: env.actionTtlMs }),
            lastHeartbeat: null,
            heartbeat: null,
            accepted: 0,
            rejected: 0,
          });
        }
      }

      for (const [id, runtime] of games) {
        if (wanted.has(id)) continue;
        runtime.queue.stop();
        games.delete(id);
      }

      const usernames = new Set(list.map((game) => game.tiktok));
      for (const username of usernames) ensureSource(username);
      for (const [username, entry] of sources) {
        if (usernames.has(username)) continue;
        void entry.source.stop();
        sources.delete(username);
      }
    },

    heartbeat(gameId, payload) {
      const runtime = games.get(gameId);
      if (!runtime) return;
      runtime.lastHeartbeat = Date.now();
      runtime.heartbeat = payload;
    },

    stats() {
      return {
        source: env.source,
        conexoes: [...sources.entries()].map(([username, entry]) => ({
          tiktok: username,
          estado: entry.state,
          detalhe: entry.detail,
        })),
        jogos: [...games.values()].map((runtime) => ({
          id: runtime.config.id,
          nome: runtime.config.name,
          tiktok: runtime.config.tiktok,
          aceitas: runtime.accepted,
          recusadas: runtime.rejected,
          ...runtime.queue.stats(),
          ultimoSinalDeVidaMs:
            runtime.lastHeartbeat === null ? null : Date.now() - runtime.lastHeartbeat,
          jogo: runtime.heartbeat,
        })),
        vinculos: links.size,
      };
    },

    async stop() {
      for (const entry of sources.values()) await entry.source.stop();
      for (const runtime of games.values()) runtime.queue.stop();
      viewerBucket.stop();
      globalBucket.stop();
      dedupe.stop();
      cooldown.stop();
    },
  };
}
