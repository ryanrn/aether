/**
 * TOTP/HOTP proprio (RFC 4226 + RFC 6238) — sem biblioteca de terceiros.
 *
 * Zero dependencia: so `node:crypto` (`createHmac`), na mesma linha de
 * decisao que levou o projeto a usar `scrypt` nativo em vez de bcrypt em
 * `password.ts` — nenhum modulo externo para auditar ou compilar.
 *
 * POR QUE NAO ENTRA NO BARREL (`index.ts`): usa `node:crypto`, que o bundler
 * do Next recusa em codigo de cliente — mesmo motivo do `log.ts`. Acesso so
 * pelo subpath `@aether/shared/totp`, do lado servidor (acao/servico).
 *
 * Este arquivo so faz a MATEMATICA do protocolo — gerar segredo, calcular e
 * verificar codigo, montar a URI de provisionamento. Cifrar o segredo em
 * repouso, guardar no banco e o fluxo de configuracao/login moram em
 * `apps/web/src/server/services/totp.ts`.
 */

import { createHmac, randomBytes } from "node:crypto";

/** Alfabeto padrao RFC 4648 (base32), sem padding — formato que qualquer
 * autenticador (Google Authenticator, Authy, 1Password...) le. */
const BASE32_ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Passo de tempo do RFC 6238 — 30s e o padrao universal, nenhum autenticador
 * deixa configurar outro valor, entao mudar aqui quebraria com todo app real. */
const PASSO_SEGUNDOS = 30;
const DIGITOS = 6;

export function codificarBase32(bytes: Uint8Array): string {
  let bits = 0;
  let valor = 0;
  let saida = "";
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += BASE32_ALFABETO[(valor >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    saida += BASE32_ALFABETO[(valor << (5 - bits)) & 0x1f];
  }
  return saida;
}

export function decodificarBase32(texto: string): Uint8Array {
  const limpo = texto.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bytes: number[] = [];
  let bits = 0;
  let valor = 0;
  for (const char of limpo) {
    const indice = BASE32_ALFABETO.indexOf(char);
    if (indice === -1) continue;
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/** Segredo novo — 20 bytes (160 bits), o tamanho que o RFC 4226 recomenda
 * para HMAC-SHA1 (mesmo tamanho do digest, sem desperdicar nem faltar bit). */
export function gerarSegredoTotp(): string {
  return codificarBase32(randomBytes(20));
}

/** HOTP puro (RFC 4226) — o codigo para um CONTADOR especifico. */
function hotp(segredo: Uint8Array, contador: bigint): string {
  const bufContador = Buffer.alloc(8);
  bufContador.writeBigUInt64BE(contador);
  const hmac = createHmac("sha1", segredo).update(bufContador).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binario =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const otp = binario % 10 ** DIGITOS;
  return otp.toString().padStart(DIGITOS, "0");
}

function contadorAtual(agoraMs: number): bigint {
  return BigInt(Math.floor(agoraMs / 1000 / PASSO_SEGUNDOS));
}

/** O codigo TOTP válido agora, para o segredo dado (base32). */
export function totpAtual(segredoBase32: string, agoraMs: number = Date.now()): string {
  return hotp(decodificarBase32(segredoBase32), contadorAtual(agoraMs));
}

/**
 * Confere um codigo de 6 digitos contra o segredo, tolerando deriva de
 * relogio — checa o passo atual e `janela` passos para tras/frente (o padrao
 * do RFC 6238 e ±1 passo, ou seja ate 90s de tolerancia total).
 *
 * Devolve o CONTADOR que bateu, ou `null` se nenhum bateu. Quem chama compara
 * o contador devolvido contra o ultimo aceito (`totpUltimoPassoUsado`) para
 * recusar reuso do mesmo codigo dentro da propria janela — esta funcao nao
 * sabe de estado, so matematica.
 */
export function verificarTotp(
  codigo: string,
  segredoBase32: string,
  opcoes?: { janela?: number; agoraMs?: number },
): bigint | null {
  const limpo = codigo.trim().replace(/\s/g, "");
  if (!/^\d{6}$/.test(limpo)) return null;

  const janela = opcoes?.janela ?? 1;
  const segredo = decodificarBase32(segredoBase32);
  const base = contadorAtual(opcoes?.agoraMs ?? Date.now());

  for (let delta = -janela; delta <= janela; delta++) {
    const contador = base + BigInt(delta);
    if (contador < 0n) continue;
    if (hotp(segredo, contador) === limpo) return contador;
  }
  return null;
}

/**
 * URI `otpauth://` para QR/link de provisionamento — formato que todo
 * autenticador entende (Google Authenticator, Authy, 1Password, Aegis...).
 * `conta` e `emissor` so aparecem no NOME que a pessoa ve no app dela; nao
 * fazem parte do segredo nem sao guardados.
 */
export function uriDeProvisionamento(params: {
  segredoBase32: string;
  conta: string;
  emissor: string;
}): string {
  const rotulo = encodeURIComponent(`${params.emissor}:${params.conta}`);
  const query = new URLSearchParams({
    secret: params.segredoBase32,
    issuer: params.emissor,
    algorithm: "SHA1",
    digits: String(DIGITOS),
    period: String(PASSO_SEGUNDOS),
  });
  return `otpauth://totp/${rotulo}?${query.toString()}`;
}
