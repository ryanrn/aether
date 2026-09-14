import "server-only";

import { createHash } from "node:crypto";
import {
  COSMETIC_ASSET_MAX_BYTES,
  COSMETIC_MIME_TYPES,
  COSMETIC_REGRAS,
  DECORACAO_ALVO_FURO,
  DECORACAO_CANVAS,
  PASTA_DO_COSMETICO,
  type CosmeticMimeType,
  type CosmeticType,
} from "@aether/shared";
import { log } from "@aether/shared/log";
import { apagarObjeto, configR2, enviarObjeto } from "./r2";

/**
 * O ASSET de um cosmetico, do arquivo ao R2.
 *
 * O upload passa PELO SERVIDOR — ao contrario do anexo de mensagem, que vai
 * direto do navegador. E deliberado: o arquivo e pequeno (teto de 4 MB), so a
 * equipe envia, e o servidor precisa dos bytes de qualquer jeito para medir a
 * dimensao e recortar a miniatura. Mesma arquitetura de `storage.ts` (avatar e
 * icone de servidor), so que gravando no R2 em vez do Supabase.
 *
 * O que este arquivo decide: FORMATO (PNG/WEBP, pelos bytes), TAMANHO e
 * DIMENSAO. Nao decide QUEM pode enviar — isso e o guard da action.
 *
 * DUAS CAMADAS: uma decoracao pode vir com uma segunda imagem, a de TRAS
 * (atras do avatar) — o aro de uma coroa que passa por tras da cabeca. Banner
 * nunca tem; decoracao pode.
 */

const CACHE_IMUTAVEL = "public, max-age=31536000, immutable";

const MAGIC: Record<CosmeticMimeType, (b: Uint8Array) => boolean> = {
  "image/png": (b) =>
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47,
  "image/webp": (b) =>
    b.length >= 12 &&
    b[0] === 0x52 && // R
    b[1] === 0x49 && // I
    b[2] === 0x46 && // F
    b[3] === 0x46 && // F
    b[8] === 0x57 && // W
    b[9] === 0x45 && // E
    b[10] === 0x42 && // B
    b[11] === 0x50, // P
};

