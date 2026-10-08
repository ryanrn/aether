import { beforeEach, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import type { PublicUser } from "@aether/shared";
import { memoryStore } from "../../apps/realtime/src/state-memory";
import { createRedisStore } from "../../apps/realtime/src/state-redis";
import type { StateStore } from "../../apps/realtime/src/state-store";

/**
 * Paridade entre as duas implementacoes de `StateStore` — a garantia que
 * faltava. A interface (`state-store.ts`) so trava a FORMA das duas baterem;
 * nao trava o COMPORTAMENTO. O bug de mute/deafen corrigido nesta sessao
 * (ensurdecer forcava mudo, e nunca desfazia ao tirar) existia nas DUAS
 * implementacoes ao mesmo tempo, mas nada impede uma futura mudanca de
 * corrigir uma e esquecer a outra — exatamente o cenario em que isso passaria
 * despercebido em dev (sem `REDIS_URL`, so a versao em memoria roda) ate
 * aparecer em producao.
 *
 * ESCOPO DELIBERADO: so os metodos de VOZ, que so usam HSET/HGETALL/SADD/SREM
 * no lado Redis — nenhum EVAL/Lua. `rate-limit-redis.test.ts` ja documenta
 * por que nao faz sentido testar Lua contra um duble ("um duble que
 * interpretasse o script estaria testando o duble") — a mesma logica vale
 * aqui, entao presenca (`attachSocket`/join-server/leave-server, que usam
 * Lua) fica de fora deste arquivo.
 *
 * O duble de Redis e um Map em memoria cobrindo so os comandos de hash/set
 * que os metodos de voz de fato chamam — nao e um Redis de brinquedo
 * genérico, e o minimo pra `createRedisStore` rodar sem rede nenhuma.
 */

function criarRedisFalso() {
  const hashes = new Map<string, Record<string, string>>();
  const sets = new Map<string, Set<string>>();

  function hashDe(chave: string): Record<string, string> {
    let h = hashes.get(chave);
    if (!h) {
      h = {};
      hashes.set(chave, h);
    }
    return h;
  }
  function setDe(chave: string): Set<string> {
    let s = sets.get(chave);
    if (!s) {
      s = new Set();
      sets.set(chave, s);
    }
    return s;
  }

  const fake = {
    // ioredis aceita as DUAS formas: hset(chave, campo, valor) e
    // hset(chave, {campo: valor, ...}) — o codigo real usa as duas
    // (setVoiceCamera/Streaming/Speaking passam campo+valor soltos;
    // joinVoice/setServerVoiceFlags passam um objeto).
    async hset(
      chave: string,
      campoOuObjeto: string | Record<string, string>,
      valor?: string,
    ) {
      const h = hashDe(chave);
      if (typeof campoOuObjeto === "string") {
        h[campoOuObjeto] = valor as string;
        return 1;
      }
      Object.assign(h, campoOuObjeto);
      return Object.keys(campoOuObjeto).length;
    },
    async hgetall(chave: string) {
      return { ...(hashes.get(chave) ?? {}) };
    },
    async hget(chave: string, campo: string) {
      return hashes.get(chave)?.[campo] ?? null;
    },
    async hmget(chave: string, ...campos: string[]) {
      const h = hashes.get(chave) ?? {};
      return campos.map((c) => h[c] ?? null);
    },
    async hdel(chave: string, campo: string) {
      const h = hashes.get(chave);
      if (!h || !(campo in h)) return 0;
      delete h[campo];
      return 1;
    },
    async hkeys(chave: string) {
      return Object.keys(hashes.get(chave) ?? {});
    },
    async del(chave: string) {
      const existia = hashes.delete(chave);
      return existia ? 1 : 0;
    },
    async exists(chave: string) {
      return hashes.has(chave) ? 1 : 0;
    },
    async sadd(chave: string, membro: string) {
      const s = setDe(chave);
      const novo = !s.has(membro);
      s.add(membro);
      return novo ? 1 : 0;
    },
    async srem(chave: string, membro: string) {
      const s = sets.get(chave);
      if (!s || !s.has(membro)) return 0;
      s.delete(membro);
      return 1;
    },
    async smembers(chave: string) {
      return [...(sets.get(chave) ?? [])];
    },
    async scard(chave: string) {
      return sets.get(chave)?.size ?? 0;
    },
    async sismember(chave: string, membro: string) {
      return sets.get(chave)?.has(membro) ? 1 : 0;
    },
    async set(chave: string, valor: string) {
      hashes.set(chave, { __valor: valor });
      return "OK";
    },
    async get(chave: string) {
      return hashes.get(chave)?.__valor ?? null;
    },
  };

  return fake as unknown as Redis;
}

const USUARIO: PublicUser = {
  id: "u-paridade",
  username: "paridade",
  displayName: "Paridade",
  avatarUrl: null,
  status: "ONLINE",
  kind: "HUMAN",
  plano: "FREE",
  moldura: null,
  decoracao: null,
};

/** Roda a MESMA sequencia contra as duas implementacoes; devolve os pares pra comparar. */
async function rodarNasDuas(
  sequencia: (store: StateStore, userId: string) => Promise<unknown[]>,
) {
  const redisFalso = criarRedisFalso();
  const redisStore = createRedisStore(redisFalso);

  // Ids DIFERENTES por implementacao — o `memoryStore` e um singleton
  // (Map de processo) e cada `it()` roda no mesmo modulo, entao reaproveitar
  // um id entre testes vazaria estado de um teste pro outro.
  const idBase = `${Math.random().toString(36).slice(2)}`;

  const daMemoria = await sequencia(memoryStore, `mem-${idBase}`);
  const doRedis = await sequencia(redisStore, `redis-${idBase}`);
  return { daMemoria, doRedis };
}

/** Participante sem os campos que legitimamente diferem entre as duas rodadas (userId, joinedAt). */
function semCamposVolateis(p: unknown): unknown {
  if (!p || typeof p !== "object") return p;
  const { userId: _u, joinedAt: _j, user: _user, ...resto } = p as Record<
    string,
    unknown
  >;
  return resto;
}

describe("paridade state-memory vs state-redis (metodos de voz)", () => {
  beforeEach(() => {
    // memoryStore e singleton: nao ha reset publico, mas cada teste usa um
    // userId novo (via rodarNasDuas), entao nao ha necessidade de limpar.
  });

  it("joinVoice: mesma ocupacao, mesmos defaults", async () => {
    const { daMemoria, doRedis } = await rodarNasDuas(async (store, userId) => {
      await store.joinVoice({
        socketId: "s1",
        userId,
        user: { ...USUARIO, id: userId },
        serverId: "srv1",
        channelId: "ch1",
      });
      const p = await store.voiceParticipant(userId);
      return [semCamposVolateis(p)];
    });
    expect(doRedis).toEqual(daMemoria);
  });

  it("setServerVoiceFlags: ensurdecer sozinho NAO pode virar mudo (a garantia que ja quebrou uma vez)", async () => {
    const { daMemoria, doRedis } = await rodarNasDuas(async (store, userId) => {
      await store.joinVoice({
        socketId: "s1",
        userId,
        user: { ...USUARIO, id: userId },
        serverId: "srv1",
        channelId: "ch1",
      });

      const resultados: unknown[] = [];

      /**
       * SEM mutar antes de proposito: e exatamente o cenario que o bug
       * antigo quebrava — alguem com so DEAFEN_MEMBERS ensurdecendo um
       * alvo que nao estava mudo. Se `serverMuted` come de "false" pra
       * "true" so por causa disto, e o acoplamento voltou.
       */
      const r1 = await store.setServerVoiceFlags(userId, {
        serverDeafened: true,
      });
      resultados.push(semCamposVolateis(r1?.participant));

      // Tirar o ensurdecimento tambem nao pode inventar um mudo que nunca
      // existiu, nem desfazer um mudo que porventura exista de outra fonte.
      const r2 = await store.setServerVoiceFlags(userId, {
        serverDeafened: false,
      });
      resultados.push(semCamposVolateis(r2?.participant));

      return resultados;
    });
    expect(doRedis).toEqual(daMemoria);
    // Trava explicita, nao so "as duas concordam entre si": as DUAS
    // precisam estar CERTAS, nao so iguais uma a outra.
    const [aposEnsurdecer] = doRedis as Array<{
      serverMuted: boolean;
      serverDeafened: boolean;
    }>;
    expect(aposEnsurdecer?.serverMuted).toBe(false);
    expect(aposEnsurdecer?.serverDeafened).toBe(true);
  });

  it("setVoiceFlags (self) + setVoiceCamera + setVoiceStreaming + setVoiceSpeaking: mesma sequencia, mesmo resultado", async () => {
    const { daMemoria, doRedis } = await rodarNasDuas(async (store, userId) => {
      await store.joinVoice({
        socketId: "s1",
        userId,
        user: { ...USUARIO, id: userId },
        serverId: "srv1",
        channelId: "ch1",
      });

      await store.setVoiceFlags(userId, { selfMuted: true });
      await store.setVoiceCamera(userId, true);
      await store.setVoiceStreaming(userId, true);
      const r = await store.setVoiceSpeaking(userId, true);
      return [semCamposVolateis(r?.participant)];
    });
    expect(doRedis).toEqual(daMemoria);
  });

  it("leaveVoice: devolve a mesma forma, e a ocupacao some das duas", async () => {
    const { daMemoria, doRedis } = await rodarNasDuas(async (store, userId) => {
      await store.joinVoice({
        socketId: "s1",
        userId,
        user: { ...USUARIO, id: userId },
        serverId: "srv1",
        channelId: "ch1",
      });
      const saida = await store.leaveVoice(userId);
      const depois = await store.voiceParticipant(userId);
      return [
        saida ? { serverId: saida.serverId, channelId: saida.channelId } : null,
        depois,
      ];
    });
    expect(doRedis).toEqual(daMemoria);
  });

  it("leaveVoice com onlyIfSocket errado: nenhuma das duas remove", async () => {
    const { daMemoria, doRedis } = await rodarNasDuas(async (store, userId) => {
      await store.joinVoice({
        socketId: "s-real",
        userId,
        user: { ...USUARIO, id: userId },
        serverId: "srv1",
        channelId: "ch1",
      });
      const saida = await store.leaveVoice(userId, "s-outro");
      const depois = await store.voiceParticipant(userId);
      return [saida, semCamposVolateis(depois)];
    });
    expect(doRedis).toEqual(daMemoria);
  });
});
