import { describe, expect, it } from "vitest";
// O parser do protocolo `aether://` do processo principal do Electron. E
// seguranca: ele decide para onde a janela navega quando o SO entrega uma URL.
import {
  caminhoDoDeepLink,
  deepLinkNosArgs,
  // @ts-expect-error — modulo JS puro do app de desktop, sem tipos.
} from "../../apps/desktop/src/deep-link.js";

describe("caminhoDoDeepLink", () => {
  it("resolve aether://invite/<codigo> para /invite/<codigo> em minusculas", () => {
    expect(caminhoDoDeepLink("aether://invite/u7yd4hvw3")).toBe(
      "/invite/u7yd4hvw3",
    );
    expect(caminhoDoDeepLink("aether://invite/ABC123XYZ")).toBe(
      "/invite/abc123xyz",
    );
    expect(caminhoDoDeepLink("aether://invite/abc123/")).toBe("/invite/abc123");
    expect(caminhoDoDeepLink("aether://invite/abc123?x=1")).toBe("/invite/abc123");
  });

  it("recusa tudo que nao for um convite bem formado", () => {
    expect(caminhoDoDeepLink("aether://invite/ab")).toBeNull(); // curto
    expect(caminhoDoDeepLink("aether://invite/abc-123")).toBeNull(); // simbolo
    expect(caminhoDoDeepLink("aether://invite/../../etc/passwd")).toBeNull();
    expect(caminhoDoDeepLink("aether://settings")).toBeNull();
    expect(caminhoDoDeepLink("aether://app/s/abc123")).toBeNull();
    expect(caminhoDoDeepLink("https://evil.com/invite/abc123")).toBeNull();
    expect(caminhoDoDeepLink("javascript:alert(1)")).toBeNull();
    expect(caminhoDoDeepLink("")).toBeNull();
    expect(caminhoDoDeepLink(null)).toBeNull();
  });

  it("acha a URL entre os argumentos de processo", () => {
    expect(
      deepLinkNosArgs(["C:/Aether.exe", "--flag", "aether://invite/deadbeef00"]),
    ).toBe("/invite/deadbeef00");
    expect(deepLinkNosArgs(["C:/Aether.exe", "--flag"])).toBeNull();
    expect(deepLinkNosArgs(undefined)).toBeNull();
  });
});
