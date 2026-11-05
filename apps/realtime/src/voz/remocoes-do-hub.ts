import type { Redis } from "ioredis";
import { HUB_ESPERA_APOS_REMOCAO_MIN } from "@aether/shared";
import { redisClients } from "../redis-client";

/**
 * Quem foi tirado de uma sala do hub, e ate quando nao volta (fase 2, 4b-2).
 *
 * Fica no REDIS quando o gateway roda com ele (varias instancias: a pessoa
 * removida pode tentar voltar por outra maquina) e na memoria quando nao. Nao
 * vai para o banco: e estado curto (15 min), de uma sala que some sozinha
 * quando esvazia — tabela para isso seria migracao e faxina por nada.
 *
 * `criarRemocoes` recebe o cliente por parametro para o teste usar memoria.
 */

export interface RemocoesDoHub {
  registrar(channelId: string, userId: string): Promise<void>;
  /** Milissegundos que ainda faltam; 0 = pode entrar. */
  esperaRestante(channelId: string, userId: string): Promise<number>;
}

const chave = (channelId: string, userId: string) => `gw:hub-remocao:${channelId}:${userId}`;

export function criarRemocoes(
  redis: Redis | null,
  esperaMs = HUB_ESPERA_APOS_REMOCAO_MIN * 60_000,
  agora: () => number = Date.now,
): RemocoesDoHub {
  if (redis) {
    return {
      async registrar(channelId, userId) {
        // PX: o Redis apaga sozinho quando vence — nada para limpar depois.
        await redis.set(chave(channelId, userId), "1", "PX", esperaMs);
      },
      async esperaRestante(channelId, userId) {
        const ms = await redis.pttl(chave(channelId, userId));
        return ms > 0 ? ms : 0;
      },
    };
  }

  const ate = new Map<string, number>();
  return {
    async registrar(channelId, userId) {
      // Faxina barata a cada registro: so o que ja venceu.
      const t = agora();
      for (const [k, v] of ate) if (v <= t) ate.delete(k);
      ate.set(chave(channelId, userId), t + esperaMs);
    },
    async esperaRestante(channelId, userId) {
      const fim = ate.get(chave(channelId, userId));
      return fim ? Math.max(0, fim - agora()) : 0;
    },
  };
}

export const remocoesDoHub = criarRemocoes(redisClients?.main ?? null);