const EXT: Record<CosmeticMimeType, string> = {
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * O tipo REAL pelos primeiros bytes, nunca pelo `Content-Type` que o navegador
 * declarou — um arquivo disfarcado nao entra so porque a extensao diz "imagem".
 */
function farejarMime(bytes: Uint8Array): CosmeticMimeType | null {
  for (const mime of COSMETIC_MIME_TYPES) {
    if (MAGIC[mime](bytes)) return mime;
  }
  return null;
}

interface CamadaValidada {
  bytes: Uint8Array;
  mime: CosmeticMimeType;
  largura: number;
  altura: number;
}

/**
 * Le UMA imagem, confere formato/tamanho/dimensao contra a regra do tipo, e
 * devolve os bytes + a medida. `sharp` entra por import dinamico (binario
 * nativo — os caminhos que nunca enviam imagem nao pagam por ele no boot).
 */
async function lerECheckar(
  file: File,
  tipo: CosmeticType,
  rotulo: string,
): Promise<CamadaValidada | { erro: string }> {
  if (file.size === 0) return { erro: `${rotulo}: arquivo vazio` };
  if (file.size > COSMETIC_ASSET_MAX_BYTES) {
    return {
      erro: `${rotulo}: imagem maior que ${Math.round(COSMETIC_ASSET_MAX_BYTES / 1024 / 1024)} MB`,
    };
  }

  const cabecalho = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const mime = farejarMime(cabecalho);
  if (!mime) return { erro: `${rotulo}: envie um PNG ou um WEBP` };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const regra = COSMETIC_REGRAS[tipo];

  try {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(bytes).metadata();
    const largura = meta.width ?? 0;
    const altura = meta.height ?? 0;

    if (largura < regra.ladoMin || altura < regra.ladoMin) {
      return {
        erro: `${rotulo}: precisa ter ao menos ${regra.ladoMin}px de cada lado (alvo: ${regra.alvo})`,
      };
    }
    if (largura > regra.ladoMax || altura > regra.ladoMax) {
      return { erro: `${rotulo}: passa de ${regra.ladoMax}px — reduza antes de enviar` };
    }
    const ratio = largura / altura;
    if (ratio < regra.ratioMin || ratio > regra.ratioMax) {
      return {
        erro:
          tipo === "BANNER"
            ? `${rotulo}: precisa ser proximo de 3:1 (ex.: 1500x500)`
            : `${rotulo}: precisa ser proxima de quadrada (ex.: 512x512)`,
      };
    }
    return { bytes, mime, largura, altura };
  } catch (erro) {
    log.warn("web.cosmeticos.sharp", "sharp nao leu a imagem do cosmetico", {
      err: erro,
    });
    return { erro: `${rotulo}: nao consegui ler essa imagem` };
  }
}

/**
 * Miniatura WEBP pequena, para a grade do painel/loja nao baixar o asset cheio
 * de cada item. `animated` fica no padrao (false): a grade quer um quadro
 * parado. Falhar aqui NAO derruba o envio — o app cai no `assetUrl`.
 */
async function gerarThumb(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { default: sharp } = await import("sharp");
    const buf = await sharp(bytes)
      .resize(160, 160, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return new Uint8Array(buf);
  } catch (erro) {
    log.warn("web.cosmeticos.thumb", "nao gerei a miniatura do cosmetico", {
      err: erro,
    });
    return null;
  }
}

/**
 * `true` se a imagem tem mais de um quadro (WEBP/PNG animado).
 *
 * Sem o `{ animated: true }` na leitura, o `sharp` sempre le so o PRIMEIRO
 * quadro de um WEBP animado — nenhuma das chamadas de `normalizarDecoracao`
 * pedia isso, e o pipeline geometrico (bbox por pixel, recorte, composicao)
 * nao foi desenhado para quadro-a-quadro. Rodar um WEBP animado por ele hoje
 * nao "erraria a leitura": acharia o quadro 1 e devolveria uma arte estatica,
 * sem aviso nenhum de que a animacao sumiu.
 */
async function ehAnimado(bytes: Uint8Array): Promise<boolean> {
  try {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(bytes, { animated: true }).metadata();
    return (meta.pages ?? 1) > 1;
  } catch {
    return false;
  }
}

/**
 * NORMALIZA uma decoracao para a geometria canonica (ver `DECORACAO_ALVO_FURO`
 * em `@aether/shared`). Toda decoracao sai daqui como PNG 512x512 que:
 *
 *  - SANGRA nas 4 bordas (a folga transparente em volta foi recortada);
 *  - tem o furo transparente central em ~`DECORACAO_ALVO_FURO` do lado.
 *
 * Assim o `<AvatarDecorado>` usa uma escala fixa e toda decoracao abraca a
 * foto do mesmo jeito, sem depender de a arte ter vindo na medida certa.
 *
 * A camada de TRAS recebe a MESMA transformacao geometrica da frente (as duas
 * sao desenhadas centradas no mesmo canvas), para continuarem alinhadas.
 *
 * Falha aqui NAO derruba o envio: cai no fluxo antigo com os bytes originais.
 */
async function normalizarDecoracao(
  frenteBytes: Uint8Array,
  trasBytes: Uint8Array | null,
): Promise<{ frente: Uint8Array; tras: Uint8Array | null } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const N = DECORACAO_CANVAS;

    /** bbox da arte opaca, em fracao [0..1], robusta a pixels quase-transparentes */
    const bboxOpaca = async (buf: Uint8Array) => {
      const S = 96;
      const { data } = await sharp(buf)
        .resize(S, S, { fit: "fill" })
        .ensureAlpha()
        .extractChannel(3)
        .blur(1.2)
        .raw()
        .toBuffer({ resolveWithObject: true });
      let minX = S;
      let minY = S;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (data[y * S + x]! > 28) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return null;
      return { minX: minX / S, minY: minY / S, maxX: (maxX + 1) / S, maxY: (maxY + 1) / S };
    };

    /** raio radial minimo (fracao do lado) do centro ate a arte opaca = o furo */
    const furoRatio = async (buf: Uint8Array) => {
      const S = 128;
      const { data } = await sharp(buf)
        .resize(S, S, { fit: "fill" })
        .ensureAlpha()
        .extractChannel(3)
        .blur(1.5)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const c = S / 2;
      let rmin = Infinity;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (data[y * S + x]! > 40) {
            const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
            if (d < rmin) rmin = d;
          }
        }
      }
      return Number.isFinite(rmin) ? (2 * rmin) / S : 1;
    };

    /** recorta a folga em volta, centra num quadrado e reamostra para N */
    const sangrar = async (buf: Uint8Array): Promise<Uint8Array> => {
      const meta = await sharp(buf).metadata();
      const W = meta.width ?? N;
      const H = meta.height ?? N;
      const b = await bboxOpaca(buf);
      if (!b) return new Uint8Array(await sharp(buf).resize(N, N, { fit: "fill" }).png().toBuffer());
      const L = Math.max(0, Math.round(b.minX * W) - 2);
      const T = Math.max(0, Math.round(b.minY * H) - 2);
      const R = Math.min(W, Math.round(b.maxX * W) + 2);
      const B = Math.min(H, Math.round(b.maxY * H) + 2);
      const cw = Math.max(1, R - L);
      const ch = Math.max(1, B - T);
      const lado = Math.max(cw, ch);
      const recorte = await sharp(buf)
        .extract({ left: L, top: T, width: cw, height: ch })
        .toBuffer();
      const quad = await sharp({
        create: { width: lado, height: lado, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([
          { input: recorte, left: Math.round((lado - cw) / 2), top: Math.round((lado - ch) / 2) },
        ])
        .png()
        .toBuffer();
      return new Uint8Array(await sharp(quad).resize(N, N).png().toBuffer());
    };

    /** k a partir do furo medido, com clamp (anel grosso/fino demais nao explode) */
    const escalaPara = (furo: number) =>
      Math.min(1.6, Math.max(0.55, DECORACAO_ALVO_FURO / Math.max(0.08, furo)));

    /**
     * aplica a escala uniforme `k`. Zoom uniforme mexe no furo E na arte juntos:
     * `furo_novo = furo * k`. k > 1 -> zoom in (corta o excesso na borda);
     * k < 1 -> zoom out (recompoe com margem transparente).
     */
    const aplicarEscala = async (buf: Uint8Array, k: number): Promise<Uint8Array> => {
      if (Math.abs(k - 1) < 0.02) return buf;
      const n = Math.max(1, Math.round(N * k));
      if (k >= 1) {
        const off = Math.round((n - N) / 2);
        return new Uint8Array(
          await sharp(buf).resize(n, n).extract({ left: off, top: off, width: N, height: N }).png().toBuffer(),
        );
      }
      const menor = await sharp(buf).resize(n, n).toBuffer();
      const off = Math.round((N - n) / 2);
      return new Uint8Array(
        await sharp({
          create: { width: N, height: N, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        })
          .composite([{ input: menor, left: off, top: off }])
          .png()
          .toBuffer(),
      );
    };

    const frenteFull = await sangrar(frenteBytes);
    const k = escalaPara(await furoRatio(frenteFull));

    const frente = await aplicarEscala(frenteFull, k);
    let tras: Uint8Array | null = null;
    if (trasBytes) {
      // MESMA escala da frente (nao a medida da propria tras, que pode nem ter
      // furo definido) para as camadas continuarem alinhadas.
      tras = await aplicarEscala(await sangrar(trasBytes), k);
    }
    return { frente, tras };
  } catch (erro) {
    log.warn("web.cosmeticos.normalizar", "normalizacao da decoracao falhou", {
      err: erro,
    });
    return null;
  }
}

export type UploadCosmeticoResult =
  | {
      ok: true;
      assetKey: string;
      assetUrl: string;
      assetMime: CosmeticMimeType;
      largura: number;
      altura: number;
      /** camada de tras — presente so quando `fileTras` foi enviado */
      assetTrasKey: string | null;
      assetTrasUrl: string | null;
      thumbKey: string | null;
      thumbUrl: string | null;
    }
  | { ok: false; error: string };

/**
 * Envia o asset (a miniatura, e a camada de tras se houver) de um cosmetico
 * para o R2.
 *
 * A chave leva a pasta do tipo e um hash do CONTEUDO: reenviar o mesmo arquivo
 * cai na mesma chave (idempotente), e trocar a arte gera chave nova — o que
 * mantem o cache `immutable` valido sem invalidacao manual.
 */
export async function uploadCosmeticAsset(params: {
  /** a camada principal — o banner, ou a frente de uma decoracao */
  file: File;
  /** a camada de TRAS — so decoracao, so quando a arte tem duas partes */
  fileTras?: File | null;
  tipo: CosmeticType;
  slug: string;
}): Promise<UploadCosmeticoResult> {
  const { file, fileTras, tipo, slug } = params;

  if (!configR2()) {
    return {
      ok: false,
      error: "O armazenamento de cosmeticos nao esta configurado neste ambiente",
    };
  }
  if (fileTras && tipo !== "DECORATION") {
    return { ok: false, error: "So decoracao tem camada de tras" };
  }

  const frente = await lerECheckar(file, tipo, "Camada da frente");
  if ("erro" in frente) return { ok: false, error: frente.erro };

  const tras =
    fileTras && fileTras.size > 0
      ? await lerECheckar(fileTras, tipo, "Camada de tras")
      : null;
  if (tras && "erro" in tras) return { ok: false, error: tras.erro };

  // Bytes/mime/medida que de fato vao pro R2 — a decoracao passa pela
  // normalizacao canonica (512x512 PNG, furo padrao); banner segue cru.
  let frenteBytes: Uint8Array = frente.bytes;
  let frenteMime: CosmeticMimeType = frente.mime;
  let frenteLargura = frente.largura;
  let frenteAltura = frente.altura;
  let trasBytes: Uint8Array | null = tras ? tras.bytes : null;
  let trasMime: CosmeticMimeType = tras ? tras.mime : "image/png";

  if (tipo === "DECORATION") {
    // Uma camada animada nao passa pelo pipeline geometrico (ele so enxerga o
    // primeiro quadro e sempre re-codifica como PNG estatico ao final — rodar
    // por ele apagaria a animacao em silencio). Cai no fluxo cru, como uma
    // normalizacao que falhou: sem a posicao canonica, mas com a arte intacta.
    const animada =
      (await ehAnimado(frente.bytes)) ||
      (tras ? await ehAnimado(tras.bytes) : false);

    const canon = animada
      ? null
      : await normalizarDecoracao(frente.bytes, tras ? tras.bytes : null);
    if (canon) {
      frenteBytes = canon.frente;
      frenteMime = "image/png";
      frenteLargura = DECORACAO_CANVAS;
      frenteAltura = DECORACAO_CANVAS;
      if (tras && canon.tras) {
        trasBytes = canon.tras;
        trasMime = "image/png";
      }
    }
  }

  const pasta = PASTA_DO_COSMETICO[tipo];
  const hash = createHash("sha256")
    .update(frenteBytes)
    .update(trasBytes ?? Buffer.alloc(0))
    .digest("hex")
    .slice(0, 8);

  const assetKey = `cosmetics/${pasta}/${slug}-${hash}.${EXT[frenteMime]}`;
  const assetUrl = await enviarObjeto({
    chave: assetKey,
    contentType: frenteMime,
    bytes: frenteBytes,
    cacheControl: CACHE_IMUTAVEL,
  });
  if (!assetUrl) return { ok: false, error: "Falha ao enviar a imagem" };

  let assetTrasKey: string | null = null;
  let assetTrasUrl: string | null = null;
  if (trasBytes) {
    assetTrasKey = `cosmetics/${pasta}/${slug}-${hash}-tras.${EXT[trasMime]}`;
    assetTrasUrl = await enviarObjeto({
      chave: assetTrasKey,
      contentType: trasMime,
      bytes: trasBytes,
      cacheControl: CACHE_IMUTAVEL,
    });
    if (!assetTrasUrl) {
      // A frente ja subiu; sem a de tras a peca fica pela metade. Desfaz.
      await apagarObjeto(assetKey);
      return { ok: false, error: "Falha ao enviar a camada de tras" };
    }
  }

  const thumbBytes = await gerarThumb(frenteBytes);
  let thumbKey: string | null = null;
  let thumbUrl: string | null = null;
  if (thumbBytes) {
    thumbKey = `cosmetics/${pasta}/${slug}-${hash}-thumb.webp`;
    thumbUrl = await enviarObjeto({
      chave: thumbKey,
      contentType: "image/webp",
      bytes: thumbBytes,
      cacheControl: CACHE_IMUTAVEL,
    });
    if (!thumbUrl) thumbKey = null;
  }

  return {
    ok: true,
    assetKey,
    assetUrl,
    assetMime: frenteMime,
    largura: frenteLargura,
    altura: frenteAltura,
    assetTrasKey,
    assetTrasUrl,
    thumbKey,
    thumbUrl,
  };
}

/**
 * Apaga do R2 todos os objetos de um cosmetico (frente, tras, miniatura).
 *
 * Chamado SO no passo explicito "excluir definitivamente" — desativar um
 * cosmetico nao encosta no bucket. Best-effort: se o R2 recusar, a linha do
 * banco ja sumiu e o objeto vira orfao (anotado para uma faxina futura), o que
 * e melhor que travar a exclusao do catalogo.
 */
export async function apagarAssetCosmetico(chaves: {
  assetKey: string;
  assetTrasKey: string | null;
  thumbKey: string | null;
}): Promise<void> {
  await apagarObjeto(chaves.assetKey);
  if (chaves.assetTrasKey) await apagarObjeto(chaves.assetTrasKey);
  if (chaves.thumbKey) await apagarObjeto(chaves.thumbKey);
}
