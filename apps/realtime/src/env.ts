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

/**
 * Origens liberadas para o handshake.
 *
 * Uma LISTA. Antes era uma string unica (`NEXT_PUBLIC_APP_URL`), e isso
 * derrubava o realtime inteiro sempre que a URL de producao da Vercel
 * divergia do valor no Fly, ou num preview deploy — o navegador so manda o
 * cookie/handshake se a origem bater exatamente (auditoria M4).
 *
 * `REALTIME_CORS_ORIGINS` (opcional, virgula-separada) e a lista completa;
 * sem ela, cai em `NEXT_PUBLIC_APP_URL` sozinha, comportamento de antes.
 * `NEXT_PUBLIC_APP_URL` fica so como URL canonica (link de e-mail etc.) — nao
 * misturar as duas responsabilidades numa variavel so.
 */
const corsOrigin = (
  process.env.REALTIME_CORS_ORIGINS ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000"
)
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter((o) => o.length > 0);

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
  corsOrigin,
  isProduction: process.env.NODE_ENV === "production",
} as const;

if (corsOrigin.length === 0) {
  throw new Error("NEXT_PUBLIC_APP_URL nao tem nenhuma origem valida.");
}

if (Number.isNaN(env.port)) {
  throw new Error("REALTIME_PORT precisa ser um numero.");
}
