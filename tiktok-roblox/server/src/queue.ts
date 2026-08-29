/**
 * A fila que o Roblox consulta. Uma por jogo.
 *
 * DECISAO CENTRAL: cursor, nao pop.
 *
 * A tentacao e `GET /pull` esvaziar a fila. Nao serve: se a resposta HTTP se
 * perde no caminho (e ela se perde — tunel, wi-fi, servidor do Roblox trocando
 * de datacenter), as acoes ja sairam da fila e ninguem mais as ve. Com cursor,
 * o Roblox diz "ja processei ate a 128" e reler e inofensivo. A entrega vira
 * idempotente e uma requisicao perdida custa uma volta de loop, nao eventos.
 *
 * A fila TEM prazo. Acao mais velha que `ttlMs` nunca e entregue: se o jogo
 * ficou 3 minutos fora do ar, despejar 3 minutos de comentario de uma vez
 * derruba o servidor do Roblox e mostra reacao a um assunto que a live ja
 * deixou para tras. Perder e melhor que atrasar.
 */
import type { Action, PullResult } from "./types.ts";

interface Waiter {
  /** A partir de qual seq esta espera considera que houve novidade. */
  since: number;
  resolve: (value: void) => void;
  timer: NodeJS.Timeout;
}

export interface ActionQueue {
  push(action: Omit<Action, "seq">): Action;
  pull(since: number, max: number): PullResult;
  /** Espera ate haver algo depois de `since`, ou ate estourar `waitMs`. */
  wait(since: number, waitMs: number): Promise<void>;
  stats(): { queued: number; cursor: number; dropped: number };
  stop(): void;
}

export function createQueue({
  capacity,
  ttlMs,
  now = Date.now,
}: {
  capacity: number;
  ttlMs: number;
  now?: () => number;
}): ActionQueue {
  /** Sempre ordenado por seq crescente. */
  let items: Action[] = [];
  let nextSeq = 1;
  let droppedTotal = 0;
  const waiters = new Set<Waiter>();

  /** Menor seq que AINDA da para entregar. */
  function oldestAvailableSeq(): number {
    return items[0]?.seq ?? nextSeq;
  }

  function prune(): void {
    const cutoff = now() - ttlMs;
    let cut = 0;
    while (cut < items.length && items[cut]!.at < cutoff) cut += 1;
    if (cut > 0) {
      items = items.slice(cut);
      droppedTotal += cut;
    }
  }

  /**
   * `seq` = a acao que acabou de entrar. Acordar so quem espera por algo ANTES
   * dela: um cursor adiantado (jogo que guardou o cursor de outra encarnacao da
   * ponte) acordaria a cada evento e receberia lista vazia em laco.
   */
  function wake(seq: number | null): void {
    for (const waiter of waiters) {
      if (seq !== null && waiter.since >= seq) continue;
      clearTimeout(waiter.timer);
      waiter.resolve();
      waiters.delete(waiter);
    }
  }

  const sweep = setInterval(prune, 5_000);
  sweep.unref?.();

  return {
    push(partial) {
      const action: Action = { ...partial, seq: nextSeq };
      nextSeq += 1;
      items.push(action);
      if (items.length > capacity) {
        // Estourou: a mais VELHA sai. A live e agora; backlog nao interessa.
        items = items.slice(items.length - capacity);
        droppedTotal += 1;
      }
      wake(action.seq);
      return action;
    },

    pull(since, max) {
      prune();
      /**
       * `since` maior que o cursor so acontece quando a ponte reiniciou e o
       * Roblox guardou um cursor de outra encarnacao. Tratar como zero: o
       * contrario deixaria o jogo mudo para sempre, esperando um seq que nunca
       * vai existir.
       */
      const from = since > nextSeq - 1 ? 0 : since;
      const oldest = oldestAvailableSeq();
      const dropped = from < oldest - 1 ? oldest - 1 - from : 0;
      const pending = items.filter((action) => action.seq > from);
      const actions = pending.slice(0, max);
      const cursor = actions.at(-1)?.seq ?? Math.max(from, oldest - 1);
      return { actions, cursor, dropped, queued: items.length };
    },

    wait(since, waitMs) {
      prune();
      const hasNews = items.some((action) => action.seq > since);
      if (hasNews || waitMs <= 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const waiter: Waiter = {
          since,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            resolve();
          }, waitMs),
        };
        // Sem `unref` de proposito: e o unico handle que segura a espera viva
        // quando a fila e usada fora do servidor HTTP (teste, script solto).
        waiters.add(waiter);
      });
    },

    stats: () => ({ queued: items.length, cursor: nextSeq - 1, dropped: droppedTotal }),

    stop() {
      clearInterval(sweep);
      wake(null);
    },
  };
}
