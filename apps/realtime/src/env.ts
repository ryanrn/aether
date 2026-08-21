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

/**
 * LiveKit e OPCIONAL de proposito. Sem as chaves o gateway continua subindo e
 * registrando ocupacao de canal — o app fica exatamente como estava antes da
 * fase 4, so sem audio. Falhar o boot inteiro por falta de uma credencial de
 * midia deixaria presenca e chat fora do ar junto.
 */
const livekitUrl = process.env.LIVEKIT_URL ?? null;
const livekitKey = process.env.LIVEKIT_API_KEY ?? null;
const livekitSecret = process.env.LIVEKIT_API_SECRET ?? null;

const livekit =
  livekitUrl && livekitKey && livekitSecret
    ? { url: livekitUrl, apiKey: livekitKey, apiSecret: livekitSecret }
    : null;

if (!livekit && (livekitUrl || livekitKey || livekitSecret)) {
  // Configuracao pela metade e pior que nenhuma: falha na hora de conectar,
  // longe da causa. Melhor gritar no boot.
  throw new Error(
    "LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET precisam estar os tres presentes, ou nenhum.",
  );
}

export const env = {
  /** null = sem SFU configurado; a voz funciona sem audio */
  livekit,
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
