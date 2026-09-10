/**
 * Ponte com o deep link do app de desktop (`aether://invite/<codigo>`).
 *
 * O processo principal do Electron ja resolveu o link para um CAMINHO INTERNO
 * (`/invite/<codigo>`) — este modulo so entrega esse caminho para a pagina
 * navegar. No navegador `window.aetherDesktop` nao existe e tudo aqui e no-op.
 *
 * Segue o padrao de `lib/desktop/game-activity.ts`: uma ponte fina, sem estado.
 */

interface DeepLinkBridge {
  pendente: () => Promise<string | null>;
  confirmar: () => void;
  aoReceber: (cb: (caminho: string) => void) => () => void;
}

function bridge(): DeepLinkBridge | null {
  if (typeof window === "undefined") return null;
  const desktop = (window as { aetherDesktop?: { deepLink?: DeepLinkBridge } })
    .aetherDesktop;
  return desktop?.deepLink ?? null;
}

/**
 * So navega para caminhos que fazem sentido como deep link. Barreira extra: o
 * `deep-link.js` do Electron ja restringe, e o backend valida o convite — mas
 * a pagina nao empurra um `router.push` para um caminho arbitrario vindo de
 * IPC sem conferir a forma.
 */
export function caminhoDeDeepLinkValido(caminho: unknown): caminho is string {
  return (
    typeof caminho === "string" && /^\/invite\/[a-z0-9]{6,24}$/i.test(caminho)
  );
}

/** O deep link que chegou antes de a pagina montar, se houver. Consome. */
export async function deepLinkPendente(): Promise<string | null> {
  const b = bridge();
  if (!b) return null;
  try {
    const caminho = await b.pendente();
    return caminhoDeDeepLinkValido(caminho) ? caminho : null;
  } catch {
    return null;
  }
}

/** Avisa o processo principal que a pagina cuidou do deep link. */
export function confirmarDeepLink(): void {
  bridge()?.confirmar();
}

/** Ouve deep links que chegam com o app ja aberto. Devolve o cancelador. */
export function aoReceberDeepLink(
  cb: (caminho: string) => void,
): () => void {
  const b = bridge();
  if (!b) return () => {};
  return b.aoReceber((caminho) => {
    if (caminhoDeDeepLinkValido(caminho)) cb(caminho);
  });
}
