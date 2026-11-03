import type { Redis } from "ioredis";
import { CONVITE_RETENCAO_MS, type ConviteDeJogo } from "@aether/shared";
import { redisClients } from "../redis-client";

/**
 * Onde os convites de jogo vivem — o mesmo par memoria/Redis do resto do
 * estado do gateway (`state.ts`): sem `REDIS_URL`, um `Map`; com ela,
 * compartilhado entre instancias, para o aceite chegar mesmo que o
 * destinatario esteja conectado em outra maquina.
 *
 * Nada aqui decide regra: so guarda, lista e TROCA DE ESTADO COM CONDICAO.
 * `transicionar` so grava se o convite ainda estiver `pendente` — e o que
 * resolve a corrida aceitar x cancelar x expirar sem trava: quem chega
 * segundo encontra o estado ja mudado e recebe `ja_respondido`.
 */
export interface ArmazemDeConvites {
  criar(convite: ConviteDeJogo): Promise<void>;
  buscar(id: string): Promise<ConviteDeJogo | null>;
  /** Os convites em que a pessoa e remetente OU destinataria, ainda guardados. */
  daPessoa(userId: string): Promise<ConviteDeJogo[]>;
  /**
   * Grava `novo` SO se o atual ainda estiver pendente. `false` = ja tinha
   * mudado (ou sumiu) — quem chamou perdeu a corrida.
   */
  transicionar(novo: ConviteDeJogo): Promise<boolean>;
}

/** Ate quando guardar: validade + retencao para o "como entrar" sobreviver a um reload. */
function guardarAte(convite: ConviteDeJogo): number {
  return new Date(convite.expiraEm).getTime() + CONVITE_RETENCAO_MS;
}

export function criarArmazemEmMemoria(agora: () => number = Date.now): ArmazemDeConvites {
  const porId = new Map<string, ConviteDeJogo>();
  const porPessoa = new Map<string, Set<string>>();

  function vivo(id: string): ConviteDeJogo | null {
    const c = porId.get(id);
    if (!c) return null;
    if (guardarAte(c) < agora()) {
      porId.delete(id);
      return null;
    }
    return c;
  }

  function indexar(userId: string, id: string) {
    let s = porPessoa.get(userId);
    if (!s) {
      s = new Set();
      porPessoa.set(userId, s);
    }
    s.add(id);
  }

  return {
    async criar(convite) {
      porId.set(convite.id, convite);
      indexar(convite.de.id, convite.id);
      indexar(convite.para.id, convite.id);
    },
    async buscar(id) {
      return vivo(id);
    },
    async daPessoa(userId) {
      const ids = porPessoa.get(userId);
      if (!ids) return [];
      const lista: ConviteDeJogo[] = [];
      for (const id of ids) {
        const c = vivo(id);
        // Faxina preguicosa: o indice so encolhe quando alguem le.
        if (c) lista.push(c);
        else ids.delete(id);
      }
      if (ids.size === 0) porPessoa.delete(userId);
      return lista;
    },
    async transicionar(novo) {
      const atual = vivo(novo.id);
      if (!atual || atual.estado !== "pendente") return false;
      porId.set(novo.id, novo);
      return true;
    },
  };
}

const chave = (id: string) => `aether:convite:${id}`;
const indice = (userId: string) => `aether:convites:${userId}`;

/**
 * Troca condicional em Lua: le, confere `estado == pendente`, grava mantendo o
 * TTL — atomico no Redis, entre qualquer numero de instancias.
 */
const LUA_TRANSICIONAR = `
local atual = redis.call('GET', KEYS[1])
if not atual then return 0 end
local ok, obj = pcall(cjson.decode, atual)
if not ok or obj.estado ~= 'pendente' then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'KEEPTTL')
return 1
`;

export function criarArmazemRedis(redis: Redis): ArmazemDeConvites {
  return {
    async criar(convite) {
      const ate = guardarAte(convite);
      const ms = Math.max(1_000, ate - Date.now());
      await redis
        .multi()
        .set(chave(convite.id), JSON.stringify(convite), "PX", ms)
        .sadd(indice(convite.de.id), convite.id)
        .pexpire(indice(convite.de.id), ms)
        .sadd(indice(convite.para.id), convite.id)
        .pexpire(indice(convite.para.id), ms)
        .exec();
    },
    async buscar(id) {
      const bruto = await redis.get(chave(id));
      return bruto ? (JSON.parse(bruto) as ConviteDeJogo) : null;
    },
    async daPessoa(userId) {
      const ids = await redis.smembers(indice(userId));
      if (ids.length === 0) return [];
      const brutos = await redis.mget(ids.map(chave));
      const sumidos = ids.filter((_, i) => brutos[i] === null);
      if (sumidos.length > 0) await redis.srem(indice(userId), ...sumidos);
      return brutos
        .filter((b): b is string => b !== null)
        .map((b) => JSON.parse(b) as ConviteDeJogo);
    },
    async transicionar(novo) {
      const r = await redis.eval(LUA_TRANSICIONAR, 1, chave(novo.id), JSON.stringify(novo));
      return r === 1;
    },
  };
}

export const armazemDeConvites: ArmazemDeConvites = redisClients
  ? criarArmazemRedis(redisClients.main)
  : criarArmazemEmMemoria();
