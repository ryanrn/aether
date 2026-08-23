/**
 * Normalizacao de nome de jogo e casamento com o resultado do IGDB.
 *
 * Tudo aqui e FUNCAO PURA, sem rede e sem banco, porque e a parte que decide
 * se a capa mostrada e do jogo certo — e a unica forma de ter confianca nisso
 * e poder testar com uma lista de casos reais em vez de abrir jogo por jogo.
 *
 * Contexto que explica o desenho: o detector do Aether NAO entrega nome de
 * executavel. Ele entrega o que a loja diz — `appmanifest_*.acf` na Steam,
 * `DisplayName` na Epic. Entao o nome que chega aqui ja e quase sempre o nome
 * oficial, e o trabalho e casar duas grafias do MESMO nome ("ELDEN RING" x
 * "Elden Ring"), nao adivinhar de que jogo se trata.
 *
 * Por isso o corte de confianca e alto e nao aceitamos o primeiro resultado
 * que o IGDB devolver: errar aqui poe a capa de um jogo na atividade de outro,
 * na tela de outras pessoas.
 */

/** Palavras que distinguem edicao, nao jogo. Usadas so no casamento afrouxado. */
const SUFIXOS_DE_EDICAO = [
  "remastered",
  "remaster",
  "definitive edition",
  "definitive",
  "goty",
  "game of the year edition",
  "game of the year",
  "enhanced edition",
  "enhanced",
  "complete edition",
  "deluxe edition",
  "ultimate edition",
  "director's cut",
  "directors cut",
  "anniversary edition",
  "hd",
];

/**
 * A forma canonica de um nome, para servir de chave de cache e de comparacao.
 *
 * O que sai:
 *  - minusculas;
 *  - `.exe` no fim (o detector nao manda, mas o cadastro manual da fase 3 vai);
 *  - simbolos de marca (™ ® ©), que aparecem em nome de manifesto;
 *  - pontuacao vira espaco, e espacos colapsam.
 *
 * O que **fica**, de proposito: DIGITOS. "Portal 2", "Cyberpunk 2077" e
 * "Grand Theft Auto V" viram jogos diferentes se os numeros sumirem — e
 * remover numero e o tipo de "limpeza" que parece esperta ate juntar duas
 * sequencias na mesma linha do cache.
 */
