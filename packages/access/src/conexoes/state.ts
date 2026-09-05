import { SignJWT, jwtVerify } from "jose";
import type { ConnectionProvider } from "@aether/db";

/**
 * O `state` do fluxo de login: anti-CSRF amarrado ao par (usuario, provedor).
 *
 * POR QUE O PROVEDOR ENTRA: o `state` antigo carregava so o `sub` (usuario) e
 * tinha audiencia `aether-spotify-state`. Com um provedor so, inofensivo. Com
 * dois, um `state` emitido para o Spotify passaria na verificacao do callback
 * do Twitch — bastaria comecar um fluxo de Spotify e entregar aquele `state`
 * na outra rota. Amarrando o provedor, um `state` so serve para o fluxo que o
 * gerou.
 *
 * DEZ MINUTOS de validade: tempo de sobra para autorizar numa aba, e curto o
 * bastante para um `state` vazado nao valer nada depois.
 *
 * Nao guarda nada no servidor de proposito — o JWT assinado JA e a prova. Uma
 * tabela de states pendentes precisaria de limpeza, e um `state` que expira
 * sozinho nao precisa.
 */

const AUDIENCE = "aether-conexao-state";

function chave(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET ausente/curto.");
  }
  return new TextEncoder().encode(secret);
}

export async function assinarStateDeConexao(
  userId: string,
  provider: ConnectionProvider,
): Promise<string> {
  return new SignJWT({ provider })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience(AUDIENCE)
    .setExpirationTime("600s")
    .sign(chave());
}

export interface StateDeConexao {
  userId: string;
  provider: ConnectionProvider;
}

/**
 * Le o `state`, ou `null` se ele nao presta (assinatura errada, vencido,
 * audiencia trocada, sem provedor).
 *
 * Devolver `null` em vez de lancar: para quem chama, "nao consegui confirmar"
 * e uma resposta so, independente do motivo — e detalhar o motivo na tela
 * ajudaria mais quem esta atacando do que quem esta usando.
 */
export async function verificarStateDeConexao(
  state: string,
): Promise<StateDeConexao | null> {
  try {
    const { payload } = await jwtVerify(state, chave(), {
      issuer: "aether",
      audience: AUDIENCE,
    });
    const provider = payload.provider;
    if (typeof payload.sub !== "string" || typeof provider !== "string") {
      return null;
    }
    return { userId: payload.sub, provider: provider as ConnectionProvider };
  } catch {
    return null;
  }
}
