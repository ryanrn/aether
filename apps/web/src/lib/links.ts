/**
 * Reconhece link em texto de mensagem — o mesmo tipo de quebra que
 * `quebrarEmEmoji` faz para emoji (ver `lib/emoji/twemoji.ts`), só que para
 * `http(s)://...`.
 *
 * So http/https: `javascript:`, `data:` etc. nunca casam, entao um link colado
 * numa mensagem nunca vira um `href` perigoso.
 */

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

/** Pontuacao de FRASE colada no fim do link ("veja https://x.com/a." -> tira o ponto). */
const PONTUACAO_FINAL = /[.,!?;:'"]+$/;

export interface PedacoDeLink {
  tipo: "texto" | "link";
  valor: string;
}

/**
 * Quebra um texto em pedacos alternando trecho comum e link. Cada match e
 * aparado de pontuacao de frase e de um parentese/colchete que fechou algo de
 * FORA do link (ex.: "(veja https://x.com/a)" nao inclui o ")" final).
 */
export function quebrarEmLink(texto: string): PedacoDeLink[] {
  const pedacos: PedacoDeLink[] = [];
  let ultimo = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = URL_RE.exec(texto)) !== null) {
    let url = m[0];

    const semPontuacao = url.replace(PONTUACAO_FINAL, "");
    url = semPontuacao;

    const abre = (url.match(/\(/g) ?? []).length;
    const fecha = (url.match(/\)/g) ?? []).length;
    if (fecha > abre && url.endsWith(")")) {
      url = url.slice(0, -1);
    }

    if (url.length === 0) continue;

    if (m.index > ultimo) {
      pedacos.push({ tipo: "texto", valor: texto.slice(ultimo, m.index) });
    }
    pedacos.push({ tipo: "link", valor: url });
    ultimo = m.index + url.length;
  }

  if (ultimo < texto.length) {
    pedacos.push({ tipo: "texto", valor: texto.slice(ultimo) });
  }
  return pedacos;
}

/** So checa se ha ao menos um link — para decidir se vale processar. */
export function temLink(texto: string): boolean {
  URL_RE.lastIndex = 0;
  return URL_RE.test(texto);
}
