import { Prisma, prisma } from "@aether/db";
import {
  chaveDoPeriodo,
  type MetricaDeMissao,
  type PeriodoDeMissao,
  type PresenceEntry,
  type VoiceParticipant,
} from "@aether/shared";
import { log } from "@aether/shared/log";

/**
 * Progresso das missoes (Estagio 2 da loja), contado AQUI porque so o gateway
 * sabe quem esta em voz e quem esta jogando agora.
 *
 * COMO CONTA. A cada minuto, `contarMinuto` olha as conexoes desta instancia
 * e soma, em memoria, um minuto de voz e/ou de jogo para quem se qualifica. A
 * cada 5 minutos, `gravar` leva o acumulado ao banco num lote so. Uma queda do
 * processo perde no maximo esse intervalo — troca consciente por nao escrever
 * no banco a cada minuto de cada pessoa.
 *
 * UMA VEZ POR PESSOA, mesmo com varias instancias e varias abas: a voz conta
 * na instancia que segura o socket DE VOZ dela; o jogo, na que segura o menor
 * id entre os sockets dela (a lista vem do estado compartilhado). As duas
 * escolhas sao deterministicas, entao duas instancias nunca contam o mesmo
 * minuto.
 *
 * O QUE NAO CONTA:
 *  - voz sozinho no canal (precisa de mais alguem) ou ensurdecido — ficar num
 *    canal vazio com o fone tirado nao e "estar em voz";
 *  - jogo com a pessoa invisivel (o jogo ja e escondido de todos).
 *
 * O teto do que se ganha e o proprio catalogo: cada missao paga uma vez por
 * periodo, por mais minutos que se acumulem.
 */

// ---------------------------------------------------------------- regras puras

/** Este minuto conta como "em voz"? */
export function minutoContaEmVoz(
  participante: Pick<VoiceParticipant, "channelId" | "selfDeafened" | "serverDeafened"> | null,
  pessoasNoCanal: number,
): boolean {
  if (!participante?.channelId) return false;
  if (participante.selfDeafened || participante.serverDeafened) return false;
  return pessoasNoCanal >= 2;
}

/** Este minuto conta como "jogando"? */
export function minutoContaJogando(
  entrada: Pick<PresenceEntry, "game" | "status"> | null,
): boolean {
  return !!entrada?.game && entrada.status !== "OFFLINE";
}

// ------------------------------------------------------------------ acumulador

type Acumulado = { voz: number; jogo: number };
const acumulado = new Map<string, Acumulado>();

function somar(userId: string, campo: keyof Acumulado): void {
  const a = acumulado.get(userId) ?? { voz: 0, jogo: 0 };
  a[campo] += 1;
  acumulado.set(userId, a);
}

/** O que esta em memoria agora (para teste e para o desligamento). */
export function acumuladoAtual(): ReadonlyMap<string, Acumulado> {
  return acumulado;
}

export interface EstadoParaContar {
  /** userId -> ids dos sockets DESTA instancia */
  socketsLocais: Map<string, Set<string>>;
  voiceSocketOf(userId: string): Promise<string | null>;
  voiceParticipant(userId: string): Promise<VoiceParticipant | null>;
  countInChannel(channelId: string): Promise<number>;
  socketIdsOf(userId: string): Promise<string[]>;
  presenceEntryOf(userId: string): Promise<PresenceEntry | null>;
}

/** Soma um minuto para quem se qualifica nesta instancia. */
export async function contarMinuto(estado: EstadoParaContar): Promise<void> {
  for (const [userId, locais] of estado.socketsLocais) {
    const vozSocket = await estado.voiceSocketOf(userId);
    if (vozSocket && locais.has(vozSocket)) {
      const p = await estado.voiceParticipant(userId);
      const pessoas = p?.channelId ? await estado.countInChannel(p.channelId) : 0;
      if (minutoContaEmVoz(p, pessoas)) somar(userId, "voz");
    }

    const todos = [...(await estado.socketIdsOf(userId))].sort();
    if (todos[0] && locais.has(todos[0])) {
      if (minutoContaJogando(await estado.presenceEntryOf(userId))) {
        somar(userId, "jogo");
      }
    }
  }
}

// -------------------------------------------------------------------- gravacao

interface MissaoAtiva {
  id: string;
  metrica: MetricaDeMissao;
  periodo: PeriodoDeMissao;
}

