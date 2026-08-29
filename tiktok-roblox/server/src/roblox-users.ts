/**
 * Nome de usuario do Roblox -> userId.
 *
 * POR QUE ISTO MORA AQUI E NAO NO JOGO: o HttpService do Roblox recusa
 * requisicao para qualquer dominio roblox.com. Um script no jogo simplesmente
 * nao consegue chamar users.roblox.com — a chamada falha, sempre, e a mensagem
 * de erro nao explica o motivo. A ponte roda fora do Roblox e nao tem essa
 * restricao, entao ela resolve o id e manda pronto.
 *
 * Com o id em maos, o jogo invoca o avatar REAL da pessoa
 * (`Players:CreateHumanoidModelFromUserId`) em vez do boneco padrao.
 */

const ENDPOINT = "https://users.roblox.com/v1/usernames/users";
const HIT_TTL_MS = 60 * 60 * 1000;
/**
 * Erro tambem entra em cache, com prazo curto: sem isso, alguem digitando um
 * nome que nao existe a cada comentario vira uma chamada de rede por
 * comentario.
 */
const MISS_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 4_000;

interface Entry {
  userId: number | null;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

/** Regra do Roblox: 3 a 20 caracteres, letras/numeros/underscore. */
function isPlausible(username: string): boolean {
  return /^[A-Za-z0-9_]{3,20}$/.test(username);
}

export async function resolveRobloxUserId(username: string): Promise<number | null> {
  const clean = username.trim().replace(/^@/, "");
  if (!isPlausible(clean)) return null;

  const key = clean.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usernames: [clean], excludeBannedUsers: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { data?: Array<{ id?: number }> };
    const userId = body.data?.[0]?.id ?? null;
    cache.set(key, {
      userId,
      expiresAt: Date.now() + (userId === null ? MISS_TTL_MS : HIT_TTL_MS),
    });
    return userId;
  } catch (error) {
    /**
     * Falha de rede NAO vira cache negativo: a live continua, e daqui a pouco
     * a chamada volta a funcionar. Cachear a falha deixaria a pessoa sem avatar
     * por cinco minutos por causa de um pacote perdido.
     */
    console.warn(
      `[roblox] nao resolvi "${clean}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
