/**
 * Gerador de comentarios falsos.
 *
 * Existe por um motivo pratico: testar o jogo exige uma live no ar, e ninguem
 * vai abrir uma transmissao para descobrir se a bomba explode no lugar certo.
 * Com `npm run sim` o Roblox recebe o mesmo JSON que receberia ao vivo.
 *
 * Tambem e o que o `verify.mjs` usa — por isso a ponte inteira roda sem
 * nenhuma dependencia instalada.
 */
import type { RawEvent } from "../types.ts";
import type { EventSource, SourceOptions, SourceState } from "./types.ts";

const NAMES = [
  "joaozinho", "mari_silva", "pedro.gamer", "lu", "tiktoker_br",
  "ana2010", "zeca", "biel", "duda", "gui_pro",
];

const COMMENTS = [
  "entrar", "pular", "bomba", "bola", "foguete", "dancar", "correr",
  "gigante", "cor vermelho", "cor azul", "sumir", "eu", "pula ai",
  "primeira vez aqui", "manda um oi", "que jogo e esse?",
];

export function createSimulatorSource({
  emit,
  onState,
  intervalMs = 700,
  seed = 1,
}: SourceOptions & { intervalMs?: number; seed?: number }): EventSource {
  let timer: NodeJS.Timeout | null = null;
  let current: SourceState = "stopped";
  /** Gerador previsivel: teste que falha precisa falhar de novo igual. */
  let random = seed;

  function next(max: number): number {
    random = (random * 1103515245 + 12345) % 2147483648;
    // Os bits BAIXOS de um LCG mal alternam: `random % max` devolveria quase
    // sempre o mesmo comentario. Os altos variam.
    return Math.floor(random / 65_536) % max;
  }

  function fakeViewer(): RawEvent["viewer"] {
    const index = next(NAMES.length);
    const handle = NAMES[index]!;
    return {
      id: `tiktok:sim-${index}`,
      handle,
      nickname: handle,
      avatarUrl: null,
      robloxUserId: null,
    };
  }

  return {
    label: "simulador",
    state: () => current,

    start() {
      current = "connected";
      onState(current, "gerando comentarios falsos");
      timer = setInterval(() => {
        const roll = next(100);
        if (roll < 80) {
          emit({ source: "chat", viewer: fakeViewer(), text: COMMENTS[next(COMMENTS.length)]! });
        } else if (roll < 92) {
          emit({ source: "like", viewer: fakeViewer(), text: "", params: { count: 1 + next(20) } });
        } else {
          emit({
            source: "gift",
            viewer: fakeViewer(),
            text: "",
            params: { giftName: "Rosa", diamonds: 1 + next(50), count: 1 + next(5) },
          });
        }
      }, intervalMs);
      timer.unref?.();
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      current = "stopped";
      onState(current);
    },
  };
}