export function normalizarNome(bruto: string): string {
  return String(bruto)
    .toLowerCase()
    .replace(/\.exe$/i, "")
    .replace(/[™®©]/g, "")
    // Apostrofo some SEM virar espaco: "marvel's" e "marvels" sao a mesma
    // palavra, e trocar por espaco criaria "marvel s".
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** O nome sem a parte que so diz qual EDICAO e. */
export function semEdicao(normalizado: string): string {
  let resultado = normalizado;
  for (const sufixo of SUFIXOS_DE_EDICAO) {
    if (resultado.endsWith(` ${sufixo}`)) {
      resultado = resultado.slice(0, -(sufixo.length + 1)).trim();
    }
  }
  return resultado;
}

/**
 * Quebra "HollowKnight" em "hollow knight".
 *
 * Serve como candidato SECUNDARIO de busca, nunca como chave: acontece quando
 * a leitura do `appmanifest` falha e sobra o nome cru da pasta. Aplicar isso
 * sempre estragaria nomes legitimos ("PlayStation" viraria "play station").
 */
export function separarCamelCase(bruto: string): string {
  return normalizarNome(
    String(bruto)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"),
  );
}

/**
 * Quao parecidos sao dois nomes, de 0 a 1.
 *
 * Em degraus, do mais seguro para o mais frouxo — que e o que a especificacao
 * pediu e tambem o que evita o pior caso (aceitar o primeiro resultado da
 * busca so porque veio primeiro):
 *
 *  1,00  identicos depois de normalizar
 *  0,90  identicos ignorando a edicao ("Spider-Man" x "Spider-Man Remastered")
 *  0,75  um contem o outro inteiro, como palavra
 *  0,00  qualquer outra coisa
 *
 * O ultimo degrau e ZERO, e nao "algum valor pequeno", de proposito: sem
 * evidencia de que e o mesmo jogo, a resposta certa e nao ter capa — e nao
 * uma capa provavelmente errada.
 */
export function semelhanca(a: string, b: string): number {
  const na = normalizarNome(a);
  const nb = normalizarNome(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;

  const ea = semEdicao(na);
  const eb = semEdicao(nb);
  if (ea.length > 0 && ea === eb) return 0.9;

  const maior = na.length >= nb.length ? na : nb;
  const menor = na.length >= nb.length ? nb : na;
  if (menor.length >= 3 && ` ${maior} `.includes(` ${menor} `)) {
    /**
     * Conter o outro nao basta. O que sobra decide:
     *
     *   "witcher 3"  dentro de "the witcher 3 wild hunt"  -> sobra "the wild
     *                hunt": subtitulo, MESMO jogo.
     *   "portal"     dentro de "portal 2"                 -> sobra "2":
     *                numero de sequencia, OUTRO jogo.
     *
     * Sem esta distincao a capa de Portal ia para quem joga Portal 2 — e foi
     * exatamente isso que o teste pegou. O erro nao levanta excecao nenhuma:
     * so aparece uma imagem plausivel e errada na tela dos outros.
     */
    const restantes = maior
      .split(" ")
      .filter((palavra) => !menor.split(" ").includes(palavra));
    const temSequencia = restantes.some((palavra) => ehSequencia(palavra));
    if (!temSequencia) return 0.75;
  }

  return 0;
}

/** Um numero de sequencia — arabico ou romano. */
function ehSequencia(palavra: string): boolean {
  if (/^\d+$/.test(palavra)) return true;
  return /^(i{1,3}|iv|vi{0,3}|ix|xi{0,3}|x)$/.test(palavra);
}

/** Abaixo disto nao usamos o resultado: melhor sem capa do que com a errada. */
export const CONFIANCA_MINIMA = 0.75;

/** Acima disto confiamos no nome do IGDB mais do que no do detector. */
export const CONFIANCA_PARA_RENOMEAR = 0.9;

export interface CandidatoIgdb {
  id: number;
  name: string;
  coverImageId: string | null;
  genre: string | null;
}

export interface Casamento {
  candidato: CandidatoIgdb;
  confianca: number;
}

/**
 * O melhor candidato do IGDB para um nome detectado, ou `null`.
 *
 * Empate e resolvido pelo MENOR id do IGDB, que na pratica e a entrada
 * principal do jogo — as reedicoes e ports entram depois e recebem ids
 * maiores. Sem esse criterio a escolha dependeria da ordem que a API
 * devolveu, e a capa podia trocar sozinha entre uma consulta e outra.
 */
export function melhorCasamento(
  nomeDetectado: string,
  candidatos: CandidatoIgdb[],
): Casamento | null {
  let melhor: Casamento | null = null;
  for (const candidato of candidatos) {
    const confianca = semelhanca(nomeDetectado, candidato.name);
    if (confianca < CONFIANCA_MINIMA) continue;
    if (
      !melhor ||
      confianca > melhor.confianca ||
      (confianca === melhor.confianca && candidato.id < melhor.candidato.id)
    ) {
      melhor = { candidato, confianca };
    }
  }
  return melhor;
}

/**
 * A URL da capa a partir do `image_id`.
 *
 * `t_cover_big` da 264x374 — retrato de capa de verdade, nao o icone de 48px
 * que se extrai do executavel. Era esse o motivo real de a atividade parecer
 * pobre, e nao a falta de um provedor de metadados.
 *
 * Devolve `null` quando nao ha `image_id`: montar a URL assim mesmo produziria
 * uma imagem quebrada na tela de todo mundo, que e o que a especificacao pede
 * para nunca acontecer.
 */
export function urlDaCapa(imageId: string | null | undefined): string | null {
  if (typeof imageId !== "string") return null;
  // Os ids do IGDB sao alfanumericos; qualquer outra coisa nao vira URL.
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(imageId)) return null;
  return `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;
}
