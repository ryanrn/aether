import { createHash } from "node:crypto";
import { prisma } from "@aether/db";
import { messageContentSchema } from "@aether/shared";
import { erroApi, okApi } from "@/server/api-v1/resposta";
import { limitarWebhook } from "@/server/api-v1/limite";
import { enviarMensagemPeloGateway } from "@/server/realtime-notify";

/**
 * `POST /api/v1/webhooks/:id/:token` — um serviço externo publica no canal.
 *
 * Sem header de auth: o token está na URL. Ele determina o destino — o cliente
 * NÃO manda `serverId`/`channelId`/`authorId`. Token errado ou webhook
 * revogado -> 404 (nunca revelamos que o webhook existe).
 *
 * A escrita passa pelo gateway (`/internal/send-message` -> `enviarMensagem`),
 * a mesma porta do chat humano e da REST de bot.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; token: string }> },
): Promise<Response> {
  const { id, token } = await ctx.params;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const webhook = await prisma.webhook.findFirst({
    where: { id, tokenHash, revokedAt: null },
    select: { webhookUserId: true, channelId: true },
  });
  if (!webhook) return erroApi("not_found");

  const limite = await limitarWebhook(id);
  if (limite) return limite;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return erroApi("bad_request", { message: "Corpo JSON invalido." });
  }
  const conteudo = messageContentSchema.safeParse(
    (corpo as { content?: unknown }).content,
  );
  if (!conteudo.success) {
    return erroApi("bad_request", {
      message: conteudo.error.issues[0]?.message ?? "Mensagem invalida.",
    });
  }

  const r = await enviarMensagemPeloGateway({
    atorUserId: webhook.webhookUserId,
    conversationId: webhook.channelId,
    content: conteudo.data,
  });

  if (r === null) return erroApi("gateway_unavailable");
  if (!r.ok) {
    // Canal virou de voz / sumiu -> 404. O resto -> 400.
    return r.codigo === "nao_encontrada" || r.codigo === "canal_de_voz"
      ? erroApi("not_found")
      : erroApi("bad_request", { message: r.error });
  }

  return okApi({ id: r.message.id }, 201);
}
