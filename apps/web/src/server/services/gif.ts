import "server-only";

/**
 * GIF pelo Tenor (Google), atras de um proxy nosso.
 *
 * A CHAVE (`TENOR_API_KEY`) fica SO no servidor — se fosse `NEXT_PUBLIC_` iria
 * para o bundle e qualquer um poderia gastar a cota. O navegador fala com
 * `/api/gif`, nunca com o Tenor direto; so a MIDIA (o .gif / .mp4) vem do CDN
 * deles, que e conteudo publico e esta liberado no `img-src`/`media-src`.
 *
 * Sem a variavel, `gifDisponivel()` e `false` e o seletor mostra "em breve" —
 * nada quebra.
 */

const BASE = "https://tenor.googleapis.com/v2";
const CLIENT = "aether";
const LIMITE = 24;

export function gifDisponivel(): boolean {
  return Boolean(process.env.TENOR_API_KEY);
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
  const k = process.env.TENOR_API_KEY;
  if (!k) throw new Error("TENOR_API_KEY ausente");
  return k;
}

async function pedir(caminho: string, params: Record<string, string>) {
  const url = new URL(`${BASE}/${caminho}`);
  url.searchParams.set("key", chave());
  url.searchParams.set("client_key", CLIENT);
  url.searchParams.set("country", "BR");
  url.searchParams.set("locale", "pt_BR");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const resposta = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resposta.ok) {
    throw new Error(`Tenor respondeu ${resposta.status}`);
  }
  return resposta.json() as Promise<{
    results?: TenorResultado[];
    next?: string;
    tags?: TenorTag[];
  }>;
}

interface TenorFormato {
  url: string;
  dims?: [number, number];
}
interface TenorResultado {
  id: string;
  content_description?: string;
  media_formats?: Record<string, TenorFormato>;
}
interface TenorTag {
  searchterm: string;
  name: string;
  image: string;
}

function normalizar(r: TenorResultado): GifResultado | null {
  const m = r.media_formats ?? {};
  const cheio = m.gif ?? m.mediumgif ?? m.mp4;
  const previa = m.tinygif ?? m.nanogif ?? cheio;
  if (!cheio?.url || !previa?.url) return null;
  return {
    id: r.id,
    descricao: r.content_description || "GIF",
    previa: previa.url,
    url: cheio.url,
    largura: cheio.dims?.[0] ?? 0,
    altura: cheio.dims?.[1] ?? 0,
  };
}

function paginar(dados: {
  results?: TenorResultado[];
  next?: string;
}): PaginaDeGifs {
  return {
    resultados: (dados.results ?? [])
      .map(normalizar)
      .filter((g): g is GifResultado => g !== null),
    proximaPos: dados.next && dados.next !== "0" ? dados.next : null,
  };
}

export async function buscarGifs(
  termo: string,
  pos: string | null,
): Promise<PaginaDeGifs> {
  const dados = await pedir("search", {
    q: termo,
    limit: String(LIMITE),
    media_filter: "gif,tinygif,nanogif,mp4",
    contentfilter: "medium",
    ...(pos ? { pos } : {}),
  });
  return paginar(dados);
}

export async function gifsEmAlta(pos: string | null): Promise<PaginaDeGifs> {
  const dados = await pedir("featured", {
    limit: String(LIMITE),
    media_filter: "gif,tinygif,nanogif,mp4",
    contentfilter: "medium",
    ...(pos ? { pos } : {}),
  });
  return paginar(dados);
}

export async function categoriasDeGif(): Promise<CategoriaDeGif[]> {
  const dados = await pedir("categories", { type: "featured" });
  return (dados.tags ?? []).map((t) => ({
    nome: t.name.replace(/^#/, ""),
    busca: t.searchterm,
    previa: t.image,
  }));
}
