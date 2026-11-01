import { describe, expect, it } from "vitest";
import { verificarSegredoInterno } from "../../apps/realtime/src/internal-auth";

/**
 * Porta interna do gateway (auditoria 28/09 item 3).
 *
 * A regra e pura de proposito: as tres fases da transicao (antes, durante,
 * depois) sao so tres configuracoes, sem subir servidor.
 */

const AUTH = "a".repeat(40);
const DEDICADO = "d".repeat(40);

describe("verificarSegredoInterno", () => {
  it("sem header nao autentica", () => {
    expect(
      verificarSegredoInterno(undefined, {
        authSecret: AUTH,
        internalApiSecret: DEDICADO,
        aceitaLegado: true,
      }),
    ).toBeNull();
  });

  it("antes da transicao (sem segredo dedicado) o AUTH_SECRET continua valendo", () => {
    const config = { authSecret: AUTH, internalApiSecret: null, aceitaLegado: false };
    expect(verificarSegredoInterno(AUTH, config)).toBe("legado");
    expect(verificarSegredoInterno(DEDICADO, config)).toBeNull();
  });

  it("durante a transicao aceita os dois e diz qual foi", () => {
    const config = { authSecret: AUTH, internalApiSecret: DEDICADO, aceitaLegado: true };
    expect(verificarSegredoInterno(DEDICADO, config)).toBe("dedicado");
    expect(verificarSegredoInterno(AUTH, config)).toBe("legado");
  });

  it("depois da transicao o AUTH_SECRET deixa de abrir a porta", () => {
    const config = { authSecret: AUTH, internalApiSecret: DEDICADO, aceitaLegado: false };
    expect(verificarSegredoInterno(DEDICADO, config)).toBe("dedicado");
    expect(verificarSegredoInterno(AUTH, config)).toBeNull();
  });

  it("valor errado, inclusive de tamanho diferente, nao autentica", () => {
    const config = { authSecret: AUTH, internalApiSecret: DEDICADO, aceitaLegado: true };
    expect(verificarSegredoInterno("x".repeat(40), config)).toBeNull();
    expect(verificarSegredoInterno("curto", config)).toBeNull();
  });
});
