import "server-only";

import {
  AVATAR_MIME_TYPES,
  SERVER_ICON_MAX_BYTES,
  SERVER_ICON_MIME_TYPES,
  ehImagemAnimada,
  limiteDoAvatar,
  type AvatarMimeType,
} from "@aether/shared";
import { log } from "@aether/shared/log";

/**
 * Upload de icone de servidor no Supabase Storage.
 *
 * Wrapper fino sobre a API REST do Storage via `fetch`, sem puxar o SDK
 * `@supabase/supabase-js` como dependencia nova — mesmo estilo de
 * `realtime-notify.ts`, que fala com o gateway direto por fetch em vez de um
 * cliente. O projeto nunca usou nada do Supabase alem do Postgres ate agora;
 * isto e a primeira vez que fala com o produto de Storage.
 *
 * Bucket `server-icons`: publico para LEITURA (e assim que icone de
 * servidor/avatar e servido em qualquer produto do genero — a doc do proprio
 * Supabase lista esse exato caso de uso). ESCRITA passa exclusivamente pela
 * service_role key, que ignora Row Level Security por completo — nao ha
 * policy de INSERT nenhuma no bucket. Isso e seguro porque quem autoriza a
 * escrita e a nossa Server Action (`requirePermission MANAGE_SERVER`) antes de
 * chamar esta funcao; o Supabase nao tem Auth proprio aqui para uma RLS
 * decidir nada. Mesmo raciocinio do AUTH_SECRET: um segredo de servidor
 * atravessando uma fronteira de confianca.
 */

const MAGIC_BYTES: Record<AvatarMimeType, (bytes: Uint8Array) => boolean> = {
  "image/png": (b) =>
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47,
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) =>
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50,
  // "GIF87a" ou "GIF89a"
  "image/gif": (b) =>
    b.length >= 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61,
};

const EXTENSION: Record<AvatarMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Detecta o tipo real pelos primeiros bytes do arquivo, em vez de confiar no
 * Content-Type que o navegador declarou — esse cabecalho e escolhido pelo
 * cliente, e um arquivo disfarcado nao deve entrar so porque a extensao ou o
 * campo `type` dizem "imagem".
 */
function sniffMimeType(
  bytes: Uint8Array,
  aceitos: readonly AvatarMimeType[],
): AvatarMimeType | null {
  for (const mime of aceitos) {
    if (MAGIC_BYTES[mime](bytes)) return mime;
  }
  return null;
}

export type UploadImageResult =
  | {
      ok: true;
      url: string;
      /**
       * A versao PARADA da mesma imagem, quando a enviada era animada.
       *
       * Existe para que perder o plano tire a animacao sem tirar a foto: a
       * leitura escolhe entre as duas. Ausente quando a imagem ja era parada
       * — nao ha o que escolher.
       */
      urlEstatica?: string;
    }
  | { ok: false; error: string };

/** Mantido para quem ja importava este nome. */
export type UploadServerIconResult = UploadImageResult;

/**
 * Envia uma imagem para um bucket publico e devolve a URL de leitura.
 *
 * Um caminho so para icone de servidor e foto de perfil: as duas validacoes
 * sao identicas (tamanho, e tipo REAL pelos bytes), e duas copias divergiriam
 * — bastaria uma delas esquecer o sniff para o bucket publico passar a aceitar
 * arquivo disfarcado.
 */
/**
 * As regras do DESTINO. Existem porque avatar e icone de servidor deixaram de
 * ter os mesmos limites: o avatar aceita GIF e vai a 10 MB, o icone nao. Passar
 * por parametro mantem UM caminho de upload com dois conjuntos de regra — a
 * alternativa seria duplicar a funcao, e bastaria uma copia esquecer o sniff
 * para o bucket publico passar a aceitar arquivo disfarcado.
 */
