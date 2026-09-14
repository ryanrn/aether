import "server-only";

import { API_LIMITES } from "@aether/shared";
import { rateLimit, type RateLimitResult } from "@/server/auth/rate-limit";
import { erroApi } from "./resposta";
import type { NextResponse } from "next/server";

/**
 * Resultado de checar o rate limit de um bot.
 *
 * `headers` traz `X-RateLimit-Limit`/`X-RateLimit-Remaining` do limite MAIS
 * apertado entre os checados (global/servidor/canal) — o bot descobre o teto
 * ANTES de estourar, e nao so pelo `Retry-After` do 429. So faz sentido
 * quando `bloqueado` e `null`; anexar em cima do proprio `okApi(...)`.
 */
export interface LimiteBotResultado {
  bloqueado: NextResponse | null;
  headers: Record<string, string>;
}

/**
 * Rate limit da REST v1 — o MESMO mecanismo do login (`limitarJanelaDeslizante`
 * no Redis REST, com fallback em memória). Chaves separadas por app, servidor e
 * canal (ver `API_LIMITES`).
 *
 * Escrita é fail-CLOSED (Redis fora -> recusa, como o login); leitura é
 * fail-open (Redis fora -> libera, rate limit é defesa em profundidade).
 */
export async function limitarBot(params: {
  applicationId: string;
  serverId?: string;
  /** canal de destino — só no envio de mensagem */
  channelId?: string;
  /** `true` = POST/PATCH/DELETE (fail-closed); `false` = GET (fail-open) */
  escrita: boolean;
}): Promise<LimiteBotResultado> {
  const { applicationId, serverId, channelId, escrita } = params;
  const opts = { failClosed: escrita };

  const definicoes: Array<{ limite: number; check: Promise<RateLimitResult> }> = [
    {
      limite: API_LIMITES.global.limite,
      check: rateLimit(
        `bot:${applicationId}`,
        API_LIMITES.global.limite,
        API_LIMITES.global.janelaMs,
        opts,
      ),
    },
  ];

  if (serverId) {
    definicoes.push({
      limite: API_LIMITES.porServidor.limite,
      check: rateLimit(
        `bot:${applicationId}:srv:${serverId}`,
        API_LIMITES.porServidor.limite,
        API_LIMITES.porServidor.janelaMs,
        opts,
      ),
    });
  }

  if (channelId) {
    definicoes.push({
      limite: API_LIMITES.envioPorCanal.limite,
      check: rateLimit(
        `bot:${applicationId}:ch:${channelId}`,
        API_LIMITES.envioPorCanal.limite,
        API_LIMITES.envioPorCanal.janelaMs,
        opts,
      ),
    });
  }

  const resultados = await Promise.all(definicoes.map((d) => d.check));
  const estourado = resultados.find((r) => !r.ok);
  if (estourado) {
    return {
      bloqueado: erroApi("rate_limited", {
        headers: { "Retry-After": String(Math.max(1, estourado.retryAfter)) },
      }),
      headers: {},
    };
  }

  // O limite mais apertado (menor sobra) e o que vale a pena o bot ver — e o
  // que vai estourar primeiro se ele continuar no mesmo ritmo.
  let piorIndice = 0;
  let menorSobra = Infinity;
  resultados.forEach((r, i) => {
    const sobra = definicoes[i]!.limite - r.usado;
    if (sobra < menorSobra) {
      menorSobra = sobra;
      piorIndice = i;
    }
  });

  return {
    bloqueado: null,
    headers: {
      "X-RateLimit-Limit": String(definicoes[piorIndice]!.limite),
      "X-RateLimit-Remaining": String(Math.max(0, menorSobra)),
    },
  };
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
