import emojiRegex from "emoji-regex";

/**
 * Twemoji como conjunto visual UNICO de emoji do AETHER.
 *
 * O mesmo emoji tem que aparecer igual no Windows, no Linux, no celular — e o
 * emoji nativo do sistema nao da isso. Os SVGs sao servidos de `/twemoji/`
 * (gerados de `@twemoji/svg` pelo `scripts/build-twemoji.mjs`), porque a CSP
 * so libera imagem de 'self'.
 *
 * Aqui mora so a matematica: caractere -> nome de arquivo, e quebrar um texto
 * em (trecho | emoji). O `<img>` em si e o `<Emoji>` / `<TextoComEmoji>`.
 */

/** Uma instancia so — `emojiRegex()` compila a lista inteira do Unicode. */
const RE = emojiRegex();

/**
 * Nome do arquivo do Twemoji para um caractere (sem extensao).
 *
 * A regra e exatamente a do `grabTheRightIcon` do Twemoji: se a sequencia tem
 * ZWJ (`200d`, ex.: familia, casal), mantem tudo; senao, remove TODO seletor de
 * variacao `fe0f`. Keycap (`23 fe0f 20e3` -> `23-20e3`) cai nessa segunda
 * regra, nao e caso especial.
 */
export function nomeTwemoji(emoji: string): string {
  const pontos = [...emoji].map((c) => c.codePointAt(0)!);
  const temZwj = pontos.includes(0x200d);
  const usados = temZwj ? pontos : pontos.filter((p) => p !== 0xfe0f);
  return usados.map((p) => p.toString(16)).join("-");
}

/** URL publica do SVG. */
export function urlTwemoji(emoji: string): string {
  return `/twemoji/${nomeTwemoji(emoji)}.svg`;
}

/**
 * `emoji-mart` entrega o code point ja no formato "1f525" / "2764-fe0f" — so
 * falta aplicar a mesma regra de `fe0f`.
 */
export function urlTwemojiDeUnified(unified: string): string {
  const pontos = unified.toLowerCase().split("-");
  const usados = pontos.includes("200d")
    ? pontos
    : pontos.filter((p) => p !== "fe0f");
  return `/twemoji/${usados.join("-")}.svg`;
}

export interface PedacoDeTexto {
  tipo: "texto" | "emoji";
  valor: string;
}

/**
 * Quebra um texto em pedacos alternando trecho comum e emoji. Base do
 * `<TextoComEmoji>` — cada emoji vira um `<img>`, o resto fica como esta.
 */
export function quebrarEmEmoji(texto: string): PedacoDeTexto[] {
  const pedacos: PedacoDeTexto[] = [];
  let ultimo = 0;
  RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(texto)) !== null) {
    if (m.index > ultimo) {
      pedacos.push({ tipo: "texto", valor: texto.slice(ultimo, m.index) });
    }
    pedacos.push({ tipo: "emoji", valor: m[0] });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) {
    pedacos.push({ tipo: "texto", valor: texto.slice(ultimo) });
  }
  return pedacos;
}

/** So checa se ha ao menos um emoji — para decidir se vale processar. */
export function temEmoji(texto: string): boolean {
  RE.lastIndex = 0;
  return RE.test(texto);
}
