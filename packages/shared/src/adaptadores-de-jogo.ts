import { normalizarNome } from "./jogos";

/**
 * Adaptadores por jogo: o que o AETHER sabe fazer com cada um, DECLARADO.
 *
 * Detectar o jogo (o processo aberto) nao da acesso a lobby, party ou entrada.
 * Cada jogo diz aqui, explicitamente, o que tem por tras — e a tela so oferece
 * o que estiver declarado. Hoje nenhum jogo tem entrada automatica, porque
 * nenhum oferece API oficial para um terceiro colocar alguem numa party
 * (pesquisa em docs/ativo-agora.md). O que o adaptador acrescenta e o FLUXO
 * ASSISTIDO bem feito: o campo certo (Riot ID, nome Epic), validado, e a
 * instrucao de como usar.
 *
 * As quatro capacidades sao os papeis pedidos na especificacao
 * (GamePresenceProvider, GameSessionProvider, GameInviteProvider,
 * GameJoinProvider), num objeto so por jogo: separar em quatro registros
 * seria quatro listas para manter em sincronia sem nenhum jogo que precise.
 *
 * Mora em `@aether/shared` porque os dois lados usam: o gateway valida o
 * "como entrar" (o cliente nao e confiavel), a tela mostra rotulo, exemplo e
 * instrucao.
 */
export interface CapacidadesDeJogo {
  /** GamePresenceProvider: de onde vem "esta jogando". */
  presenca: "processo";
  /** GameSessionProvider: modo, mapa, lobby. `nenhuma` = nao mostramos nada disso. */
  sessao: "nenhuma";
  /** GameInviteProvider: o convite e do AETHER (avisa e traz a resposta). */
  convite: "aether";
  /** GameJoinProvider: `assistida` = a pessoa entra a mao com o que o anfitriao passou. */
  entrada: "assistida";
}

export interface AdaptadorDeJogo {
  id: string;
  /** nome para a tela */
  nome: string;
  capacidades: CapacidadesDeJogo;
  /** nomes detectados que sao este jogo, ja normalizados (`normalizarNome`) */
  nomes: string[];
  comoEntrar: {
    /** "Riot ID", "Nome na Epic"... */
    rotulo: string;
    exemplo: string;
    /** `null` = valido; texto = o problema. Sempre roda DEPOIS de `limparComoEntrar`. */
    validar: (valor: string) => string | null;
    /** o que quem vai entrar faz com o valor */
    instrucao: string;
  };
}

const ASSISTIDO: CapacidadesDeJogo = {
  presenca: "processo",
  sessao: "nenhuma",
  convite: "aether",
  entrada: "assistida",
};

/**
 * Riot ID: nome de 3 a 16 caracteres + "#" + tag de 3 a 5 letras/numeros.
 * Formato publico da Riot; o nome aceita espaco e acento.
 */
const RIOT_ID = /^[^#]{3,16}#[\p{L}\p{N}]{3,5}$/u;

/** Nome de exibicao da Epic: 3 a 16 caracteres. */
const NOME_EPIC = /^.{3,16}$/u;

/**
 * CS2: codigo de amigo da Steam (como o jogo mostra, ex. "ABCDE-FGHJ") ou o
 * link do perfil. Sao as duas coisas que o jogo e a Steam aceitam para
 * adicionar alguem.
 */
const CODIGO_CS2 = /^[A-Z0-9]{4,5}-[A-Z0-9]{4}$/i;
const PERFIL_STEAM = /^https:\/\/steamcommunity\.com\/(id|profiles)\/[\w-]+\/?$/i;

export const ADAPTADORES_DE_JOGO: AdaptadorDeJogo[] = [
  {
    id: "valorant",
    nome: "VALORANT",
    capacidades: ASSISTIDO,
    nomes: ["valorant"],
    comoEntrar: {
      rotulo: "Riot ID",
      exemplo: "Nome#BR1",
      validar: (v) => (RIOT_ID.test(v) ? null : "Use o Riot ID completo, como Nome#BR1."),
      instrucao: "No VALORANT: Social > Adicionar amigo com o Riot ID e peca o convite para a party.",
    },
  },
  {
    id: "fortnite",
    nome: "Fortnite",
    capacidades: ASSISTIDO,
    nomes: ["fortnite"],
    comoEntrar: {
      rotulo: "Nome na Epic",
      exemplo: "NomeEpic",
      validar: (v) => (NOME_EPIC.test(v) ? null : "O nome na Epic tem de 3 a 16 caracteres."),
      instrucao: "No Fortnite: Amigos > Adicionar amigo pelo nome na Epic e peca para entrar no esquadrao.",
    },
  },
  {
    id: "cs2",
    nome: "Counter-Strike 2",
    capacidades: ASSISTIDO,
    nomes: ["counter strike 2", "cs2", "counter strike global offensive"],
    comoEntrar: {
      rotulo: "Codigo de amigo ou perfil Steam",
      exemplo: "ABCDE-FGHJ",
      validar: (v) =>
        CODIGO_CS2.test(v) || PERFIL_STEAM.test(v)
          ? null
          : "Use o codigo de amigo do CS2 (ABCDE-FGHJ) ou o link do perfil Steam.",
      instrucao: "No CS2: Amigos > Adicionar amigo com o codigo (ou pela Steam) e peca o convite para o lobby.",
    },
  },
];

/**
 * Jogo sem adaptador: o convite funciona igual, com texto livre. Nao se
 * inventa formato para jogo que nao conhecemos.
 */
export const ADAPTADOR_GENERICO: AdaptadorDeJogo = {
  id: "generico",
  nome: "",
  capacidades: ASSISTIDO,
  nomes: [],
  comoEntrar: {
    rotulo: "Como entrar",
    exemplo: "nick, codigo da sala...",
    validar: () => null,
    instrucao: "Adicione no jogo e peca o convite por la.",
  },
};

export function adaptadorDoJogo(nomeDetectado: string): AdaptadorDeJogo {
  const n = normalizarNome(nomeDetectado);
  return ADAPTADORES_DE_JOGO.find((a) => a.nomes.includes(n)) ?? ADAPTADOR_GENERICO;
}
