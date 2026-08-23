import "server-only";

import {
  SERVER_ICON_MAX_BYTES,
  SERVER_ICON_MIME_TYPES,
  type ServerIconMimeType,
} from "@aether/shared";

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

const MAGIC_BYTES: Record<ServerIconMimeType, (bytes: Uint8Array) => boolean> = {
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
};

const EXTENSION: Record<ServerIconMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
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
function sniffMimeType(bytes: Uint8Array): ServerIconMimeType | null {
  for (const mime of SERVER_ICON_MIME_TYPES) {
    if (MAGIC_BYTES[mime](bytes)) return mime;
  }
  return null;
}

export type UploadImageResult =
  | { ok: true; url: string }
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
async function uploadImage(
  bucket: string,
  pathPrefix: string,
  file: File,
  notConfiguredMessage: string,
): Promise<UploadImageResult> {
  if (file.size === 0) return { ok: false, error: "Arquivo vazio" };
  if (file.size > SERVER_ICON_MAX_BYTES) {
    return { ok: false, error: "Imagem maior que 2MB" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("[storage] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente");
    return { ok: false, error: notConfiguredMessage };
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMimeType(buffer);
  if (!mime) {
    return { ok: false, error: "Envie PNG, JPEG ou WEBP" };
  }

  // Nome aleatorio, nao o nome original do arquivo: evita depender de
  // caracteres de path do lado do cliente e garante que cada upload e um
  // objeto novo (sem sobrescrever, sem precisar de upsert).
  const path = `${pathPrefix}/${randomId()}.${EXTENSION[mime]}`;

  try {
    const response = await fetch(
      `${supabaseUrl}/storage/v1/object/${bucket}/${path}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          "content-type": mime,
        },
        body: buffer,
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      console.error(
        "[storage] upload recusado:",
        response.status,
        await response.text().catch(() => ""),
      );
      return { ok: false, error: "Falha ao enviar a imagem" };
    }

    return {
      ok: true,
      url: `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`,
    };
  } catch (error) {
    console.error("[storage] upload falhou:", error);
    return { ok: false, error: "Falha ao enviar a imagem" };
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
): Promise<UploadImageResult> {
  return uploadImage(
    "avatars",
    `users/${userId}`,
    file,
    "Upload de foto nao configurado neste ambiente",
  );
}
