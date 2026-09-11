import "server-only";

/**
 * GIF pelo Giphy, atras de um proxy nosso.
 *
 * Era Tenor ate 2026 — o Google desligou de vez a API publica do Tenor em
 * 30/06/2026 (chave nova ou velha, tanto faz: parou de responder). Giphy
 * segue no ar, com chave "Beta" instantanea (sem aprovacao) para o volume de
 * um app como este.
 *
 * A CHAVE (`GIPHY_API_KEY`) fica SO no servidor — se fosse `NEXT_PUBLIC_` iria
 * para o bundle e qualquer um poderia gastar a cota. O navegador fala com
 * `/api/gif`, nunca com o Giphy direto; so a MIDIA (o .gif / .mp4) vem do CDN
 * deles, que e conteudo publico e esta liberado no `img-src`/`media-src`.
 *
 * Sem a variavel, `gifDisponivel()` e `false` e o seletor mostra "em breve" —
 * nada quebra.
 *
 * ATRIBUICAO OBRIGATORIA: as regras do Giphy exigem "Powered By GIPHY"
 * visivel onde a busca aparece — ver o rodape do `<GifPicker>`. Nao e
 * decoracao, e condicao de uso da chave.
 */

const BASE = "https://api.giphy.com/v1";
const LIMITE = 24;

/**
 * Filtro de conteudo. Giphy usa `rating` (g/pg/pg-13/r) em vez do
 * `contentfilter` do Tenor — `pg-13` e o equivalente mais proximo do "medium"
 * que tinhamos: barra o mais explicito sem virar so conteudo infantil.
 */
const RATING = "pg-13";

export function gifDisponivel(): boolean {
  return Boolean(process.env.GIPHY_API_KEY);
}

export interface GifResultado {
  id: string;
  descricao: string;
  /** quadro leve para a grade */
  previa: string;
  /** o que e enviado na mensagem */
  url: string;
  largura: number;
  altura: number;
}

export interface PaginaDeGifs {
  resultados: GifResultado[];
  proximaPos: string | null;
}

export interface CategoriaDeGif {
  nome: string;
  busca: string;
  previa: string;
}

function chave(): string {
  const k = process.env.GIPHY_API_KEY;
  if (!k) throw new Error("GIPHY_API_KEY ausente");
  return k;
}

interface GiphyRendicao {
  url?: string;
  mp4?: string;
  width?: string;
  height?: string;
}
interface GiphyResultado {
  id: string;
  title?: string;
  images?: Record<string, GiphyRendicao>;
}
interface GiphyPaginacao {
  total_count: number;
  count: number;
  offset: number;
}

async function pedir(
  caminho: string,
  params: Record<string, string>,
): Promise<{ data?: GiphyResultado[]; pagination?: GiphyPaginacao }> {
  const url = new URL(`${BASE}/${caminho}`);
  url.searchParams.set("api_key", chave());
  url.searchParams.set("rating", RATING);
  // Melhor relevancia para busca em portugues; a legenda do GIF em si segue
  // sendo majoritariamente em ingles (e a cultura da coisa), isso so pesa
  // o ranking.
  url.searchParams.set("lang", "pt");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const resposta = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resposta.ok) {
    throw new Error(`Giphy respondeu ${resposta.status}`);
  }
  return resposta.json() as Promise<{
    data?: GiphyResultado[];
    pagination?: GiphyPaginacao;
  }>;
}

/**
 * `previa` = a menor renderizacao que existe (`preview_gif`, ~100px/40KB) —
 * so para a grade de busca. `url` = `fixed_height` (200px), o que de fato
 * viaja na mensagem; prefere o `.gif` (a identidade do formato) e cai para o
 * `.mp4` so se o `.gif` não vier. `original` (a imagem cheia, varios MB) NUNCA
 * e usada — pesado demais para uma mensagem de chat.
 */
function normalizar(r: GiphyResultado): GifResultado | null {
  const m = r.images ?? {};
  const cheio = m.fixed_height ?? m.downsized ?? m.original;
  const previa = m.preview_gif ?? m.fixed_height_small ?? cheio;
  const url = cheio?.url ?? cheio?.mp4;
  const urlPrevia = previa?.url ?? previa?.mp4;
  if (!url || !urlPrevia) return null;

  return {
    id: r.id,
    descricao: r.title?.trim() || "GIF",
    previa: urlPrevia,
    url,
    largura: cheio?.width ? Number(cheio.width) : 0,
    altura: cheio?.height ? Number(cheio.height) : 0,
  };
}

/**
 * Giphy pagina por NUMERO (`offset`/`total_count`), diferente do cursor opaco
 * do Tenor. `proximaPos` continua uma string opaca para quem chama (o
 * `<GifPicker>` so guarda e devolve) — aqui dentro ela e o proximo offset.
 */
function paginar(offsetPedido: number, dados: {
  data?: GiphyResultado[];
  pagination?: GiphyPaginacao;
}): PaginaDeGifs {
  const resultados = (dados.data ?? [])
    .map(normalizar)
    .filter((g): g is GifResultado => g !== null);

  const p = dados.pagination;
  const proximoOffset = p ? p.offset + p.count : offsetPedido + resultados.length;
  const acabou = !p || p.count === 0 || proximoOffset >= p.total_count;

  return {
    resultados,
    proximaPos: acabou ? null : String(proximoOffset),
  };
}

export async function buscarGifs(
  termo: string,
  pos: string | null,
): Promise<PaginaDeGifs> {
  const offset = pos ? Number(pos) || 0 : 0;
  const dados = await pedir("gifs/search", {
    q: termo,
    limit: String(LIMITE),
    offset: String(offset),
  });
  return paginar(offset, dados);
}

export async function gifsEmAlta(pos: string | null): Promise<PaginaDeGifs> {
  const offset = pos ? Number(pos) || 0 : 0;
  const dados = await pedir("gifs/trending", {
    limit: String(LIMITE),
    offset: String(offset),
  });
  return paginar(offset, dados);
}

/**
 * Categorias de atalho no topo do seletor — CURADAS a mao, e nao vindas da
 * API. `/v1/gifs/categories` do Giphy devolve uma taxonomia hierarquica
 * (categoria > subcategoria) sem miniatura pronta, bem diferente do
 * "featured" do Tenor (lista plana, ja com imagem). Montar isso exigiria uma
 * busca A MAIS por subcategoria so para desenhar os chips — contra uma cota
 * de 100 chamadas/hora da chave Beta. Uma lista fixa custa zero chamada, e o
 * `<GifPicker>` nem desenha `previa` destes — so o nome no chip.
 */
const CATEGORIAS_CURADAS: CategoriaDeGif[] = [
  { nome: "Feliz", busca: "happy", previa: "" },
  { nome: "Triste", busca: "sad", previa: "" },
  { nome: "Rindo", busca: "laughing", previa: "" },
  { nome: "Uau", busca: "wow", previa: "" },
  { nome: "Aplausos", busca: "applause", previa: "" },
  { nome: "Dançando", busca: "dance", previa: "" },
  { nome: "Concordo", busca: "agree", previa: "" },
  { nome: "Não", busca: "no", previa: "" },
  { nome: "Bom dia", busca: "good morning", previa: "" },
  { nome: "Tchau", busca: "bye", previa: "" },
];

export async function categoriasDeGif(): Promise<CategoriaDeGif[]> {
  return CATEGORIAS_CURADAS;
}
