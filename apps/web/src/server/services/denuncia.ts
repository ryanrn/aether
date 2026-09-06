import "server-only";

import { prisma } from "@aether/db";
import type { AlvoDeDenuncia, StatusDeDenuncia } from "@aether/db";
import {
  motivoDeDenunciaValido,
  type DenunciaNaFila,
} from "@aether/shared";

/**
 * Camada de dados da denuncia de abuso.
 *
 * Sem checagem de permissao aqui: `denunciarAction` exige conta logada,
 * `listarDenunciasAction`/`resolverDenunciaAction` exigem equipe. Mesma
 * convencao dos outros services. `DenunciaNaFila` mora em `@aether/shared`
 * (a tela da equipe e cliente e nao pode importar daqui).
 */

export { motivoDeDenunciaValido as motivoValido };
export type { DenunciaNaFila };

/**
 * O que o alvo dizia na hora da denuncia. Capturado agora porque o alvo pode
 * ser apagado antes de a equipe olhar — e ai revisariam no escuro.
 */
async function capturarSnapshot(
  tipo: AlvoDeDenuncia,
  alvoId: string,
): Promise<string | null> {
  if (tipo === "MENSAGEM") {
    const m = await prisma.message.findUnique({
      where: { id: alvoId },
      select: { content: true, author: { select: { username: true } } },
    });
    if (!m) return null;
    const texto = m.content.length > 500 ? `${m.content.slice(0, 500)}…` : m.content;
    return `@${m.author.username}: ${texto}`;
  }
  if (tipo === "USUARIO") {
    const u = await prisma.user.findUnique({
      where: { id: alvoId },
      select: { username: true, displayName: true },
    });
    return u ? `@${u.username} (${u.displayName})` : null;
  }
  if (tipo === "SERVIDOR") {
    const s = await prisma.server.findUnique({
      where: { id: alvoId },
      select: { name: true },
    });
    return s ? `servidor "${s.name}"` : null;
  }
  return null;
}

/**
 * Cria uma denuncia. Devolve `duplicada: true` (sem criar) se este mesmo
 * reporter ja tem uma denuncia ABERTA sobre o mesmo alvo — insistir nao
 * acelera a fila, so infla o numero de "quantas denuncias sobre X".
 */
export async function criarDenuncia(params: {
  tipo: AlvoDeDenuncia;
  alvoId: string;
  motivo: string;
  detalhe: string | null;
  reporterId: string;
}): Promise<{ ok: true; duplicada: boolean }> {
  const jaAberta = await prisma.denuncia.findFirst({
    where: {
      reporterId: params.reporterId,
      tipo: params.tipo,
      alvoId: params.alvoId,
      status: { in: ["ABERTA", "EM_ANALISE"] },
    },
    select: { id: true },
  });
  if (jaAberta) return { ok: true, duplicada: true };

  const snapshot = await capturarSnapshot(params.tipo, params.alvoId);

  await prisma.denuncia.create({
    data: {
      tipo: params.tipo,
      alvoId: params.alvoId,
      motivo: params.motivo,
      detalhe: params.detalhe,
      snapshot,
      reporterId: params.reporterId,
    },
  });
  return { ok: true, duplicada: false };
}

const PAGINA = 25;

