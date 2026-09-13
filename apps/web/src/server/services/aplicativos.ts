import "server-only";

import { prisma } from "@aether/db";
import { gerarTokenDeBot } from "@aether/access";

/**
 * Developer Portal — a camada de dados das `Application`.
 *
 * Cada funcao recebe `userId` e so age no que e DELE (`Application.ownerId`).
 * Nao-dono e tratado como inexistente — 404, nunca 403, como no resto do app.
 * O token de bot nunca sai daqui em claro: `gerarTokenDeApp` devolve o segredo
 * UMA vez, na geracao, e o banco guarda so o `sha256`.
 *
 * EXCECAO: as duas funcoes no fim do arquivo (`listarAplicacoesParaEquipe` /
 * `definirAplicacaoBloqueada`) sao para a EQUIPE, cruzam qualquer dono — o
 * `blockedAt` ("a equipe desligou a aplicacao inteira, abuso") ja era
 * imposto em tres lugares (`bot-token.ts`, `bot-gateway.ts`,
 * `instalacao.ts`) mas nao tinha nenhuma tela nem action pra ser ACIONADO —
 * so dava pra ligar mexendo direto no banco.
 */

export interface AppNaLista {
  id: string;
  name: string;
  avatarUrl: string | null;
  botHabilitado: boolean;
  instalacoes: number;
}

export async function listarMinhasApps(userId: string): Promise<AppNaLista[]> {
  const apps = await prisma.application.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      botUserId: true,
      _count: { select: { installations: { where: { revokedAt: null } } } },
    },
  });
  return apps.map((a) => ({
    id: a.id,
    name: a.name,
    avatarUrl: a.avatarUrl,
    botHabilitado: a.botUserId !== null,
    instalacoes: a._count.installations,
  }));
}

export interface AppDetalhe {
  id: string;
  name: string;
  descricao: string | null;
  avatarUrl: string | null;
  bloqueada: boolean;
  bot: {
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  tokens: Array<{
    id: string;
    prefixo: string;
    lastUsedAt: string | null;
    createdAt: string;
    revokedAt: string | null;
  }>;
  instalacoes: number;
}

/** O app com tudo que o portal desenha, ou `null` se nao existe / nao e seu. */
export async function carregarApp(
  appId: string,
  userId: string,
): Promise<AppDetalhe | null> {
  const app = await prisma.application.findFirst({
    where: { id: appId, ownerId: userId },
    select: {
      id: true,
      name: true,
      descricao: true,
      avatarUrl: true,
      blockedAt: true,
      bot: {
        select: { id: true, username: true, displayName: true, avatarUrl: true },
      },
      tokens: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          prefixo: true,
          lastUsedAt: true,
          createdAt: true,
          revokedAt: true,
        },
      },
      _count: { select: { installations: { where: { revokedAt: null } } } },
    },
  });
  if (!app) return null;

  return {
    id: app.id,
    name: app.name,
    descricao: app.descricao,
    avatarUrl: app.avatarUrl,
    bloqueada: app.blockedAt !== null,
    bot: app.bot
      ? {
          userId: app.bot.id,
          username: app.bot.username,
          displayName: app.bot.displayName,
          avatarUrl: app.bot.avatarUrl,
        }
      : null,
    tokens: app.tokens.map((t) => ({
      id: t.id,
      prefixo: t.prefixo,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      revokedAt: t.revokedAt?.toISOString() ?? null,
    })),
    instalacoes: app._count.installations,
  };
}

export async function criarApp(params: {
  ownerId: string;
  name: string;
}): Promise<{ id: string }> {
  const app = await prisma.application.create({
    data: { ownerId: params.ownerId, name: params.name },
    select: { id: true },
  });
  return { id: app.id };
}

/** `null` = nao e seu. */
export async function atualizarApp(params: {
  appId: string;
  userId: string;
  name?: string;
  descricao?: string;
}): Promise<{ ok: true } | null> {
  const { count } = await prisma.application.updateMany({
    where: { id: params.appId, ownerId: params.userId },
    data: {
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.descricao !== undefined
        ? { descricao: params.descricao || null }
        : {}),
    },
  });
  return count === 1 ? { ok: true } : null;
}

export class AppInstaladaEmServidores extends Error {
  override name = "AppInstaladaEmServidores";
}

/**
 * Apaga o app. RECUSA se ainda estiver instalado em algum servidor — o dono
 * desinstala primeiro (a acao de desinstalar tira o bot das salas certas).
 * Depois: `delete` do app leva `BotToken` e `Installation` no cascade, e a
 * linha `User` do bot vai junto (explicito — o cascade nao alcanca `botUserId`).
 */
export async function apagarApp(
  appId: string,
  userId: string,
): Promise<{ removido: boolean }> {
  const app = await prisma.application.findFirst({
    where: { id: appId, ownerId: userId },
    select: {
      botUserId: true,
      _count: { select: { installations: { where: { revokedAt: null } } } },
    },
  });
  if (!app) return { removido: false };
  if (app._count.installations > 0) throw new AppInstaladaEmServidores();

  await prisma.$transaction(async (tx) => {
    await tx.application.delete({ where: { id: appId } });
    if (app.botUserId) {
      await tx.user.deleteMany({ where: { id: app.botUserId, kind: "BOT" } });
    }
  });
  return { removido: true };
}

