import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Cifra simetrica para segredos guardados no banco (hoje: tokens do Spotify).
 *
 * AES-256-GCM. A chave e DERIVADA do `AUTH_SECRET` (o mesmo que assina a
 * sessao e o ticket do socket), com `scrypt` e um salt fixo de dominio — nao
 * ha env nova para configurar, e web e gateway derivam a mesma chave porque
 * ja compartilham o `AUTH_SECRET`.
 *
 * Por que cifrar e nao so confiar no banco: o refresh token do Spotify da
 * acesso CONTINUO a leitura do que a pessoa ouve. Um dump do banco, um backup
 * que vaza, um `SELECT` por engano num log — nenhum desses pode entregar o
 * token utilizavel.
 *
 * Formato guardado: `v1.<iv b64>.<tag b64>.<ciphertext b64>`.
 */

const DOMINIO = "aether/secret-box/v1";

function chave(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET ausente ou curto — a cifra de segredos deriva a chave dele.",
    );
  }
  // scrypt e deterministico: mesma entrada, mesma chave, dos dois lados.
  return scryptSync(secret, DOMINIO, 32);
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chave(), iv);
  const ct = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decifrar(cofre: string): string {
  const [versao, ivB64, tagB64, ctB64] = cofre.split(".");
  if (versao !== "v1" || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("formato de segredo cifrado desconhecido");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    chave(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}
