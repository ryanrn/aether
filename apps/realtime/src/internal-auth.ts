import { timingSafeEqual } from "node:crypto";

/**
 * Decisao de autenticacao da porta interna (`/internal/*`) — pura, sem `env`,
 * para poder ser testada sem subir o gateway.
 *
 * POR QUE EXISTE UM SEGREDO PROPRIO. A porta interna morava no `AUTH_SECRET`,
 * o mesmo que assina sessao e ticket e deriva a chave que cifra o TOTP e os
 * tokens OAuth. Como esse valor viaja em header a cada chamada Vercel -> Fly,
 * qualquer vazamento dele (log de proxy, dump de requisicao) entregava tudo de
 * uma vez, inclusive `/internal/send-message`, que fala como QUALQUER usuario.
 * Com `INTERNAL_API_SECRET`, um vazamento aqui abre so esta porta.
 *
 * TRANSICAO SEM DERRUBAR PRODUCAO. Web e gateway sao deploys separados
 * (Vercel e Fly): nao existe momento em que os dois trocam juntos. Entao,
 * com `INTERNAL_API_SECRET` definido, o gateway aceita os DOIS valores ate
 * `INTERNAL_API_ACEITA_LEGADO=nao` ser posto — o que so deve acontecer depois
 * de o web ja estar enviando o novo. Sem `INTERNAL_API_SECRET`, o
 * comportamento e exatamente o de antes (so `AUTH_SECRET`).
 */

export interface ConfigSegredoInterno {
  /** `AUTH_SECRET` — o valor antigo, ainda aceito enquanto `aceitaLegado`. */
  authSecret: string;
  /** `INTERNAL_API_SECRET`, ou `null` se ainda nao foi configurado. */
  internalApiSecret: string | null;
  /** `false` fecha a porta para o `AUTH_SECRET` (fim da transicao). */
  aceitaLegado: boolean;
}

/** Qual valor autenticou a chamada — o gateway avisa quando ainda e o legado. */
export type ProvaInterna = "dedicado" | "legado";

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  // `timingSafeEqual` lanca com tamanhos diferentes; comparar tamanho antes
  // vaza so o comprimento, que nao e o segredo.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verificarSegredoInterno(
  fornecido: string | undefined,
  config: ConfigSegredoInterno,
): ProvaInterna | null {
  if (!fornecido) return null;

  // Sempre as DUAS comparacoes, sem curto-circuito: quem mede o tempo nao
  // deve descobrir por ele qual dos valores estava sendo tentado.
  const bateDedicado =
    config.internalApiSecret !== null &&
    iguais(fornecido, config.internalApiSecret);
  const bateLegado = iguais(fornecido, config.authSecret);

  if (bateDedicado) return "dedicado";

  // Sem segredo dedicado configurado, o `AUTH_SECRET` e a unica credencial
  // que existe (comportamento anterior). Com ele configurado, so vale
  // enquanto a transicao estiver aberta.
  if (bateLegado && (config.internalApiSecret === null || config.aceitaLegado)) {
    return "legado";
  }
  return null;
}
