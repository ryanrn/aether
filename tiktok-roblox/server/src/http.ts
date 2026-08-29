/**
 * A API que o Roblox consulta. Tres rotas e nada de sessao: o cliente e um
 * script de servidor do Roblox, nao um navegador.
 *
 *   GET  /                          estado em texto, sem segredo nenhum
 *   GET  /health                    o mesmo em JSON, para monitor
 *   GET  /v1/games/:id/pull         a fila (long polling)
 *   POST /v1/games/:id/heartbeat    o jogo dizendo que esta vivo
 *
 * AUTENTICACAO: chave por jogo, no header `x-bridge-key`. Chave errada e jogo
 * inexistente respondem IGUAL, 404 — a mesma regra do resto do projeto: nao
 * confirmamos a existencia de um recurso para quem nao tem acesso a ele. Quem
 * varre a internet atras do tunel nao descobre nem que o jogo existe.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { env } from "./env.ts";
import type { GameRegistry } from "./games.ts";
import type { Hub } from "./hub.ts";

/**
 * Teto de acoes por resposta. Nao e limite de banda: e limite de trabalho por
 * volta do loop do Roblox. 200 bonecos invocados no mesmo frame engasgam o
 * servidor do jogo; 40 ele absorve.
 */
const MAX_BATCH = 40;
const MAX_BODY_BYTES = 4 * 1024;

function json(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(payload);
}

function notFound(response: ServerResponse): void {
  json(response, 404, { ok: false, erro: "nao encontrado" });
}

async function readBody(request: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("corpo grande demais");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function createHttpServer({ games, hub }: { games: GameRegistry; hub: Hub }) {
  const startedAt = Date.now();

  return createServer((request, response) => {
    void handle(request, response).catch((error) => {
      console.error("[http] rota falhou:", error);
      json(response, 500, { ok: false, erro: "falha interna" });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname === "/" && request.method === "GET") {
      const stats = hub.stats() as { conexoes: Array<{ tiktok: string; estado: string }> };
      const linhas = [
        "ponte TikTok -> Roblox",
        `no ar ha ${Math.round((Date.now() - startedAt) / 1000)}s (fonte: ${env.source})`,
        ...stats.conexoes.map((c) => `  @${c.tiktok}: ${c.estado}`),
        "",
        "GET /health para os numeros.",
      ];
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(`${linhas.join("\n")}\n`);
      return;
    }

    if (url.pathname === "/health" && request.method === "GET") {
      json(response, 200, { ok: true, uptime: process.uptime(), ...hub.stats() });
      return;
    }

    const route = /^\/v1\/games\/([a-z0-9_-]{1,32})\/(pull|heartbeat)$/.exec(url.pathname);
    if (!route) return notFound(response);

    const [, gameId = "", action = ""] = route;

    /**
     * A chave vem no header. O parametro `?key=` existe so para quem usa
     * `HttpService:GetAsync`, que nao manda header — e o README diz para
     * preferir o header, porque URL com segredo aparece em log de proxy.
     */
    const headerKey = request.headers["x-bridge-key"];
    const key = (Array.isArray(headerKey) ? headerKey[0] : headerKey) ?? url.searchParams.get("key");
    const game = games.authenticate(gameId, key ?? null);
    if (!game) return notFound(response);

    const runtime = hub.game(game.id);
    if (!runtime) return notFound(response);

    if (action === "pull") {
      if (request.method !== "GET") return notFound(response);
      const since = intParam(url, "since", 0);
      const max = Math.min(intParam(url, "max", MAX_BATCH), MAX_BATCH);
      const wait = Math.min(intParam(url, "wait", 0), env.longPollMaxMs);

      if (wait > 0) await runtime.queue.wait(since, wait);
      if (response.writableEnded) return; // o jogo desistiu no meio da espera

      const result = runtime.queue.pull(since, max);
      json(response, 200, {
        ok: true,
        agora: Date.now(),
        cursor: result.cursor,
        perdidas: result.dropped,
        fila: result.queued,
        acoes: result.actions,
      });
      return;
    }

    if (request.method !== "POST") return notFound(response);
    try {
      const body = await readBody(request);
      const payload = body === "" ? {} : (JSON.parse(body) as Record<string, number | string>);
      hub.heartbeat(game.id, payload);
      json(response, 200, { ok: true });
    } catch {
      json(response, 400, { ok: false, erro: "corpo invalido" });
    }
  }
}
