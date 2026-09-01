/**
 * A matematica do recorte de avatar, separada do componente.
 *
 * PURA de proposito: nao toca DOM, canvas nem estado do React. E a parte do
 * `AvatarCropper` mais facil de errar por um sinal trocado — mover a foto
 * para a direita na tela precisa subtrair do centro em espaço da imagem
 * original, nao somar — e a unica que compensa testar isolada. O resto do
 * componente e interacao de ponteiro e desenho, que teste de unidade nao
 * alcanca de qualquer forma.
 */

export interface Tamanho {
  w: number;
  h: number;
}

export interface Ponto {
  x: number;
  y: number;
}

/**
 * A escala que faz a imagem cobrir o quadro de recorte exatamente, sem sobra
 * e sem vao — o mesmo calculo que `object-fit: cover` faz.
 */
export function escalaDeCobertura(natural: Tamanho, janela: number): number {
  if (natural.w <= 0 || natural.h <= 0) return 0;
  return Math.max(janela / natural.w, janela / natural.h);
}

/**
 * Ate onde a foto pode ser arrastada, em pixels de TELA, sem abrir vao no
 * quadro. Na escala de cobertura exata (zoom minimo com imagem quadrada, ou
 * a dimensao que já cobre exatamente), o limite e zero — nao ha para onde
 * arrastar.
 */
export function limitesDeArrasto(
  natural: Tamanho,
  janela: number,
  escala: number,
): { maxX: number; maxY: number } {
  const largura = natural.w * escala;
  const altura = natural.h * escala;
  return {
    maxX: Math.max(0, (largura - janela) / 2),
    maxY: Math.max(0, (altura - janela) / 2),
  };
}

/** Prende o deslocamento dentro do limite — nunca deixa vao vazio na quina. */
export function limitarPosicao(
  offset: Ponto,
  limites: { maxX: number; maxY: number },
): Ponto {
  return {
    x: Math.min(limites.maxX, Math.max(-limites.maxX, offset.x)),
    y: Math.min(limites.maxY, Math.max(-limites.maxY, offset.y)),
  };
}

/**
 * O quadrado que sera recortado, EM PIXEL DA IMAGEM ORIGINAL.
 *
 * A foto e exibida centralizada no quadro e deslocada por `offset` (pixels de
 * tela). O sinal do deslocamento INVERTE ao converter para espaço da imagem:
 * mover a foto para a DIREITA na tela faz o ponto que fica no centro do
 * quadro recuar para a ESQUERDA do centro da propria imagem — por isso
 * `offset` e SUBTRAIDO, nao somado, do centro.
 *
 * O resultado e sempre fechado dentro de `[0, natural - lado]`: por
 * construcao (`lado <= min(natural.w, natural.h)` sempre que a escala vem de
 * `escalaDeCobertura` multiplicada por zoom >= 1) isso deveria ser um no-op,
 * mas o `Math.min/max` fica como rede de seguranca contra erro de ponto
 * flutuante bem na borda.
 */
export function areaDeRecorte(
  natural: Tamanho,
  janela: number,
  escala: number,
  offset: Ponto,
): { sx: number; sy: number; lado: number } {
  const lado = janela / escala;
  const cx = natural.w / 2 - offset.x / escala;
  const cy = natural.h / 2 - offset.y / escala;
  const sx = Math.min(Math.max(cx - lado / 2, 0), Math.max(0, natural.w - lado));
  const sy = Math.min(Math.max(cy - lado / 2, 0), Math.max(0, natural.h - lado));
  return { sx, sy, lado };
}
