import { describe, expect, it } from "vitest";
import { sanitizeNextPath } from "@/lib/next-path";

/**
 * `sanitizeNextPath` e a fronteira entre o `?next=` que vem do navegador e o
 * `redirect()` do login. Um filtro fraco aqui vira open redirect logo depois
 * de a pessoa digitar a senha.
 */
describe("sanitizeNextPath", () => {
  it("aceita caminhos internos das areas permitidas", () => {
    expect(sanitizeNextPath("/app")).toBe("/app");
    expect(sanitizeNextPath("/app/s/abc123")).toBe("/app/s/abc123");
    expect(sanitizeNextPath("/invite/u7yd4hvw3")).toBe("/invite/u7yd4hvw3");
    expect(sanitizeNextPath("/invite/abc?ref=x")).toBe("/invite/abc?ref=x");
  });

  it("recusa URL absoluta e volta ao padrao", () => {
    expect(sanitizeNextPath("https://evil.com")).toBe("/app");
    expect(sanitizeNextPath("http://evil.com/app")).toBe("/app");
  });

  it("recusa barra dupla e barra-contrabarra (absoluto disfarcado)", () => {
    expect(sanitizeNextPath("//evil.com")).toBe("/app");
    expect(sanitizeNextPath("/\\evil.com")).toBe("/app");
    expect(sanitizeNextPath("/\\/evil.com")).toBe("/app");
  });

  it("recusa caminhos fora da allowlist", () => {
    expect(sanitizeNextPath("/")).toBe("/app");
    expect(sanitizeNextPath("/login")).toBe("/app");
    expect(sanitizeNextPath("/appearance-hack")).toBe("/app");
    expect(sanitizeNextPath("/api/cron/limpar-anexos")).toBe("/app");
  });

  it("recusa vazio, nulo e controles", () => {
    expect(sanitizeNextPath("")).toBe("/app");
    expect(sanitizeNextPath(null)).toBe("/app");
    expect(sanitizeNextPath(undefined)).toBe("/app");
    expect(sanitizeNextPath("/app\n/evil")).toBe("/app");
    expect(sanitizeNextPath("/app\\..\\evil")).toBe("/app");
  });

  it("respeita um fallback customizado", () => {
    expect(sanitizeNextPath("https://evil.com", "/invite/x")).toBe("/invite/x");
  });
});
