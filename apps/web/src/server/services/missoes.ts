import "server-only";

import { prisma } from "@aether/db";
import {
  chaveDoPeriodo,
  type MetricaDeMissao,
  type MissaoDaPessoa,
  type MissaoNoPainel,
  type PeriodoDeMissao,
} from "@aether/shared";

/**
 * Missoes (Estagio 2 da loja), o lado do app web: listar com o progresso de
 * agora, resgatar, e o catalogo da equipe. Quem CONTA o progresso e o gateway
 * (`apps/realtime/src/missoes.ts`); aqui so se le e se resgata.
 */

export class MissaoNaoEncontrada extends Error {
  override name = "MissaoNaoEncontrada";
}
export class MissaoIncompleta extends Error {
  override name = "MissaoIncompleta";
}
export class MissaoJaResgatada extends Error {
  override name = "MissaoJaResgatada";
}

/** As missoes ativas, cada uma com o progresso da pessoa no periodo ATUAL. */
export async function missoesDe(userId: string, agora = new Date()): Promise<MissaoDaPessoa[]> {
  const missoes = await prisma.missao.findMany({
    where: { ativa: true },
    orderBy: [{ ordem: "asc" }, { createdAt: "asc" }],
  });
  if (missoes.length === 0) return [];

  const periodos = {
    DIARIA: chaveDoPeriodo("DIARIA", agora),
    SEMANAL: chaveDoPeriodo("SEMANAL", agora),
  } as const;
  const progresso = await prisma.progressoDeMissao.findMany({
    where: {
      userId,
      missaoId: { in: missoes.map((m) => m.id) },
      periodo: { in: [periodos.DIARIA, periodos.SEMANAL] },
    },
    select: { missaoId: true, periodo: true, valor: true, resgatadaEm: true },
  });
  const chave = (missaoId: string, periodo: string) => `${missaoId}|${periodo}`;
  const porMissao = new Map(progresso.map((p) => [chave(p.missaoId, p.periodo), p]));

  return missoes.map((m) => {
    const p = porMissao.get(chave(m.id, periodos[m.periodo as PeriodoDeMissao]));
    const valor = p?.valor ?? 0;
    return {
      id: m.id,
      titulo: m.titulo,
      descricao: m.descricao,
      metrica: m.metrica as MetricaDeMissao,
      periodo: m.periodo as PeriodoDeMissao,
      meta: m.meta,
      recompensa: m.recompensa,
      valor,
      concluida: valor >= m.meta,
      resgatada: !!p?.resgatadaEm,
    };
  });
}

/**
 * Resgata a recompensa de uma missao concluida no periodo ATUAL. Marcar como
 * resgatada, creditar o saldo e escrever o extrato acontecem juntos.
 *
 * Duas garantias contra resgatar duas vezes: o `updateMany` so marca linha com
 * `resgatadaEm IS NULL` (o segundo clique encontra zero linhas), e o extrato
 * tem `chave` unica por pessoa, missao e periodo.
 */
export async function resgatarMissao(
  userId: string,
  missaoId: string,
  agora = new Date(),
): Promise<{ saldo: number; recompensa: number }> {
  return prisma.$transaction(async (tx) => {
    const m = await tx.missao.findUnique({
      where: { id: missaoId },
      select: { ativa: true, meta: true, recompensa: true, periodo: true },
    });
    if (!m || !m.ativa) throw new MissaoNaoEncontrada();

    const periodo = chaveDoPeriodo(m.periodo as PeriodoDeMissao, agora);
    const { count } = await tx.progressoDeMissao.updateMany({
      where: { userId, missaoId, periodo, resgatadaEm: null, valor: { gte: m.meta } },
      data: { resgatadaEm: agora },
    });
    if (count === 0) {
      const p = await tx.progressoDeMissao.findUnique({
        where: { userId_missaoId_periodo: { userId, missaoId, periodo } },
        select: { valor: true, resgatadaEm: true },
      });
      if (p?.resgatadaEm) throw new MissaoJaResgatada();
      throw new MissaoIncompleta();
    }

    const { saldoMoedas } = await tx.user.update({
      where: { id: userId },
      data: { saldoMoedas: { increment: m.recompensa } },
      select: { saldoMoedas: true },
    });
    await tx.movimentoDeMoedas.create({
      data: {
        userId,
        valor: m.recompensa,
        saldoDepois: saldoMoedas,
        motivo: "MISSAO",
        referencia: missaoId,
        chave: `missao:${userId}:${missaoId}:${periodo}`,
      },
    });
    return { saldo: saldoMoedas, recompensa: m.recompensa };
  });
}

// ------------------------------------------------------------- painel da equipe

export async function catalogoDeMissoes(): Promise<MissaoNoPainel[]> {
  const missoes = await prisma.missao.findMany({
    orderBy: [{ ordem: "asc" }, { createdAt: "asc" }],
  });
  return missoes.map((m) => ({
    id: m.id,
    slug: m.slug,
    titulo: m.titulo,
    descricao: m.descricao,
    metrica: m.metrica as MetricaDeMissao,
    periodo: m.periodo as PeriodoDeMissao,
    meta: m.meta,
    recompensa: m.recompensa,
    ativa: m.ativa,
  }));
}

/**
 * A equipe ajusta meta, recompensa ou liga/desliga. Mudar a meta no meio do
 * periodo vale na hora para quem ainda nao resgatou.
 */
export async function ajustarMissao(
  missaoId: string,
  dados: { meta?: number; recompensa?: number; ativa?: boolean },
): Promise<void> {
  const existe = await prisma.missao.findUnique({ where: { id: missaoId }, select: { id: true } });
  if (!existe) throw new MissaoNaoEncontrada();
  await prisma.missao.update({ where: { id: missaoId }, data: dados });
}
