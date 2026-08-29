import "server-only";

import { prisma } from "@aether/db";
import {
  ehCategoriaValida,
  type ComunidadeNaVitrine,
  type PedidoDeVitrine,
  type VitrineStatus,
} from "@aether/shared";
import { presencaDeServidores } from "../realtime-notify";

/**
 * "Explorar comunidades" — a vitrine.
 *
 * So lista servidor APROVADO. Isso e a garantia inteira aqui: servidor privado,
 * pendente ou recusado nao existe para esta tela — nem por busca, nem por
 * categoria, nem por id.
 */

/** Quantos cards por pagina. */
const POR_PAGINA = 48;

export interface FiltroDaVitrine {
  categoria?: string | null;
  busca?: string;
}

/**
 * A vitrine, ja com contagem de membros e de quem esta online.
 *
 * ORDENACAO: oficiais primeiro, depois os maiores. Fixar os oficiais no topo e
 * o pedido explicito do produto; o tamanho como segundo criterio evita que a
 * vitrine pareca aleatoria — e comunidade grande e o que da a alguem que chega
 * alguma chance de encontrar gente conversando.
 */
export async function listarVitrine(
  userId: string,
  filtro: FiltroDaVitrine = {},
): Promise<ComunidadeNaVitrine[]> {
  const categoria =
    filtro.categoria && ehCategoriaValida(filtro.categoria)
      ? filtro.categoria
      : null;
  const busca = (filtro.busca ?? "").trim();

  const linhas = await prisma.server.findMany({
    where: {
      vitrine: "APROVADO",
      ...(categoria ? { categoria } : {}),
      /**
       * Busca no NOME e na DESCRICAO. `insensitive` porque ninguem digita a
       * caixa certa de um nome que esta procurando.
       */
      ...(busca
        ? {
            OR: [
              { name: { contains: busca, mode: "insensitive" as const } },
              { descricao: { contains: busca, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      iconUrl: true,
      descricao: true,
      categoria: true,
      oficial: true,
      _count: { select: { members: true } },
      /**
       * A propria participacao, e nao a lista de membros: pedir os membros
       * todos para descobrir se EU estou entre eles traria centenas de linhas
       * por card. Filtrado pelo id, volta zero ou uma.
       */
      members: { where: { userId }, select: { id: true }, take: 1 },
    },
    orderBy: [{ oficial: "desc" }, { members: { _count: "desc" } }, { name: "asc" }],
    take: POR_PAGINA,
  });

  /**
   * A contagem de online vem do GATEWAY, onde a presenca vive. Uma chamada so
   * para todos os ids — nao uma por card.
   *
   * Devolve `null` por servidor quando o gateway nao responde. `null` e
   * diferente de zero: "ninguem online" e "nao sei" nao sao a mesma coisa, e
   * mostrar zero seria afirmar algo falso sobre uma comunidade cheia.
   */
  const online = await presencaDeServidores(linhas.map((l) => l.id));

  return linhas.map((l) => ({
    id: l.id,
    nome: l.name,
    iconUrl: l.iconUrl,
    descricao: l.descricao,
    categoria: l.categoria,
    oficial: l.oficial,
    membros: l._count.members,
    online: online?.[l.id] ?? null,
    souMembro: l.members.length > 0,
  }));
}

/**
 * Entra num servidor PUBLICO, sem convite.
 *
 * Caminho separado do convite de proposito: o convite prova que alguem de
 * dentro quis te chamar, e a vitrine prova que a comunidade quer ser
 * encontrada. Sao autorizacoes diferentes, e juntar as duas num codigo so
 * daria a qualquer pessoa a chance de entrar em servidor privado alegando ter
 * vindo da vitrine.
 *
 * Devolve o motivo da recusa em vez de lancar: a tela precisa distinguir "voce
 * esta banido" de "esse servidor nao esta mais publico".
 */
export type ResultadoDeEntrada =
  | { ok: true; jaEra: boolean }
  | { ok: false; motivo: "nao-encontrado" | "banido" };

export async function entrarEmComunidade(
  userId: string,
  serverId: string,
): Promise<ResultadoDeEntrada> {
  const servidor = await prisma.server.findFirst({
    /**
     * O status NO WHERE, e nao numa checagem depois: servidor que nao esta
     * aprovado responde igual a servidor inexistente, e nao "voce nao pode
     * entrar nesse". A regra do projeto e nao revelar existencia de recurso.
     *
     * Vale tambem para PENDENTE: um pedido em analise ainda nao autoriza
     * ninguem a entrar sem convite.
     */
    where: { id: serverId, vitrine: "APROVADO" },
    select: { id: true },
  });
  if (!servidor) return { ok: false, motivo: "nao-encontrado" };

  const banido = await prisma.ban.findFirst({
    where: {
      serverId,
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (banido) return { ok: false, motivo: "banido" };

  const jaMembro = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
    select: { id: true },
  });
  if (jaMembro) return { ok: true, jaEra: true };

  /**
   * O cargo padrao entra junto, como no caminho do convite. Sem ele a pessoa
   * fica sem permissao nenhuma e o servidor parece quebrado para quem acabou
   * de chegar.
   */
  const cargoPadrao = await prisma.role.findFirst({
    where: { serverId, isDefault: true },
    select: { id: true },
  });

  try {
    await prisma.serverMember.create({
      data: {
        serverId,
        userId,
        ...(cargoPadrao
          ? { roles: { create: { roleId: cargoPadrao.id } } }
          : {}),
      },
    });
  } catch {
    /**
     * Corrida com outra aba da mesma pessoa: o indice unico do par deixa so
     * uma passar, e a que perdeu ja tem o que queria.
     */
    return { ok: true, jaEra: true };
  }

  return { ok: true, jaEra: false };
}

/** Os ajustes de vitrine do servidor, para a tela de configuracoes desenhar. */
export async function lerAjustesDeVitrine(serverId: string) {
  return prisma.server.findUnique({
    where: { id: serverId },
    select: {
      vitrine: true,
      descricao: true,
      categoria: true,
      oficial: true,
    },
  });
}

/**
 * O dono pede (ou desiste de) aparecer na vitrine, e ajusta o que vai no card.
 *
 * NAO APROVA NADA. Ligar leva a PENDENTE; quem decide e a equipe.
 *
 * A TRANSICAO DEPENDE DE ONDE ESTA, e nao e um simples liga-desliga:
 *
 *  - desligar sempre volta a PRIVADO, inclusive de APROVADO. Sair da vitrine
 *    e direito do dono e nao precisa de ninguem.
 *  - ligar a partir de PRIVADO vira PENDENTE.
 *  - ligar a partir de RECUSADO tambem vira PENDENTE: recusado nao e banido, e
 *    quem corrigiu o que motivou a recusa merece uma segunda leitura.
 *  - ja APROVADO continua APROVADO — reativar nao devolve para a fila.
 *
 * MUDAR A DESCRICAO DE UM SERVIDOR LISTADO O DEVOLVE A FILA. Sem isso, a
 * revisao seria facil de driblar: aprova como "Comunidade de Xadrez", depois
 * troca o texto. Quem esta privado edita a vontade — so quem esta na vitrine
 * paga por uma nova leitura.
 */
export async function salvarAjustesDeVitrine(
  serverId: string,
  ajustes: { querAparecer: boolean; descricao: string; categoria: string | null },
): Promise<{ status: VitrineStatus; voltouParaFila: boolean }> {
  const atual = await prisma.server.findUnique({
    where: { id: serverId },
    select: { vitrine: true, descricao: true },
  });
  if (!atual) throw new Error("Servidor nao encontrado");

  const descricao = ajustes.descricao.trim() || null;
  const mudouTexto = descricao !== atual.descricao;

  let proximo: VitrineStatus;
  let voltouParaFila = false;

  if (!ajustes.querAparecer) {
    proximo = "PRIVADO";
  } else if (atual.vitrine === "APROVADO") {
    if (mudouTexto) {
      proximo = "PENDENTE";
      voltouParaFila = true;
    } else {
      proximo = "APROVADO";
    }
  } else {
    proximo = "PENDENTE";
  }

  await prisma.server.update({
    where: { id: serverId },
    data: {
      vitrine: proximo,
      // Descricao vazia vira NULA: string vazia e "escreveu nada", e o card
      // precisa distinguir isso de "nao ha descricao".
      descricao,
      categoria: ajustes.categoria,
      // A revisao anterior deixa de valer quando o pedido volta para a fila.
      ...(proximo === "PENDENTE"
        ? { vitrineRevisadaPor: null, vitrineRevisadaEm: null }
        : {}),
    },
  });

  return { status: proximo, voltouParaFila };
}

/**
 * Renomear um servidor LISTADO o devolve a fila.
 *
 * Mesma razao da descricao, e este e o caso mais grave: o nome e o que
 * identifica a comunidade na vitrine, e "Comunidade de Xadrez" virando outra
 * coisa depois de aprovado e exatamente como se dribla uma revisao.
 *
 * Chamada de quem troca o nome, e nao daqui: o servico da vitrine nao deve
 * saber quando alguem renomeia um servidor.
 */
export async function reavaliarVitrinePorRenomear(
  serverId: string,
): Promise<boolean> {
  const r = await prisma.server.updateMany({
    // So mexe em quem esta APROVADO: privado e pendente nao tem o que perder.
    where: { id: serverId, vitrine: "APROVADO" },
    data: { vitrine: "PENDENTE", vitrineRevisadaPor: null, vitrineRevisadaEm: null },
  });
  return r.count === 1;
}

/** A fila de pedidos. So a equipe ve. */
export async function listarPedidosDeVitrine(
  status: VitrineStatus = "PENDENTE",
): Promise<PedidoDeVitrine[]> {
  const linhas = await prisma.server.findMany({
    where: { vitrine: status },
    select: {
      id: true,
      name: true,
      iconUrl: true,
      descricao: true,
      categoria: true,
      createdAt: true,
      owner: { select: { username: true } },
      _count: { select: { members: true } },
    },
    // Maiores primeiro: comunidade com gente e a que mais custa deixar esperando.
    orderBy: [{ members: { _count: "desc" } }, { createdAt: "asc" }],
    take: 100,
  });

  return linhas.map((l) => ({
    id: l.id,
    nome: l.name,
    iconUrl: l.iconUrl,
    descricao: l.descricao,
    categoria: l.categoria,
    membros: l._count.members,
    status,
    dono: l.owner.username,
    criadoEm: l.createdAt.toISOString(),
  }));
}

/**
 * A equipe aprova ou recusa um pedido.
 *
 * O status entra no WHERE: duas pessoas da equipe decidindo junto nao gravam
 * uma por cima da outra — a segunda casa zero linhas e sabe que chegou tarde.
 */
export async function revisarPedidoDeVitrine(
  serverId: string,
  revisorId: string,
  decisao: "APROVADO" | "RECUSADO",
): Promise<boolean> {
  const r = await prisma.server.updateMany({
    where: { id: serverId, vitrine: "PENDENTE" },
    data: {
      vitrine: decisao,
      vitrineRevisadaPor: revisorId,
      vitrineRevisadaEm: new Date(),
    },
  });
  return r.count === 1;
}

/** Quantos pedidos esperam — o numerinho do painel. */
export async function contarPedidosPendentes(): Promise<number> {
  return prisma.server.count({ where: { vitrine: "PENDENTE" } });
}