export class UsernameEmUso extends Error {
  override name = "UsernameEmUso";
}
export class BotJaHabilitado extends Error {
  override name = "BotJaHabilitado";
}

/**
 * Habilita o bot: cria a linha `User` (`kind = BOT`, sem senha nem e-mail, sem
 * receber DM/pedido de amizade) e aponta `Application.botUserId`.
 */
export async function habilitarBot(params: {
  appId: string;
  userId: string;
  username: string;
  displayName: string;
}): Promise<{ botUserId: string } | null> {
  const app = await prisma.application.findFirst({
    where: { id: params.appId, ownerId: params.userId },
    select: { id: true, botUserId: true },
  });
  if (!app) return null;
  if (app.botUserId) throw new BotJaHabilitado();

  const usernameLower = params.username.toLowerCase();
  const existe = await prisma.user.findFirst({
    where: { username: usernameLower },
    select: { id: true },
  });
  if (existe) throw new UsernameEmUso();

  const botUserId = await prisma.$transaction(async (tx) => {
    const bot = await tx.user.create({
      data: {
        username: usernameLower,
        displayName: params.displayName,
        kind: "BOT",
        allowServerDms: false,
        allowServerFriendRequests: false,
      },
      select: { id: true },
    });
    await tx.application.update({
      where: { id: app.id },
      data: { botUserId: bot.id },
    });
    return bot.id;
  });

  return { botUserId };
}

export class BotNaoHabilitado extends Error {
  override name = "BotNaoHabilitado";
}

/**
 * Gera um token novo. Revoga os anteriores VIVOS (rotacao) e devolve o segredo
 * EM CLARO — a unica vez que ele existe fora do hash.
 */
export async function gerarTokenDeApp(
  appId: string,
  userId: string,
): Promise<{ token: string; prefixo: string } | null> {
  const app = await prisma.application.findFirst({
    where: { id: appId, ownerId: userId },
    select: { id: true, botUserId: true },
  });
  if (!app) return null;
  if (!app.botUserId) throw new BotNaoHabilitado();

  const { token, tokenHash, prefixo } = gerarTokenDeBot();

  await prisma.$transaction(async (tx) => {
    await tx.botToken.updateMany({
      where: { applicationId: appId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.botToken.create({
      data: { applicationId: appId, tokenHash, prefixo },
    });
  });

  return { token, prefixo };
}

/* ------------------------------------------------------- painel da equipe */

export interface AppNoPainelDaEquipe {
  id: string;
  name: string;
  /** username de quem criou — `null` se a conta foi removida depois. */
  ownerUsername: string | null;
  bloqueada: boolean;
  botHabilitado: boolean;
  instalacoes: number;
  criadoEm: string;
}

/**
 * Lista aplicacoes de QUALQUER dono, para a equipe encontrar uma pra
 * bloquear. `busca` filtra por nome (o id tambem serve, pra quem tem o id
 * de um log de erro/denuncia em maos). Sem paginacao de verdade — corte de
 * 100 e suficiente pra um catalogo do tamanho que a Developer Platform tem
 * hoje; se crescer, e o primeiro lugar a rever.
 */
export async function listarAplicacoesParaEquipe(
  busca?: string,
): Promise<AppNoPainelDaEquipe[]> {
  const termo = busca?.trim();
  const apps = await prisma.application.findMany({
    where: termo
      ? {
          OR: [
            { name: { contains: termo, mode: "insensitive" } },
            { id: termo },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      ownerId: true,
      blockedAt: true,
      botUserId: true,
      createdAt: true,
      _count: { select: { installations: { where: { revokedAt: null } } } },
    },
  });
  if (apps.length === 0) return [];

  // Application.ownerId nao e relacao viva (proposito: registro de auditoria,
  // nao FK) — resolve o username numa segunda consulta em lote.
  const ownerIds = [...new Set(apps.map((a) => a.ownerId))];
  const owners = await prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, username: true },
  });
  const usernamePorId = new Map(owners.map((o) => [o.id, o.username]));

  return apps.map((a) => ({
    id: a.id,
    name: a.name,
    ownerUsername: usernamePorId.get(a.ownerId) ?? null,
    bloqueada: a.blockedAt !== null,
    botHabilitado: a.botUserId !== null,
    instalacoes: a._count.installations,
    criadoEm: a.createdAt.toISOString(),
  }));
}

/**
 * Liga ou desliga o kill switch de uma aplicacao. Soft — so seta/limpa
 * `blockedAt`, nunca apaga nada; o efeito (token recusa, gateway evita,
 * instalacao nao resolve) ja estava implementado em tres lugares, so faltava
 * quem acionasse.
 *
 * Devolve o nome pra quem chamou poder logar de forma legivel, ou `null` se
 * o id nao existe.
 */
export async function definirAplicacaoBloqueada(
  id: string,
  bloquear: boolean,
): Promise<{ name: string } | null> {
  const feito = await prisma.application.updateMany({
    where: { id },
    data: { blockedAt: bloquear ? new Date() : null },
  });
  if (feito.count === 0) return null;

  const app = await prisma.application.findUnique({
    where: { id },
    select: { name: true },
  });
  return app ? { name: app.name } : null;
}
