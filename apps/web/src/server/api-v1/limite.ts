import "server-only";

import { API_LIMITES } from "@aether/shared";
import { rateLimit } from "@/server/auth/rate-limit";
import { erroApi } from "./resposta";
import type { NextResponse } from "next/server";

/**
 * Rate limit da REST v1 — o MESMO mecanismo do login (`limitarJanelaDeslizante`
 * no Redis REST, com fallback em memória). Chaves separadas por app, servidor e
 * canal (ver `API_LIMITES`).
 *
 * Escrita é fail-CLOSED (Redis fora -> recusa, como o login); leitura é
 * fail-open (Redis fora -> libera, rate limit é defesa em profundidade).
 *
 * Devolve `null` quando passou, ou a resposta `429` já pronta (com
 * `Retry-After`) quando estourou.
 */
export async function limitarBot(params: {
  applicationId: string;
  serverId?: string;
  /** canal de destino — só no envio de mensagem */
  channelId?: string;
  /** `true` = POST/PATCH/DELETE (fail-closed); `false` = GET (fail-open) */
  escrita: boolean;
}): Promise<NextResponse | null> {
  const { applicationId, serverId, channelId, escrita } = params;
  const opts = { failClosed: escrita };

  const checagens: Array<Promise<{ ok: boolean; retryAfter: number }>> = [
    rateLimit(
      `bot:${applicationId}`,
      API_LIMITES.global.limite,
      API_LIMITES.global.janelaMs,
      opts,
    ),
  ];

  if (serverId) {
    checagens.push(
      rateLimit(
        `bot:${applicationId}:srv:${serverId}`,
        API_LIMITES.porServidor.limite,
        API_LIMITES.porServidor.janelaMs,
        opts,
      ),
    );
  }

  if (channelId) {
    checagens.push(
      rateLimit(
        `bot:${applicationId}:ch:${channelId}`,
        API_LIMITES.envioPorCanal.limite,
        API_LIMITES.envioPorCanal.janelaMs,
        opts,
      ),
    );
  }

  const resultados = await Promise.all(checagens);
  const estourado = resultados.find((r) => !r.ok);
  if (!estourado) return null;

  return erroApi("rate_limited", {
    headers: { "Retry-After": String(Math.max(1, estourado.retryAfter)) },
  });
}

/**
 * Rate limit de um webhook de entrada — chave `rl:wh:<id>`. Fail-closed
 * (webhook so faz escrita). Devolve `null` (passou) ou o `429` pronto.
 */
export async function limitarWebhook(
  webhookId: string,
): Promise<NextResponse | null> {
  const r = await rateLimit(
    `wh:${webhookId}`,
    API_LIMITES.webhook.limite,
    API_LIMITES.webhook.janelaMs,
    { failClosed: true },
  );
  if (r.ok) return null;
  return erroApi("rate_limited", {
    headers: { "Retry-After": String(Math.max(1, r.retryAfter)) },
  });
}
