import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
} from "../../apps/web/src/server/auth/password";

/**
 * Hash de senha com scrypt nativo. O que se testa aqui e o contrato:
 * ida e volta funciona, senha errada nao passa, e formato corrompido devolve
 * `false` em vez de explodir — um throw aqui viraria 500 na tela de login,
 * que e exatamente onde um atacante consegue provocar entrada malformada.
 */

describe("hashPassword", () => {
  it("produz o formato documentado", async () => {
    const stored = await hashPassword("senha123");
    const parts = stored.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(Number(parts[1])).toBe(16384);
  });

  it("gera hashes diferentes para a mesma senha", async () => {
    /** Salt aleatorio: dois usuarios com a mesma senha nao compartilham hash. */
    const [a, b] = await Promise.all([
      hashPassword("mesma-senha"),
      hashPassword("mesma-senha"),
    ]);
    expect(a).not.toBe(b);
  });
});

describe("verifyPassword", () => {
  it("aceita a senha correta", async () => {
    const stored = await hashPassword("senha123");
    await expect(verifyPassword("senha123", stored)).resolves.toBe(true);
  });

  it("recusa a senha errada", async () => {
    const stored = await hashPassword("senha123");
    await expect(verifyPassword("senha124", stored)).resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
    await expect(verifyPassword("SENHA123", stored)).resolves.toBe(false);
  });

  it("normaliza em NFKC — a mesma senha digitada em outro teclado entra", async () => {
    /**
     * "á" existe em duas formas Unicode: um caractere so (NFC) ou "a" + acento
     * combinante (NFD). Teclados e sistemas diferentes produzem formas
     * diferentes, e sem normalizar a pessoa ficaria trancada fora da conta
     * digitando exatamente a senha certa.
     */
    const nfc = "senhá-forte";
    const nfd = "senhá-forte";
    expect(nfc).not.toBe(nfd);

    const stored = await hashPassword(nfc);
    await expect(verifyPassword(nfd, stored)).resolves.toBe(true);
  });

  it("recusa hash malformado sem lancar", async () => {
    const malformed = [
      "",
      "nao-e-hash",
      "scrypt$16384$8$1$soh-quatro-campos",
      "bcrypt$16384$8$1$c2FsdA==$aGFzaA==",
      "scrypt$abc$8$1$c2FsdA==$aGFzaA==",
      "scrypt$16384$8$1$$",
    ];
    for (const stored of malformed) {
      await expect(verifyPassword("senha123", stored)).resolves.toBe(false);
    }
  });

  it("recusa quando o hash guardado foi trocado", async () => {
    const stored = await hashPassword("senha123");
    const parts = stored.split("$");
    parts[5] = Buffer.from("hash-de-outra-coisa").toString("base64");
    await expect(verifyPassword("senha123", parts.join("$"))).resolves.toBe(
      false,
    );
  });
});
