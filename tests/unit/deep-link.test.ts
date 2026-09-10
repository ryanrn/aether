import { describe, expect, it } from "vitest";
import { caminhoDeDeepLinkValido } from "@/lib/desktop/deep-link";

/**
 * Barreira do lado da pagina: mesmo o `deep-link.js` do Electron ja tendo
 * restringido, a pagina nao faz `router.replace` para um caminho arbitrario
 * vindo de IPC sem conferir a forma.
 */
describe("caminhoDeDeepLinkValido", () => {
  it("aceita /invite/<codigo> no formato do inviteCodeSchema", () => {
    expect(caminhoDeDeepLinkValido("/invite/u7yd4hvw3")).toBe(true);
    expect(caminhoDeDeepLinkValido("/invite/ABC123")).toBe(true);
    expect(caminhoDeDeepLinkValido("/invite/abcdefghijklmnopqrstuvwx")).toBe(
      true,
    );
  });

  it("recusa qualquer outra coisa", () => {
    expect(caminhoDeDeepLinkValido("/invite/ab")).toBe(false); // curto demais
    expect(caminhoDeDeepLinkValido("/invite/abc-123")).toBe(false); // simbolo
    expect(caminhoDeDeepLinkValido("/invite/abc/../../etc")).toBe(false);
    expect(caminhoDeDeepLinkValido("/app/s/abc")).toBe(false);
    expect(caminhoDeDeepLinkValido("https://evil/invite/abc123")).toBe(false);
    expect(caminhoDeDeepLinkValido("")).toBe(false);
    expect(caminhoDeDeepLinkValido(null)).toBe(false);
    expect(caminhoDeDeepLinkValido(42)).toBe(false);
  });
});
