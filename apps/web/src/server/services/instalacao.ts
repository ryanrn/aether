import "server-only";

import { prisma } from "@aether/db";
import { loadMemberAccess } from "@aether/access";
import { has } from "@aether/shared";

/**
 * Instalacao de bot num servidor — a camada de dados.
 *
 * Instalar = a `Application` esta autorizada a agir naquele servidor. Na
 * pratica isso e uma linha `Installation` MAIS o bot virar `ServerMember` com
 * um cargo — e so por ser membro que `loadMemberAccess` devolve acesso a ele.
 *
 * v1: o bot entra com o cargo `isDefault` do servidor, igual a `joinServerByCode`
 * (permissao de membro comum). O dono restringe depois pelos cargos/overwrites,
 * como faz com qualquer membro. Cargo dedicado "gerenciado" fica para quando
 * houver seletor de permissoes.
 */

export interface AppParaInstalar {
  id: string;
  name: string;
  descricao: string | null;
  avatarUrl: string | null;
  botUserId: string;
}

/**
 * A `Application` pronta para instalar, ou `null` para qualquer impedimento
 * (nao existe, bot nao habilitado, aplicacao bloqueada). Sem detalhe — a tela
 * mostra uma mensagem so.
 */
export async function appParaInstalar(
  applicationId: string,
): Promise<AppParaInstalar | null> {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      name: true,
      descricao: true,
      avatarUrl: true,
      botUserId: true,
      blockedAt: true,
    },
  });
  if (!app || app.blockedAt !== null || app.botUserId === null) return null;
  return {
    id: app.id,
    name: app.name,
    descricao: app.descricao,
    avatarUrl: app.avatarUrl,
    botUserId: app.botUserId,
  };
}

export interface ServidorParaInstalar {
  id: string;
  name: string;
  iconUrl: string | null;
  jaInstalado: boolean;
}

/**
 * Os servidores onde ESTE humano pode instalar um bot — ou seja, onde ele tem
 * MANAGE_SERVER. `jaInstalado` marca os que ja tem esta aplicacao.
 *
 * N consultas (uma `loadMemberAccess` por servidor). Uma pessoa tem poucos
 * servidores; se um dia isso pesar, o jeito e resolver as permissoes em lote,
 * nao afrouxar a checagem.
 */
export async function servidoresGerenciados(
  userId: string,
  applicationId: string,
): Promise<ServidorParaInstalar[]> {
  const membros = await prisma.serverMember.findMany({
    where: { userId },
    orderBy: [{ position: "asc" }, { joinedAt: "asc" }],
    select: { server: { select: { id: true, name: true, iconUrl: true } } },
  });

  const instalados = new Set(
    (
      await prisma.installation.findMany({
        where: {
          applicationId,
          revokedAt: null,
          serverId: { in: membros.map((m) => m.server.id) },
        },
        select: { serverId: true },
      })
    ).map((i) => i.serverId),
  );

  const saida: ServidorParaInstalar[] = [];
  for (const { server } of membros) {
    const acesso = await loadMemberAccess(server.id, userId);
    if (!acesso || !has(acesso.permissions, "MANAGE_SERVER")) continue;
    saida.push({
      id: server.id,
      name: server.name,
      iconUrl: server.iconUrl,
      jaInstalado: instalados.has(server.id),
    });
  }
  return saida;
}

/** Ja instalada (nao revogada) neste servidor? */
export async function botInstalado(
  applicationId: string,
  serverId: string,
): Promise<boolean> {
  const linha = await prisma.installation.findFirst({
    where: { applicationId, serverId, revokedAt: null },
    select: { id: true },
  });
  return linha !== null;
}

/**
 * Instala. Idempotente: chamar de novo numa instalacao viva devolve ok sem
 * duplicar. Transacao — `Installation` + `ServerMember` + `MemberRole` entram
 * juntos ou nao entram.
 */
export async function instalarBot(params: {
  applicationId: string;
  serverId: string;
  botUserId: string;
  installedBy: string;
}): Promise<{ jaEstava: boolean }> {
  const { applicationId, serverId, botUserId, installedBy } = params;

  const existente = await prisma.installation.findUnique({
    where: { applicationId_serverId: { applicationId, serverId } },
    select: { id: true, revokedAt: true },
  });
  if (existente && existente.revokedAt === null) return { jaEstava: true };

  const defaultRole = await prisma.role.findFirst({
    where: { serverId, isDefault: true },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    /**
     * `upsert` na Installation: uma revogada volta a valer sem colidir com o
     * `@@unique([applicationId, serverId])`.
     */
    await tx.installation.upsert({
      where: { applicationId_serverId: { applicationId, serverId } },
      create: { applicationId, serverId, installedBy, scopes: ["messages"] },
      update: { revokedAt: null, installedBy },
    });

    /**
     * O bot pode ter ficado como `ServerMember` de uma instalacao anterior
     * revogada (a desinstalacao apaga, mas defende-se da corrida). `upsert`
     * pelo par unico.
     */
    const membro = await tx.serverMember.upsert({
      where: { serverId_userId: { serverId, userId: botUserId } },
      create: { serverId, userId: botUserId },
      update: {},
      select: { id: true },
    });

    if (defaultRole) {
      await tx.memberRole.upsert({
        where: {
          memberId_roleId: { memberId: membro.id, roleId: defaultRole.id },
        },
        create: { memberId: membro.id, roleId: defaultRole.id },
        update: {},
      });
    }
  });

  return { jaEstava: false };
}

/**
 * Desinstala. Marca a `Installation` como revogada e tira o bot do servidor.
 * `null` se nao havia nada instalado.
 */
export async function desinstalarBot(params: {
  applicationId: string;
  serverId: string;
  botUserId: string;
}): Promise<{ removido: boolean }> {
  const { applicationId, serverId, botUserId } = params;

  const inst = await prisma.installation.findFirst({
    where: { applicationId, serverId, revokedAt: null },
    select: { id: true },
  });
  if (!inst) return { removido: false };

  await prisma.$transaction(async (tx) => {
    await tx.installation.update({
      where: { id: inst.id },
      data: { revokedAt: new Date() },
    });
    /**
     * Apaga o `ServerMember` do bot — o cascade leva `MemberRole` junto.
     * `deleteMany` (nao `delete`) para nao explodir se ja nao existir.
     */
    await tx.serverMember.deleteMany({
      where: { serverId, userId: botUserId },
    });
  });

  return { removido: true };
}
