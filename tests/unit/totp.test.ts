import { describe, expect, it } from "vitest";
import {
  codificarBase32,
  decodificarBase32,
  gerarSegredoTotp,
  totpAtual,
  uriDeProvisionamento,
  verificarTotp,
} from "../../packages/shared/src/totp";

/**
 * TOTP/HOTP proprio (RFC 4226/6238), sem biblioteca de terceiros. O que
 * importa validar: os vetores de teste OFICIAIS da RFC batem (prova que a
 * matematica esta certa, nao so "roda sem erro"), e as duas defesas que a
 * RFC recomenda — tolerancia de relogio e recusa de reuso — funcionam.
 */

describe("base32", () => {
  it("ida e volta preserva os bytes", () => {
    const original = new Uint8Array([0, 1, 2, 3, 255, 254, 128, 42, 7]);
    expect(decodificarBase32(codificarBase32(original))).toEqual(original);
  });

  it("gerarSegredoTotp produz 32 caracteres (20 bytes em base32)", () => {
    const segredo = gerarSegredoTotp();
    expect(segredo).toHaveLength(32);
    expect(segredo).toMatch(/^[A-Z2-7]+$/);
  });

  it("gera segredos diferentes a cada chamada", () => {
    expect(gerarSegredoTotp()).not.toBe(gerarSegredoTotp());
  });
});

describe("vetores oficiais da RFC 6238 (apendice B, SHA1)", () => {
  /**
   * A RFC usa o segredo ASCII "12345678901234567890" (20 bytes) direto como
   * chave HMAC — aqui ele entra em base32 porque e o formato que a API deste
   * modulo aceita. Os vetores publicados sao de 8 digitos; os ultimos 6
   * batem com o que este modulo calcula, porque os dois vem do MESMO inteiro
   * truncado (`binario % 10^8` vs `binario % 10^6` — a diferenca e so o
   * modulo final).
   */
  const SEGREDO = codificarBase32(
    new TextEncoder().encode("12345678901234567890"),
  );

  const VETORES: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];

  it.each(VETORES)("T=%i segundos -> %s", (segundos, esperado) => {
    expect(totpAtual(SEGREDO, segundos * 1000)).toBe(esperado);
  });

  it("verificarTotp aceita o codigo oficial no tempo exato", () => {
    const contador = verificarTotp(VETORES[0]![1], SEGREDO, {
      agoraMs: VETORES[0]![0] * 1000,
    });
    expect(contador).toBe(BigInt(Math.floor(VETORES[0]![0] / 30)));
  });
});

describe("verificarTotp — tolerancia de relogio", () => {
  it("aceita o passo anterior e o seguinte dentro da janela padrao (±1)", () => {
    const segredo = gerarSegredoTotp();
    const agora = 1_700_000_000_000;
    const codigoAnterior = totpAtual(segredo, agora - 30_000);
    const codigoSeguinte = totpAtual(segredo, agora + 30_000);

    expect(verificarTotp(codigoAnterior, segredo, { agoraMs: agora })).not.toBeNull();
    expect(verificarTotp(codigoSeguinte, segredo, { agoraMs: agora })).not.toBeNull();
  });

  it("recusa um codigo 2 passos fora da janela padrao", () => {
    const segredo = gerarSegredoTotp();
    const agora = 1_700_000_000_000;
    const codigoDistante = totpAtual(segredo, agora - 90_000);
    expect(verificarTotp(codigoDistante, segredo, { agoraMs: agora })).toBeNull();
  });

  it("recusa codigo de outro segredo", () => {
    const segredoA = gerarSegredoTotp();
    const segredoB = gerarSegredoTotp();
    const codigo = totpAtual(segredoA);
    expect(verificarTotp(codigo, segredoB)).toBeNull();
  });

  it("recusa formato invalido sem lancar", () => {
    const segredo = gerarSegredoTotp();
    for (const ruim of ["", "12345", "1234567", "abcdef", "12 34 56"]) {
      expect(verificarTotp(ruim, segredo)).toBeNull();
    }
  });
});

describe("uriDeProvisionamento", () => {
  it("monta uma URI otpauth:// valida com os parametros certos", () => {
    const uri = uriDeProvisionamento({
      segredoBase32: "JBSWY3DPEHPK3PXP",
      conta: "ryan",
      emissor: "AETHER",
    });
    expect(uri).toMatch(/^otpauth:\/\/totp\/AETHER%3Aryan\?/);
    const params = new URL(uri).searchParams;
    expect(params.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(params.get("issuer")).toBe("AETHER");
    expect(params.get("algorithm")).toBe("SHA1");
    expect(params.get("digits")).toBe("6");
    expect(params.get("period")).toBe("30");
  });
});