/** O catalogo muda raramente; relido no maximo a cada 5 minutos. */
let catalogo: { lidoEm: number; missoes: MissaoAtiva[] } | null = null;
const CATALOGO_TTL_MS = 5 * 60 * 1000;

async function missoesAtivas(): Promise<MissaoAtiva[]> {
  if (catalogo && Date.now() - catalogo.lidoEm < CATALOGO_TTL_MS) {
    return catalogo.missoes;
  }
  const missoes = await prisma.missao.findMany({
    where: { ativa: true },
    select: { id: true, metrica: true, periodo: true },
  });
  catalogo = { lidoEm: Date.now(), missoes };
  return missoes;
}

/** Para teste: esquece o catalogo em cache e o acumulado. */
export function reiniciarMissoes(): void {
  catalogo = null;
  acumulado.clear();
  diasMarcados.clear();
}

function incremento(userId: string, missaoId: string, periodo: string, valor: number) {
  return prisma.progressoDeMissao.upsert({
    where: { userId_missaoId_periodo: { userId, missaoId, periodo } },
    create: { userId, missaoId, periodo, valor },
    update: { valor: { increment: valor } },
  });
}

/**
 * Leva o acumulado ao banco, num lote so, e zera a memoria. Se a escrita
 * falhar, o acumulado VOLTA para a memoria, para a proxima tentativa.
 */
export async function gravar(agora = new Date()): Promise<void> {
  if (acumulado.size === 0) return;
  const lote = new Map(acumulado);
  acumulado.clear();

  try {
    const missoes = await missoesAtivas();
    const porMetrica = (m: MetricaDeMissao) => missoes.filter((x) => x.metrica === m);
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const [userId, { voz, jogo }] of lote) {
      for (const [metrica, minutos] of [
        ["MINUTOS_EM_VOZ", voz],
        ["MINUTOS_JOGANDO", jogo],
      ] as const) {
        if (minutos <= 0) continue;
        for (const m of porMetrica(metrica)) {
          ops.push(incremento(userId, m.id, chaveDoPeriodo(m.periodo, agora), minutos));
        }
      }
    }
    if (ops.length > 0) await prisma.$transaction(ops);
  } catch (erro) {
    for (const [userId, a] of lote) {
      const atual = acumulado.get(userId) ?? { voz: 0, jogo: 0 };
      acumulado.set(userId, { voz: atual.voz + a.voz, jogo: atual.jogo + a.jogo });
    }
    log.error("gateway.missoes.gravar", "não gravei o progresso das missões", {
      err: erro,
      pessoas: lote.size,
    });
  }
}

// ------------------------------------------------------------------ dia ativo

/** Quem ja foi marcado hoje NESTE processo — evita ir ao banco a cada reconexao. */
const diasMarcados = new Set<string>();

function ehDuplicado(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

/**
 * A pessoa abriu o app hoje. A diaria de DIAS_ATIVOS ganha 1 (uma vez por
 * dia); a semanal so soma 1 quando o DIA e novo, e por isso depende de a
 * linha da diaria ter sido CRIADA agora, e nao so encontrada.
 */
export async function marcarDiaAtivo(userId: string, agora = new Date()): Promise<void> {
  const hoje = chaveDoPeriodo("DIARIA", agora);
  const marca = `${userId}:${hoje}`;
  if (diasMarcados.has(marca)) return;
  diasMarcados.add(marca);
  // A memoria nao cresce para sempre: virou o dia, so o dia de hoje importa.
  if (diasMarcados.size > 50_000) {
    for (const m of diasMarcados) if (!m.endsWith(hoje)) diasMarcados.delete(m);
  }

  const missoes = (await missoesAtivas()).filter((m) => m.metrica === "DIAS_ATIVOS");
  const diarias = missoes.filter((m) => m.periodo === "DIARIA");
  const semanais = missoes.filter((m) => m.periodo === "SEMANAL");

  // Sem missao diaria, nao ha como saber se o dia e novo: usa a semanal so
  // pela memoria do processo (melhor esforco, documentado).
  let diaNovo = diarias.length === 0;
  for (const m of diarias) {
    try {
      await prisma.progressoDeMissao.create({
        data: { userId, missaoId: m.id, periodo: hoje, valor: 1 },
      });
      diaNovo = true;
    } catch (erro) {
      if (!ehDuplicado(erro)) throw erro;
    }
  }

  if (!diaNovo) return;
  for (const m of semanais) {
    await incremento(userId, m.id, chaveDoPeriodo("SEMANAL", agora), 1);
  }
}
