import "server-only";

import { S3Client, HeadObjectCommand, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Armazenamento de arquivo no Cloudflare R2.
 *
 * POR QUE R2, E NAO O SUPABASE QUE JA USAMOS: para anexo, o custo que explode
 * nao e guardar — e EGRESS. Todo mundo baixa o arquivo dos outros, e um video
 * de 200 MB num servidor de 50 pessoas sai 50 vezes. Supabase cobra egress, a
 * S3 da Amazon tambem e caro; o R2 nao cobra. E API compativel com S3, entao
 * trocar de provedor depois nao reescreve nada.
 *
 * O UPLOAD NAO PASSA PELO NOSSO SERVIDOR, e essa e a diferenca de arquitetura
 * em relacao ao `storage.ts` antigo (icone de servidor e avatar). La o arquivo
 * chega na Server Action, vira `arrayBuffer()` e e repassado. Isso funciona
 * para 2 MB e e impossivel para 250:
 *
 *  - a Vercel limita o corpo de uma funcao serverless a 4,5 MB, entao um anexo
 *    de 25 MB ja seria recusado antes de chegar ao codigo;
 *  - `arrayBuffer()` carrega o arquivo INTEIRO na memoria do servidor.
 *
 * Entao o navegador manda direto para o R2, com uma URL assinada por nos. O
 * servidor decide SE pode e de que TAMANHO, e nunca toca nos bytes.
 *
 * O TAMANHO E ASSINADO JUNTO. `ContentLength` entra nos cabecalhos assinados,
 * e o R2 recusa um PUT que chegue com outro tamanho — nao adianta o cliente
 * pedir 10 MB e mandar 900. E, mesmo assim, conferimos o tamanho real depois
 * (`confirmarObjeto`) antes de registrar o anexo: assinatura e a tranca,
 * conferencia e a auditoria, e as duas juntas custam pouco.
 */

export interface ConfigR2 {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** de onde os arquivos sao LIDOS, publico */
  publicUrl: string;
}

/**
 * A configuracao, ou `null` quando falta algo.
 *
 * Devolve nulo em vez de lancar: sem R2 configurado o resto do app tem de
 * continuar funcionando, e quem depende de anexo diz "nao configurado" em vez
 * de derrubar a pagina. Mesmo padrao do storage do Supabase.
 */
export function configR2(): ConfigR2 | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    return null;
  }
  // Barra no fim atrapalha ao juntar com a chave do objeto.
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicUrl: publicUrl.replace(/\/+$/, ""),
  };
}

let clienteCache: { chave: string; cliente: S3Client } | null = null;

/**
 * O cliente S3 apontado para o R2.
 *
 * Guardado entre chamadas porque criar um por requisicao refaz a cadeia de
 * credenciais e o pool de conexao a toa. A chave do cache inclui a conta e o
 * bucket para que trocar `.env` em desenvolvimento nao continue usando o
 * cliente velho.
 */
