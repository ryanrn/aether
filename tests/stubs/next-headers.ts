/**
 * Stub de `next/headers`.
 *
 * `clientKey()` depende do escopo de request do Next e nao e exercitada aqui;
 * existe para o modulo de rate limit carregar. Chamar isto e erro de teste, e
 * por isso ele grita em vez de devolver um valor plausivel.
 */
export function headers(): never {
  throw new Error(
    "headers() nao esta disponivel na suite unitaria — clientKey() nao e testavel fora do request do Next.",
  );
}
