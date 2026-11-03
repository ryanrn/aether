import type { PublicUser } from "./types";

/**
 * Convites para jogos — "pedir para entrar" e "convidar para jogar".
 *
 * INFRAESTRUTURA DO AETHER, NAO DO JOGO. Nenhum dos jogos prioritarios tem API
 * oficial para um terceiro colocar alguem numa party (ver
 * docs/ativo-agora.md). Entao o convite faz o que da para fazer de verdade:
 * avisa o outro em tempo real, recolhe a resposta e, no aceite, entrega o que
 * o ANFITRIAO escreveu sobre como entrar (Riot ID, codigo da party, nome
 * Epic). A entrada no jogo e manual — o fluxo assistido.
 *
 * Efemero de proposito: vive no gateway (memoria ou Redis) e some sozinho.
 * Convite de jogo vale pelos proximos minutos, nao e historico.
 */

/**
 * `pedir`: quem envia quer entrar no jogo de quem recebe (o anfitriao e o
 * DESTINATARIO). `convidar`: quem envia chama o outro para o proprio jogo (o
 * anfitriao e o REMETENTE).
 */
export type TipoDeConvite = "pedir" | "convidar";

export type EstadoDoConvite =
  | "pendente"
  | "aceito"
  | "recusado"
  | "cancelado"
  | "expirado";

export interface ConviteDeJogo {
  id: string;
  tipo: TipoDeConvite;
  de: PublicUser;
  para: PublicUser;
  /** quem esta jogando — `para` num pedido, `de` num convite */
  anfitriaoId: string;
  /** o jogo do anfitriao NO MOMENTO do envio, como o detector deu */
  jogo: string;
  /** capa do IGDB, se ja havia; validada no gateway (`safeGameCover`) */
  jogoCapa: string | null;
  estado: EstadoDoConvite;
  criadoEm: string;
  expiraEm: string;
  respondidoEm: string | null;
  /**
   * Como entrar, escrito pelo anfitriao — no aceite (pedido) ou no envio
   * (convite). Texto livre e curto; so chega ao outro lado.
   */
  comoEntrar: string | null;
}

export type CodigoDeRecusaDeConvite =
  | "invalido"
  | "nao_amigo"
  | "sem_jogo"
  | "limite"
  | "ritmo"
  | "nao_encontrado"
  | "expirado"
  | "ja_respondido";

export type ConviteAck =
  | { ok: true; convite: ConviteDeJogo }
  | { ok: false; codigo: CodigoDeRecusaDeConvite; error: string };

/** Pedido sem resposta expira em 5 minutos. */
export const CONVITE_VALIDADE_MS = 5 * 60_000;
/**
 * Depois de respondido/expirado, o convite fica mais 10 minutos para quem
 * recarregar a pagina ainda ver o "como entrar" do aceite.
 */
export const CONVITE_RETENCAO_MS = 10 * 60_000;
/** Quantos pedidos pendentes alguem pode ter ENVIADO ao mesmo tempo. */
export const CONVITES_ENVIADOS_MAX = 5;
/** Quantos pendentes alguem pode RECEBER ao mesmo tempo (varios remetentes). */
export const CONVITES_RECEBIDOS_MAX = 20;
export const COMO_ENTRAR_MAX = 120;

/**
 * Limpa o "como entrar": texto de cliente que vai para a tela de OUTRA pessoa.
 * Tira caracteres de controle (quebra de linha inclusa — e uma linha so),
 * poda, corta no maximo. Vazio vira `null`.
 */
export function limparComoEntrar(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const limpo = valor.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").trim();
  if (!limpo) return null;
  return limpo.slice(0, COMO_ENTRAR_MAX);
}

export function isTipoDeConvite(valor: unknown): valor is TipoDeConvite {
  return valor === "pedir" || valor === "convidar";
}