function cliente(config: ConfigR2): S3Client {
  const chave = `${config.accountId}:${config.bucket}:${config.accessKeyId}`;
  if (clienteCache?.chave === chave) return clienteCache.cliente;

  const novo = new S3Client({
    /**
     * `auto` e o que o R2 espera: ele nao tem regiao de verdade, mas a
     * assinatura SigV4 exige uma. Passar `us-east-1` funciona por acidente e
     * quebraria se a Cloudflare apertasse a validacao.
     */
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  clienteCache = { chave, cliente: novo };
  return novo;
}

export interface UploadAutorizado {
  /** para onde o NAVEGADOR faz o PUT */
  urlDeEnvio: string;
  /** onde o arquivo vai ficar depois, para leitura */
  urlPublica: string;
  /** a chave do objeto, que e o que guardamos no banco */
  chave: string;
  /** o cabecalho exato que o PUT precisa mandar */
  cabecalhos: Record<string, string>;
}

/** Por quanto tempo a URL assinada vale. */
const VALIDADE_SEGUNDOS = 10 * 60;

/**
 * Autoriza UM envio, de um tamanho exato.
 *
 * Quem chama ja decidiu que a pessoa pode e que o tamanho cabe no plano — esta
 * funcao nao consulta permissao nenhuma, so assina o que mandaram. Manter a
 * decisao fora daqui e o que impede a regra de autorizacao de ganhar uma
 * segunda casa.
 */
export async function autorizarUpload(params: {
  chave: string;
  contentType: string;
  tamanhoExato: number;
}): Promise<UploadAutorizado | null> {
  const config = configR2();
  if (!config) return null;

  const comando = new PutObjectCommand({
    Bucket: config.bucket,
    Key: params.chave,
    ContentType: params.contentType,
    /**
     * ASSINAR O TAMANHO e o que impede o cliente de pedir autorizacao para
     * 10 MB e enviar 900. Ele entra nos cabecalhos assinados, e um PUT com
     * outro `content-length` nao bate com a assinatura.
     */
    ContentLength: params.tamanhoExato,
  });

  const urlDeEnvio = await getSignedUrl(cliente(config), comando, {
    expiresIn: VALIDADE_SEGUNDOS,
  });

  return {
    urlDeEnvio,
    urlPublica: `${config.publicUrl}/${params.chave}`,
    chave: params.chave,
    cabecalhos: {
      "content-type": params.contentType,
      "content-length": String(params.tamanhoExato),
    },
  };
}

/**
 * Grava um objeto no R2 DIRETO do servidor, e devolve a URL publica.
 *
 * Diferente de `autorizarUpload`, que assina uma URL para o NAVEGADOR enviar:
 * aqui os bytes ja estao na mao (arquivo pequeno, so a equipe envia, e o
 * servidor precisa deles para medir dimensao e gerar miniatura de qualquer
 * jeito). E o mesmo caminho do `storage.ts` do Supabase, so que para o R2.
 *
 * `cacheControl` entra no objeto: cosmetico e estatico e a chave carrega um
 * hash do conteudo, entao `immutable` com validade longa e seguro — trocar a
 * arte gera chave nova.
 */
export async function enviarObjeto(params: {
  chave: string;
  contentType: string;
  bytes: Uint8Array;
  cacheControl?: string;
}): Promise<string | null> {
  const config = configR2();
  if (!config) return null;

  try {
    await cliente(config).send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: params.chave,
        Body: params.bytes,
        ContentType: params.contentType,
        CacheControl: params.cacheControl,
      }),
    );
    return `${config.publicUrl}/${params.chave}`;
  } catch {
    return null;
  }
}

/**
 * O objeto existe e tem o tamanho que dissemos?
 *
 * Chamada DEPOIS do envio, antes de registrar o anexo. A assinatura ja tranca
 * o tamanho, mas confiar so nela deixaria o banco apontando para objeto que
 * nunca chegou — basta o navegador registrar o anexo sem ter enviado nada.
 * Aqui perguntamos ao R2 em vez de acreditar no cliente.
 */
export async function confirmarObjeto(
  chave: string,
  tamanhoEsperado: number,
): Promise<{ ok: true; tamanho: number } | { ok: false; motivo: string }> {
  const config = configR2();
  if (!config) return { ok: false, motivo: "R2 nao configurado" };

  try {
    const resposta = await cliente(config).send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: chave }),
    );
    const tamanho = resposta.ContentLength ?? 0;
    if (tamanho !== tamanhoEsperado) {
      return {
        ok: false,
        motivo: `tamanho diferente do declarado (${tamanho} != ${tamanhoEsperado})`,
      };
    }
    return { ok: true, tamanho };
  } catch {
    // Nao existe, ou a credencial nao alcanca. Nos dois casos nao registramos.
    return { ok: false, motivo: "objeto nao encontrado no R2" };
  }
}

/**
 * Apaga um objeto.
 *
 * Usado quando o envio chega errado e quando alguem apaga a mensagem — objeto
 * orfao no bucket e conta que cresce sozinha, e ninguem vai varrer isso a mao.
 */
export async function apagarObjeto(chave: string): Promise<boolean> {
  const config = configR2();
  if (!config) return false;
  try {
    await cliente(config).send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: chave }),
    );
    return true;
  } catch {
    return false;
  }
}
