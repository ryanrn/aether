/**
 * Configuracao lida no boot, com os limites ja validados.
 *
 * Mesma logica do gateway do Aether: falhar aqui e barato, falhar no meio da
 * live e caro. Numero invalido derruba o processo agora, antes de alguem estar
 * transmitindo.
 */

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((argument) => argument.startsWith(prefix));
  return hit?.slice(prefix.length);
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} precisa ser um numero positivo (recebi "${raw}").`);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

/**
 * `--source=` vence a variavel de ambiente porque `npm run sim` precisa
 * funcionar igual no Windows, e `TIKTOK_SOURCE=x npm start` nao funciona la.
 */
const source = flag("source") ?? process.env.TIKTOK_SOURCE ?? "live";
if (source !== "live" && source !== "simulator") {
  throw new Error(`TIKTOK_SOURCE invalido: "${source}". Use "live" ou "simulator".`);
}

export const env = {
  host: process.env.BRIDGE_HOST ?? "127.0.0.1",
  port: num("BRIDGE_PORT", 8080),
  gamesFile: process.env.BRIDGE_GAMES_FILE ?? "./games.json",
  source,
  signApiKey: process.env.TIKTOK_SIGN_API_KEY ?? null,

  queueCapacity: num("QUEUE_CAPACITY", 400),
  actionTtlMs: num("ACTION_TTL_MS", 45_000),
  /**
   * O HttpService do Roblox aborta a requisicao aos 30s. Segurar mais que isso
   * significa que TODA volta do loop termina em erro de timeout no jogo.
   */
  longPollMaxMs: Math.min(num("LONG_POLL_MAX_MS", 20_000), 25_000),

  viewerRateCapacity: num("VIEWER_RATE_CAPACITY", 4),
  viewerRateRefillPerSec: num("VIEWER_RATE_REFILL_PER_SEC", 0.5),
  globalRatePerSec: num("GLOBAL_RATE_PER_SEC", 25),
  dedupeWindowMs: num("DEDUPE_WINDOW_MS", 3_000),

  /** So para desenvolvimento e para o verify.mjs: ritmo do simulador. */
  simIntervalMs: num("SIM_INTERVAL_MS", 700),

  openCloudKey: process.env.ROBLOX_OPEN_CLOUD_KEY ?? null,
  resolveRobloxUsers: bool("RESOLVE_ROBLOX_USERS", true),

  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;

if (env.queueCapacity < 10) {
  throw new Error("QUEUE_CAPACITY abaixo de 10 nao segura nem uma rajada de likes.");
}
