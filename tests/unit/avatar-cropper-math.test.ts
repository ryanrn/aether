import { describe, expect, it } from "vitest";
import {
  areaDeRecorte,
  escalaDeCobertura,
  limitarPosicao,
  limitesDeArrasto,
} from "../../apps/web/src/components/settings/avatar-cropper-math";

/**
 * A matematica do recorte de avatar.
 *
 * E a parte do `AvatarCropper` mais facil de errar por um sinal trocado — o
 * deslocamento em pixel de TELA e SUBTRAIDO, e nao somado, ao converter para
 * o centro do recorte em pixel da imagem ORIGINAL (ver o comentario de
 * `areaDeRecorte`). Um sinal invertido aqui nao quebra nada visivelmente
 * durante o arrasto — a foto se move do jeito esperado na tela — mas o
 * arquivo salvo mostraria o lado ERRADO da imagem. So um teste percebe.
 */

describe("escalaDeCobertura", () => {
  it("cobre uma imagem quadrada exatamente no tamanho da janela", () => {
    expect(escalaDeCobertura({ w: 260, h: 260 }, 260)).toBe(1);
  });

  it("usa a MAIOR proporcao — a que garante cobrir os dois lados", () => {
    // retrato: mais alta que larga. Cobrir a largura (menor lado) e o que
    // faz sobrar altura para cortar, e nao vao para preencher.
    const escala = escalaDeCobertura({ w: 200, h: 400 }, 260);
    expect(escala).toBeCloseTo(260 / 200, 5);
  });

  it("paisagem cobre pela ALTURA", () => {
    const escala = escalaDeCobertura({ w: 400, h: 200 }, 260);
    expect(escala).toBeCloseTo(260 / 200, 5);
  });

  it("devolve 0 para dimensao invalida, em vez de dividir por zero", () => {
    expect(escalaDeCobertura({ w: 0, h: 100 }, 260)).toBe(0);
  });
});

describe("limitesDeArrasto", () => {
  it("e ZERO quando a foto so cobre a janela — nao ha para onde arrastar", () => {
    // Imagem quadrada na escala de cobertura exata: cobre e nada sobra.
    const limites = limitesDeArrasto({ w: 260, h: 260 }, 260, 1);
    expect(limites).toEqual({ maxX: 0, maxY: 0 });
  });

  it("cresce com o ZOOM — mais zoom, mais sobra para arrastar", () => {
    const semZoom = limitesDeArrasto({ w: 260, h: 260 }, 260, 1);
    const comZoom = limitesDeArrasto({ w: 260, h: 260 }, 260, 2);
    expect(comZoom.maxX).toBeGreaterThan(semZoom.maxX);
    expect(comZoom.maxY).toBeGreaterThan(semZoom.maxY);
  });

  it("nunca fica NEGATIVO, mesmo chamado fora do uso normal com escala menor que a de cobertura", () => {
    // `AvatarCropper` nunca pede uma escala assim — zoom tem piso 1 sobre a
    // escala de cobertura —, mas a funcao e publica e o piso em zero e o que
    // impede um "vao negativo" de virar um deslocamento que puxa a foto para
    // ALEM da borda em vez de so nao arrastar.
    expect(limitesDeArrasto({ w: 260, h: 260 }, 260, 0.5)).toEqual({
      maxX: 0,
      maxY: 0,
    });
  });

  it("retrato cobrindo pela largura: sobra so no eixo VERTICAL", () => {
    // 200x400 cobrindo uma janela de 260 na escala de cobertura (1.3):
    // largura exibida = 260 (exata), altura exibida = 520 -> sobra 260.
    const escala = escalaDeCobertura({ w: 200, h: 400 }, 260);
    const limites = limitesDeArrasto({ w: 200, h: 400 }, 260, escala);
    expect(limites.maxX).toBeCloseTo(0, 5);
    expect(limites.maxY).toBeCloseTo(130, 5); // (520-260)/2
  });
});

