import "server-only";

import { log } from "@aether/shared/log";

/**
 * Verificacao do Cloudflare Turnstile (CAPTCHA) no servidor.
 *
 * Sem SDK — um POST com form-urlencoded, como o `email.ts` (Resend) e o
 * `sentry.ts`. O widget no cliente produz um token; aqui a gente pergunta ao
 * Cloudflare se ele e valido, UMA vez (o token e de uso unico do lado deles).
 *
 * OPCIONAL: sem `TURNSTILE_SECRET_KEY` a verificacao e PULADA (devolve `true`).
 * Em dev isso e o normal. Em producao, configurar as duas chaves
 * (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` no cliente, `TURNSTILE_SECRET_KEY` aqui)
 * liga a protecao. Mesma escolha do Redis e do Sentry: a feature nao pode
 * derrubar o boot por falta de credencial.
 */

const ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Turnstile so conta como "ligado" com as DUAS chaves. Meia configuracao — o
 * segredo no servidor mas a site key ausente do bundle — trancaria todo mundo
 * para fora do cadastro: o widget nao renderiza, o cliente nao manda token, e
 * `verificarTurnstile(undefined)` recusaria. Exigir as duas transforma esse
 * erro de deploy num no-op seguro.
 */
export function turnstileConfigurado(): boolean {
  return Boolean(
    process.env.TURNSTILE_SECRET_KEY &&
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  );
}

/**
 * `true` se o token e valido — ou se o Turnstile nao esta configurado.
 *
 * FALHA ABERTO num erro de REDE (Cloudflare fora do ar), mas FECHADO num token
 * ausente ou recusado. O raciocinio: um usuario legitimo que passou pelo
 * widget nao pode ser barrado porque o siteverify teve um soluco; mas uma
 * requisicao sem token nenhum e um bot que nem tentou.
 */
export async function verificarTurnstile(
  token: string | undefined | null,
  ip?: string | null,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  // Precisa das DUAS: sem a site key, o cliente nunca vai mandar token.
  if (!secret || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return true;

  if (!token || typeof token !== "string") return false;

  const corpo = new URLSearchParams({ secret, response: token });
  if (ip) corpo.set("remoteip", ip);

  try {
    const resposta = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: corpo,
      signal: AbortSignal.timeout(5000),
    });
    if (!resposta.ok) {
      log.warn("web.turnstile.http", "siteverify respondeu erro — liberando", {
        status: resposta.status,
      });
      return true; // fail-open em erro de infra
    }
    const dados = (await resposta.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (!dados.success) {
      log.warn("web.turnstile.recusado", "Turnstile recusou o token", {
        erros: dados["error-codes"] ?? [],
      });
    }
    return Boolean(dados.success);
  } catch (erro) {
    log.warn("web.turnstile.falhou", "não consegui verificar o Turnstile — liberando", {
      err: erro,
    });
    return true; // fail-open em erro de rede
  }
}
