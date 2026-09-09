import "server-only";

import { createHash } from "node:crypto";
import {
  COSMETIC_ASSET_MAX_BYTES,
  COSMETIC_MIME_TYPES,
  COSMETIC_REGRAS,
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

  const pasta = PASTA_DO_COSMETICO[tipo];
  const hash = createHash("sha256")
    .update(frente.bytes)
    .update(tras ? tras.bytes : Buffer.alloc(0))
    .digest("hex")
    .slice(0, 8);

  const assetKey = `cosmetics/${pasta}/${slug}-${hash}.${EXT[frente.mime]}`;
  const assetUrl = await enviarObjeto({
    chave: assetKey,
    contentType: frente.mime,
    bytes: frente.bytes,
    cacheControl: CACHE_IMUTAVEL,
  });
  if (!assetUrl) return { ok: false, error: "Falha ao enviar a imagem" };

  let assetTrasKey: string | null = null;
  let assetTrasUrl: string | null = null;
  if (tras && !("erro" in tras)) {
    assetTrasKey = `cosmetics/${pasta}/${slug}-${hash}-tras.${EXT[tras.mime]}`;
    assetTrasUrl = await enviarObjeto({
      chave: assetTrasKey,
      contentType: tras.mime,
      bytes: tras.bytes,
      cacheControl: CACHE_IMUTAVEL,
    });
    if (!assetTrasUrl) {
      // A frente ja subiu; sem a de tras a peca fica pela metade. Desfaz.
      await apagarObjeto(assetKey);
      return { ok: false, error: "Falha ao enviar a camada de tras" };
    }
  }

  const thumbBytes = await gerarThumb(frente.bytes);
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
    assetMime: frente.mime,
    largura: frente.largura,
    altura: frente.altura,
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