describe("limitarPosicao", () => {
  it("deixa passar um deslocamento dentro do limite", () => {
    expect(limitarPosicao({ x: 10, y: -5 }, { maxX: 20, maxY: 20 })).toEqual({
      x: 10,
      y: -5,
    });
  });

  it("prende no limite POSITIVO", () => {
    expect(limitarPosicao({ x: 999, y: 0 }, { maxX: 50, maxY: 50 })).toEqual({
      x: 50,
      y: 0,
    });
  });

  it("prende no limite NEGATIVO — nao so no positivo", () => {
    expect(limitarPosicao({ x: -999, y: 0 }, { maxX: 50, maxY: 50 })).toEqual({
      x: -50,
      y: 0,
    });
  });

  it("com limite zero, qualquer deslocamento vira zero", () => {
    // `toBeCloseTo`, e nao `toEqual`: `Math.max(-30, -0)` da `-0` em vez de
    // `0` — matematicamente identico (`-0 === 0`), mas `toEqual` os distingue
    // pelo bit de sinal. Nada aqui depende dessa diferenca: canvas e CSS
    // tratam `-0` e `0` da mesma forma.
    const resultado = limitarPosicao({ x: 30, y: -30 }, { maxX: 0, maxY: 0 });
    expect(resultado.x).toBeCloseTo(0, 10);
    expect(resultado.y).toBeCloseTo(0, 10);
  });
});

describe("areaDeRecorte", () => {
  it("sem deslocamento, recorta o CENTRO da imagem", () => {
    // Imagem 1000x1000, janela 260, zoom 1 -> escala de cobertura = 0.26.
    // lado no original = 260 / 0.26 = 1000 (a imagem inteira).
    const { sx, sy, lado } = areaDeRecorte(
      { w: 1000, h: 1000 },
      260,
      0.26,
      { x: 0, y: 0 },
    );
    expect(lado).toBeCloseTo(1000, 5);
    expect(sx).toBeCloseTo(0, 5);
    expect(sy).toBeCloseTo(0, 5);
  });

  it("mover a foto para a DIREITA na tela recorta o lado ESQUERDO da imagem", () => {
    // O caso que um sinal trocado quebraria sem avisar: a foto na tela vai
    // para onde se arrasta, mas o retangulo de origem anda para o lado
    // OPOSTO em espaço da imagem.
    const semOffset = areaDeRecorte({ w: 1000, h: 1000 }, 260, 0.5, { x: 0, y: 0 });
    const comOffsetDireita = areaDeRecorte(
      { w: 1000, h: 1000 },
      260,
      0.5,
      { x: 50, y: 0 },
    );
    expect(comOffsetDireita.sx).toBeLessThan(semOffset.sx);
    expect(comOffsetDireita.sy).toBeCloseTo(semOffset.sy, 5);
  });

  it("mover a foto para BAIXO na tela recorta a parte de CIMA da imagem", () => {
    const semOffset = areaDeRecorte({ w: 1000, h: 1000 }, 260, 0.5, { x: 0, y: 0 });
    const comOffsetBaixo = areaDeRecorte(
      { w: 1000, h: 1000 },
      260,
      0.5,
      { x: 0, y: 50 },
    );
    expect(comOffsetBaixo.sy).toBeLessThan(semOffset.sy);
  });

  it("no deslocamento MAXIMO, o recorte encosta exatamente na borda — nunca passa dela", () => {
    const natural = { w: 200, h: 400 };
    const janela = 260;
    const escala = escalaDeCobertura(natural, janela);
    const limites = limitesDeArrasto(natural, janela, escala);

    const noTopo = areaDeRecorte(natural, janela, escala, {
      x: 0,
      y: limites.maxY,
    });
    expect(noTopo.sy).toBeCloseTo(0, 5);

    const noFundo = areaDeRecorte(natural, janela, escala, {
      x: 0,
      y: -limites.maxY,
    });
    expect(noFundo.sy).toBeCloseTo(natural.h - noFundo.lado, 5);
  });

  it("o lado recortado nunca excede a dimensao da imagem original", () => {
    const natural = { w: 300, h: 900 };
    const janela = 260;
    const escala = escalaDeCobertura(natural, janela);
    const { sx, sy, lado } = areaDeRecorte(natural, janela, escala, { x: 0, y: 0 });
    expect(sx + lado).toBeLessThanOrEqual(natural.w + 1e-6);
    expect(sy + lado).toBeLessThanOrEqual(natural.h + 1e-6);
  });
});
