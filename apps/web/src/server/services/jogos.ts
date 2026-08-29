import "server-only";

import { prisma } from "@aether/db";
import {
  normalizarExecutavel,
  type JogoConhecido,
  type JogoNaFila,
  type StatusDeJogo,
} from "@aether/shared";

/**
 * A biblioteca de jogos da comunidade.
 *
 * Fluxo: alguem sugere um executavel que a deteccao nao reconheceu, a
 * sugestao entra numa fila, a equipe revisa, e o aprovado passa a valer para
 * a base inteira.
 *
 * Nada aqui decide QUEM pode fazer o que — isso e o guard da action. Este
 * arquivo so sabe mexer nas tabelas.
 */

/** Quantas linhas a fila devolve por vez. Revisao e trabalho humano. */
const TAMANHO_DA_FILA = 100;

/**
 * Registra uma sugestao.
 *
 * DUAS COISAS ACONTECEM, e a ordem importa: a linha do jogo nasce (ou e
 * reencontrada) pela CHAVE normalizada, e a pessoa e ligada a ela. A segunda
 * parte e o que faz o contador significar "pessoas distintas" em vez de
 * "cliques".
 *
 * `upsert` na sugestao, e nao "existe? senao cria": duas abas da mesma pessoa
 * clicando junto perderiam a corrida e uma delas explodiria no indice unico.
 * Com upsert, a segunda simplesmente nao faz nada.
 *
 * Sugerir um jogo JA APROVADO nao e erro nem vira nada: a resposta diz que ja
 * existe, e a tela usa isso para explicar por que nada mudou.
 */
export async function sugerirJogo(
  userId: string,
  executavel: string,
  nome: string,
): Promise<{ status: StatusDeJogo; jaSugerido: boolean }> {
  const chave = normalizarExecutavel(executavel);

  const jogo = await prisma.jogoDaComunidade.upsert({
    where: { chave },
    update: {},
    create: { chave, executavel: executavel.trim(), nome: nome.trim() },
    select: { id: true, status: true },
  });

  /**
   * Jogo ja RECUSADO nao volta para a fila. Sem isto, um executavel que a
   * equipe rejeitou reapareceria toda vez que alguem abrisse o programa, e a
   * fila viveria cheia da mesma recusa.
   */
  if (jogo.status === "RECUSADO") {
    return { status: "RECUSADO", jaSugerido: true };
  }

  const antes = await prisma.sugestaoDeJogo.findUnique({
    where: { jogoId_userId: { jogoId: jogo.id, userId } },
    select: { id: true },
  });

  if (!antes) {
    await prisma.sugestaoDeJogo.upsert({
      where: { jogoId_userId: { jogoId: jogo.id, userId } },
      update: {},
      create: { jogoId: jogo.id, userId },
    });
  }

  return { status: jogo.status, jaSugerido: Boolean(antes) };
}

/**
 * O catalogo aprovado — o que o desktop baixa.
 *
 * So `chave` e `nome`: quem sugeriu, quando e quantos nao interessam a quem
 * so quer casar um processo com um nome, e nao ha razao para atravessarem a
 * rede.
 */
export async function listarJogosAprovados(): Promise<JogoConhecido[]> {
  const linhas = await prisma.jogoDaComunidade.findMany({
    where: { status: "APROVADO" },
    select: { chave: true, nome: true },
    orderBy: { nome: "asc" },
  });
  return linhas;
}

/**
 * A fila de revisao.
 *
 * Ordenada por NUMERO DE PESSOAS, decrescente: o que mais gente pediu e o que
 * mais vale o tempo de quem revisa. Empate cai no mais antigo, para que uma
 * sugestao solitaria nao fique presa para sempre no fim.
 */
export async function listarFilaDeJogos(
  status: StatusDeJogo = "PENDENTE",
): Promise<JogoNaFila[]> {
  const linhas = await prisma.jogoDaComunidade.findMany({
    where: { status },
    select: {
      id: true,
      chave: true,
      executavel: true,
      nome: true,
      status: true,
      createdAt: true,
      _count: { select: { sugestoes: true } },
    },
    orderBy: [{ sugestoes: { _count: "desc" } }, { createdAt: "asc" }],
    take: TAMANHO_DA_FILA,
  });

  return linhas.map((l) => ({
    id: l.id,
    chave: l.chave,
    executavel: l.executavel,
    nome: l.nome,
    status: l.status,
    sugestoes: l._count.sugestoes,
    createdAt: l.createdAt.toISOString(),
  }));
}

/**
 * Aprova ou recusa, e opcionalmente corrige o nome.
 *
 * O nome e corrigivel na revisao porque quem sugere costuma mandar o nome do
 * PROCESSO, e nem sempre e o nome do jogo: `VALORANT-Win64-Shipping` precisa
 * virar "VALORANT" antes de aparecer na tela de alguem.
 *
 * Guarda quem revisou e quando: um jogo aprovado passa a valer para a base
 * inteira, e decisao com esse alcance precisa ter dono.
 */
export async function revisarJogo(
  jogoId: string,
  revisorId: string,
  status: Extract<StatusDeJogo, "APROVADO" | "RECUSADO">,
  nome?: string,
): Promise<boolean> {
  const resultado = await prisma.jogoDaComunidade.updateMany({
    /**
     * O status entra no WHERE, e nao numa leitura antes: assim duas pessoas da
     * equipe clicando junto nao gravam uma por cima da outra — a segunda casa
     * zero linhas e sabe que chegou tarde.
     */
    where: { id: jogoId, status: "PENDENTE" },
    data: {
      status,
      revisadoPor: revisorId,
      revisadoEm: new Date(),
      ...(nome ? { nome: nome.trim() } : {}),
    },
  });
  return resultado.count === 1;
}

/** Quantas esperam revisao — o numerinho ao lado da entrada do painel. */
export async function contarJogosPendentes(): Promise<number> {
  return prisma.jogoDaComunidade.count({ where: { status: "PENDENTE" } });
}