export async function listarDenuncias(opcoes: {
  status?: StatusDeDenuncia;
  before?: string;
}): Promise<{ itens: DenunciaNaFila[]; temMais: boolean }> {
  const rows = await prisma.denuncia.findMany({
    where: opcoes.status ? { status: opcoes.status } : undefined,
    select: {
      id: true,
      tipo: true,
      alvoId: true,
      motivo: true,
      detalhe: true,
      snapshot: true,
      status: true,
      notaEquipe: true,
      createdAt: true,
      reporter: { select: { id: true, displayName: true, username: true } },
    },
    orderBy: { createdAt: "asc" },
    take: PAGINA + 1,
    ...(opcoes.before ? { cursor: { id: opcoes.before }, skip: 1 } : {}),
  });

  const temMais = rows.length > PAGINA;
  const pagina = temMais ? rows.slice(0, PAGINA) : rows;

  // "quantas sobre o mesmo alvo" em lote — uma consulta por grupo (tipo,alvo).
  const chaves = [...new Set(pagina.map((r) => `${r.tipo}::${r.alvoId}`))];
  const contagens = new Map<string, number>();
  await Promise.all(
    chaves.map(async (chave) => {
      const [tipo, alvoId] = chave.split("::") as [AlvoDeDenuncia, string];
      const n = await prisma.denuncia.count({ where: { tipo, alvoId } });
      contagens.set(chave, n);
    }),
  );

  // O userId por tras de cada alvo — para "silenciar autor" sem prompt.
  const autores = await resolverAutores(pagina);

  return {
    temMais,
    itens: pagina.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      alvoId: r.alvoId,
      motivo: r.motivo,
      detalhe: r.detalhe,
      snapshot: r.snapshot,
      status: r.status,
      notaEquipe: r.notaEquipe,
      reporter: r.reporter,
      autorDoAlvoId: autores.get(`${r.tipo}::${r.alvoId}`) ?? null,
      totalSobreAlvo: contagens.get(`${r.tipo}::${r.alvoId}`) ?? 1,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/**
 * Para cada (tipo, alvoId) da pagina, o userId responsavel: autor da mensagem,
 * o proprio usuario, ou o dono do servidor. Em lote, uma consulta por tipo.
 */
async function resolverAutores(
  linhas: { tipo: AlvoDeDenuncia; alvoId: string }[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const msgIds = [
    ...new Set(linhas.filter((l) => l.tipo === "MENSAGEM").map((l) => l.alvoId)),
  ];
  const serverIds = [
    ...new Set(linhas.filter((l) => l.tipo === "SERVIDOR").map((l) => l.alvoId)),
  ];

  for (const l of linhas) {
    if (l.tipo === "USUARIO") mapa.set(`USUARIO::${l.alvoId}`, l.alvoId);
  }

  if (msgIds.length) {
    const msgs = await prisma.message.findMany({
      where: { id: { in: msgIds } },
      select: { id: true, authorId: true },
    });
    for (const m of msgs) mapa.set(`MENSAGEM::${m.id}`, m.authorId);
  }
  if (serverIds.length) {
    const srvs = await prisma.server.findMany({
      where: { id: { in: serverIds } },
      select: { id: true, ownerId: true },
    });
    for (const s of srvs) mapa.set(`SERVIDOR::${s.id}`, s.ownerId);
  }
  return mapa;
}

export async function contarDenunciasAbertas(): Promise<number> {
  return prisma.denuncia.count({ where: { status: "ABERTA" } });
}

/**
 * Fecha uma denuncia. `status` final e RESOLVIDA ou DESCARTADA; a nota conta
 * o que foi feito. NAO aplica a acao em si (silenciar, apagar) — isso e action
 * separada, para o rastro ficar claro: "resolvi" e uma coisa, "silenciei o
 * autor" e outra.
 */
export async function resolverDenuncia(params: {
  id: string;
  status: "RESOLVIDA" | "DESCARTADA";
  notaEquipe: string | null;
  resolvidaPor: string;
}): Promise<boolean> {
  const r = await prisma.denuncia.updateMany({
    where: { id: params.id, status: { in: ["ABERTA", "EM_ANALISE"] } },
    data: {
      status: params.status,
      notaEquipe: params.notaEquipe,
      resolvidaPor: params.resolvidaPor,
      resolvidaEm: new Date(),
    },
  });
  return r.count > 0;
}

/** Apaga uma mensagem denunciada (soft delete, como a acao normal de apagar). */
export async function apagarMensagemPorModeracao(
  messageId: string,
): Promise<boolean> {
  const r = await prisma.message.updateMany({
    where: { id: messageId, deletedAt: null },
    data: { deletedAt: new Date(), content: "" },
  });
  return r.count > 0;
}
