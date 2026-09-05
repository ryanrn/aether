import type { ConnectionProvider } from "@aether/db";
import { provedor } from "@aether/access";

/**
 * Le o provedor do pedaco da URL (`/api/conexoes/twitch/...` -> `TWITCH`).
 *
 * LISTA FECHADA, e nao `toUpperCase()` no que vier: o valor entra numa coluna
 * de enum e vira chave de busca. Aceitar texto arbitrario da rota e o comeco
 * de todo problema que comeca com "mas o valor vinha da URL".
 *
 * Devolve `null` para desconhecido — e quem chama responde 404, sem dizer
 * quais existem.
 */
/**
 * `Map`, e nao objeto literal.
 *
 * Com objeto, `POR_NOME["__proto__"]` devolve `Object.prototype` — um valor
 * TRUTHY que passa por um `if (!id)`. Aqui a checagem seguinte pegaria mesmo
 * assim, mas depender disso e depender de sorte: um `Map` simplesmente nao
 * tem chaves herdadas.
 */
const POR_NOME = new Map<string, ConnectionProvider>([
  ["spotify", "SPOTIFY"],
  ["steam", "STEAM"],
  ["twitch", "TWITCH"],
  ["riot", "RIOT"],
]);

export function lerProvedor(bruto: string): ConnectionProvider | null {
  const id = POR_NOME.get(bruto.toLowerCase());
  // Previsto no enum mas ainda sem adaptador: tambem e 404, nao 500.
  if (!id || !provedor(id)) return null;
  return id;
}
