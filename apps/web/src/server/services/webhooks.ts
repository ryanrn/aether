import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@aether/db";

/**
 * Webhooks de ENTRADA — a camada de dados.
 *
 * Um webhook e um cano: `POST /api/v1/webhooks/:id/:token` publica uma mensagem
 * no `channelId` fixado aqui. O cliente NAO escolhe servidor, canal nem autor.
 *
 * A identidade no chat e uma linha `User` (`kind = WEBHOOK`), criada junto —
 * so para ser `Message.authorId`. Nao e membro, nao tem cargo, nao recebe DM.
 *
 * O token e guardado como `sha256`, NUNCA em claro. Aparece uma vez, na
 * criacao ou na regeneracao. Mesmo desenho de `BotToken` e `PlanKey`.
 */

function novoToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token).digest("hex") };
}

export interface WebhookNaLista {
  id: string;
  name: string;
  channelId: string;
  criadoPor: string;
  createdAt: string;
  revogado: boolean;
}

export async function listarWebhooks(
  serverId: string,
): Promise<WebhookNaLista[]> {
  const linhas = await prisma.webhook.findMany({
    where: { channel: { serverId } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      channelId: true,
      creatorId: true,
      createdAt: true,
      revokedAt: true,
    },
  });
  return linhas.map((w) => ({
    id: w.id,
    name: w.name,
    channelId: w.channelId,
    criadoPor: w.creatorId,
    createdAt: w.createdAt.toISOString(),
    revogado: w.revokedAt !== null,
  }));
}

export class CanalInvalido extends Error {
  override name = "CanalInvalido";
}

/**
 * Cria o webhook (e a linha `User` da identidade). Devolve o token EM CLARO —
 * a unica vez. `channelId` tem de ser um canal de TEXTO deste servidor.
 */
export async function criarWebhook(params: {
  serverId: string;
  channelId: string;
  name: string;
  creatorId: string;
}): Promise<{ id: string; token: string }> {
  const canal = await prisma.channel.findFirst({
    where: { id: params.channelId, serverId: params.serverId, type: "TEXT" },
    select: { id: true },
  });
  if (!canal) throw new CanalInvalido();

  const { token, tokenHash } = novoToken();
  const usernameSintetico = `webhook_${randomBytes(8).toString("hex")}`;

  const id = await prisma.$transaction(async (tx) => {
    const identidade = await tx.user.create({
      data: {
        username: usernameSintetico,
        displayName: params.name,
        kind: "WEBHOOK",
        allowServerDms: false,
        allowServerFriendRequests: false,
      },
      select: { id: true },
    });
    const wh = await tx.webhook.create({
      data: {
        channelId: params.channelId,
        webhookUserId: identidade.id,
        name: params.name,
        tokenHash,
        creatorId: params.creatorId,
      },
      select: { id: true },
    });
    return wh.id;
  });

  return { id, token };
}

/** `null` = webhook nao e deste servidor. */
export async function regenerarToken(params: {
  webhookId: string;
  serverId: string;
}): Promise<{ token: string } | null> {
  const wh = await prisma.webhook.findFirst({
    where: { id: params.webhookId, channel: { serverId: params.serverId } },
    select: { id: true },
  });
  if (!wh) return null;

  const { token, tokenHash } = novoToken();
  await prisma.webhook.update({
    where: { id: wh.id },
    data: { tokenHash, revokedAt: null },
  });
  return { token };
}

/** Revoga (soft): o `POST` passa a recusar. A identidade e as mensagens ficam. */
export async function revogarWebhook(params: {
  webhookId: string;
  serverId: string;
}): Promise<{ revogado: boolean }> {
  const { count } = await prisma.webhook.updateMany({
    where: {
      id: params.webhookId,
      channel: { serverId: params.serverId },
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return { revogado: count === 1 };
}
