/**
 * Configuracao do gateway, validada no boot.
 *
 * Falhar aqui e barato; falhar no primeiro handshake (com o servico "no ar")
 * e caro. As variaveis vem do MESMO .env da raiz que o Next usa — injetado
 * pelo dotenv-cli nos scripts do monorepo — para que os dois assinem e
 * verifiquem o token com o mesmo segredo.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} ausente. O gateway le o .env da raiz do monorepo; rode via "npm run dev:realtime".`,
    );
  }
  return value;
}

const authSecret = required("AUTH_SECRET");
if (authSecret.length < 32) {
  throw new Error("AUTH_SECRET curto demais (minimo 32 caracteres).");
}

export const env = {
  /** so validamos a presenca: quem usa o segredo e @aether/access */
  authSecret,
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.REALTIME_PORT ?? 4000),
  /**
   * O navegador so envia o cookie de sessao no handshake se a origem estiver
   * explicitamente liberada e credentials estiver ligado. Sem isso o gateway
   * recebe conexao anonima e recusa tudo.
   */
  corsOrigin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  isProduction: process.env.NODE_ENV === "production",
} as const;

if (Number.isNaN(env.port)) {
  throw new Error("REALTIME_PORT precisa ser um numero.");
}