interface RegrasDeImagem {
  aceitos: readonly AvatarMimeType[];
  /** o teto para este tipo — o GIF tem o seu */
  limite: (mime: AvatarMimeType) => number;
  erroDeTipo: string;
  /** movimento e permitido neste envio? decidido por quem chama, com o plano */
  permiteAnimado?: boolean;
  erroDeAnimado?: string;
  /**
   * Guardar tambem uma versao parada quando a imagem for animada.
   *
   * So o avatar pede: e o unico cosmetico cuja animacao pertence a um plano, e
   * portanto o unico que precisa de para onde cair quando o plano acaba.
   */
  gerarEstatico?: boolean;
}

const REGRAS_DE_ICONE: RegrasDeImagem = {
  aceitos: SERVER_ICON_MIME_TYPES,
  limite: () => SERVER_ICON_MAX_BYTES,
  erroDeTipo: "Envie PNG, JPEG ou WEBP",
  permiteAnimado: false,
  erroDeAnimado: "Icone de servidor nao pode ser animado",
};

async function uploadImage(
  bucket: string,
  pathPrefix: string,
  file: File,
  notConfiguredMessage: string,
  regras: RegrasDeImagem,
): Promise<UploadImageResult> {
  if (file.size === 0) return { ok: false, error: "Arquivo vazio" };

  /*
   * Guarda barata ANTES de ler o arquivo na memoria: o teto por tipo so pode
   * ser aplicado depois do sniff, e ate la nao vale a pena bufferizar um
   * arquivo de qualquer tamanho.
   */
  const tetoMaximo = Math.max(...regras.aceitos.map((m) => regras.limite(m)));
  if (file.size > tetoMaximo) {
    return {
      ok: false,
      error: `Imagem maior que ${Math.round(tetoMaximo / 1024 / 1024)}MB`,
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    log.error(
      "web.storage.sem_config",
      "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente",
    );
    return { ok: false, error: notConfiguredMessage };
  }

  /*
   * SO O CABECALHO primeiro. O tipo e o movimento se decidem nos primeiros
   * bytes, e o teto depende do tipo — ler o arquivo inteiro antes de saber o
   * tipo significaria carregar 10 MB na memoria so para recusar por tamanho.
   * 4 KB cobre o sniff e a busca do bloco `acTL` do APNG.
   */
  const cabecalho = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const mime = sniffMimeType(cabecalho, regras.aceitos);
  if (!mime) {
    return { ok: false, error: regras.erroDeTipo };
  }

  // Agora que o tipo REAL e conhecido, o teto dele vale.
  if (file.size > regras.limite(mime)) {
    return {
      ok: false,
      error: `Imagem maior que ${Math.round(regras.limite(mime) / 1024 / 1024)}MB`,
    };
  }

  if (regras.permiteAnimado === false && ehImagemAnimada(cabecalho, mime)) {
    return {
      ok: false,
      error: regras.erroDeAnimado ?? "Esta imagem nao pode ser animada",
    };
  }

  const buffer = new Uint8Array(await file.arrayBuffer());

  // Nome aleatorio, nao o nome original do arquivo: evita depender de
  // caracteres de path do lado do cliente e garante que cada upload e um
  // objeto novo (sem sobrescrever, sem precisar de upsert).
  const path = `${pathPrefix}/${randomId()}.${EXTENSION[mime]}`;

  try {
    const url = await enviarObjeto(bucket, path, mime, buffer);
    if (!url) return { ok: false, error: "Falha ao enviar a imagem" };

    /**
     * O GEMEO PARADO, so quando a imagem e animada E o destino pede.
     *
     * Gerado AQUI, no envio, e nao na leitura: converter a cada exibicao
     * custaria CPU por pessoa que abre uma lista de membros, e a conversao
     * nao muda nunca depois que o arquivo existe.
     *
     * Falhar em gerar NAO derruba o envio. O avatar animado ja esta no ar e
     * funciona; sem o gemeo, a pessoa apenas continua vendo a animacao quando
     * o plano cair — uma regra a menos, e nao um upload perdido.
     */
    if (regras.gerarEstatico && ehImagemAnimada(cabecalho, mime)) {
      const estatica = await versaoParada(buffer);
      if (estatica) {
        const caminhoParado = `${pathPrefix}/${randomId()}.png`;
        const urlEstatica = await enviarObjeto(
          bucket,
          caminhoParado,
          "image/png",
          estatica,
        );
        if (urlEstatica) return { ok: true, url, urlEstatica };
      }
    }

    return { ok: true, url };
  } catch (error) {
    log.error("web.storage.upload", "upload de ícone falhou", { err: error });
    return { ok: false, error: "Falha ao enviar a imagem" };
  }
}

/**
 * Grava um objeto no bucket e devolve a URL publica, ou `null`.
 *
 * Separado para o avatar animado poder gravar DOIS objetos pelo mesmo caminho
 * de codigo — o arquivo original e o quadro parado — sem duplicar cabecalho,
 * tempo limite e tratamento de recusa.
 */
async function enviarObjeto(
  bucket: string,
  caminho: string,
  mime: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${bucket}/${caminho}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "content-type": mime,
      },
      body: bytes,
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    log.error("web.storage.upload_recusado", "Supabase Storage recusou o upload", {
      status: response.status,
      corpo: await response.text().catch(() => ""),
    });
    return null;
  }

  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${caminho}`;
}

/**
 * O primeiro quadro de uma imagem animada, como PNG.
 *
 * `sharp` sem `{ animated: true }` le apenas o primeiro quadro, que e
 * exatamente o que queremos: a mesma foto, parada.
 *
 * O import e DINAMICO porque `sharp` e binario nativo — carregar no topo
 * faria todo caminho do servidor pagar por ele, inclusive os que nunca
 * enviam imagem. Devolve `null` em qualquer falha: a versao parada e um
 * extra, e nao pode derrubar um envio que ja funcionou.
 */
async function versaoParada(
  bytes: Uint8Array,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const { default: sharp } = await import("sharp");
    const png = await sharp(bytes).png().toBuffer();
    /*
     * Copia para um ArrayBuffer proprio: o `Buffer` do Node compartilha um
     * pool, e o tipo dele nao satisfaz o `BodyInit` que o fetch pede.
     */
    return new Uint8Array(png);
  } catch (error) {
    log.warn("web.storage.versao_parada", "não gerei a versão estática do ícone", {
      err: error,
    });
    return null;
  }
}

export async function uploadServerIcon(
  serverId: string,
  file: File,
): Promise<UploadImageResult> {
  return uploadImage(
    "server-icons",
    `servers/${serverId}`,
    file,
    "Upload de icone nao configurado neste ambiente",
    REGRAS_DE_ICONE,
  );
}

/**
 * Foto de perfil. Bucket proprio, e nao `server-icons` com outro prefixo: um
 * bucket chamado "icones de servidor" guardando foto de usuario e o tipo de
 * coisa que confunde depois, e separar da limites e limpeza independentes.
 */
export async function uploadUserAvatar(
  userId: string,
  file: File,
  /**
   * Movimento liberado? Vem de QUEM CHAMA, que consultou o plano — esta camada
   * nao conhece plano nenhum, e nao deve conhecer: storage decide sobre bytes,
   * autorizacao decide sobre pessoas.
   */
  permiteAnimado: boolean,
): Promise<UploadImageResult> {
  return uploadImage(
    "avatars",
    `users/${userId}`,
    file,
    "Upload de foto nao configurado neste ambiente",
    {
      aceitos: AVATAR_MIME_TYPES,
      limite: limiteDoAvatar,
      erroDeTipo: "Envie PNG, JPEG, WEBP ou GIF",
      permiteAnimado,
      erroDeAnimado: "Avatar animado e exclusivo do Olimpo Pro",
      gerarEstatico: true,
    },
  );
}
