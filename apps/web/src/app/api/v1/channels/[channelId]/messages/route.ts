import { prisma } from "@aether/db";
import { getChannelPermissions, loadMemberAccess } from "@aether/access";
import { has, messageContentSchema } from "@aether/shared";
import { autenticarBot, ehIdentidade } from "@/server/api-v1/auth";
import { limitarBot } from "@/server/api-v1/limite";
import { erroApi, okApi } from "@/server/api-v1/resposta";
import { listRecentMessages } from "@/server/services/messages";
import { enviarMensagemPeloGateway } from "@/server/realtime-notify";

/**
 * Mensagens de um canal.
 *
 *  GET  — o historico recente (o mesmo `listRecentMessages` do SSR humano).
 *  POST — publica uma mensagem no lugar do bot. O texto vai ao gateway
 *         (`/internal/send-message`), que revalida a permissao e cria — o
 *         gateway continua sendo o unico que escreve mensagem.
 *
 * Canal inexistente, bot nao instalado, ou sem VIEW/SEND -> 404. Nunca 403.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resolve o canal + o acesso do bot nele. `null` = qualquer recusa (vira 404). */
async function contexto(
  channelId: string,
  botUserId: string,
): Promise<{ serverId: string; type: "TEXT" | "VOICE"; bits: bigint } | null> {
  const canal = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true, type: true },
  });
  if (!canal) return null;

  const acesso = await loadMemberAccess(canal.serverId, botUserId);
  if (!acesso) return null;

  const bits = await getChannelPermissions(acesso, channelId);
  if (bits === null) return null;

  return { serverId: canal.serverId, type: canal.type, bits };
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ channelId: string }> },
): Promise<Response> {
  const bot = await autenticarBot(request);
  if (!ehIdentidade(bot)) return bot;

  const { channelId } = await ctx.params;

  const ctxCanal = await contexto(channelId, bot.botUserId);
  if (!ctxCanal || !has(ctxCanal.bits, "VIEW_CHANNEL")) {
    return erroApi("not_found");
  }

  const limite = await limitarBot({
    applicationId: bot.applicationId,
    serverId: ctxCanal.serverId,
    escrita: false,
  });
  if (limite) return limite;

  const { messages, hasMore } = await listRecentMessages(
    channelId,
    bot.botUserId,
  );
  return okApi({ messages, hasMore });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ channelId: string }> },
): Promise<Response> {
  const bot = await autenticarBot(request);
  if (!ehIdentidade(bot)) return bot;

  const { channelId } = await ctx.params;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return erroApi("bad_request", { message: "Corpo JSON invalido." });
  }
  const b = corpo as { content?: unknown; replyToId?: unknown };
  const conteudo = messageContentSchema.safeParse(b.content);
  if (!conteudo.success) {
    return erroApi("bad_request", {
      message: conteudo.error.issues[0]?.message ?? "Mensagem invalida.",
    });
  }
  const replyToId =
    typeof b.replyToId === "string" && b.replyToId.length > 0
      ? b.replyToId
      : undefined;

  // 404 cedo se o canal nem existe; a permissao real e revalidada no gateway.
  const ctxCanal = await contexto(channelId, bot.botUserId);
  if (!ctxCanal) return erroApi("not_found");

  const limite = await limitarBot({
    applicationId: bot.applicationId,
    serverId: ctxCanal.serverId,
    channelId,
    escrita: true,
  });
  if (limite) return limite;

  const resultado = await enviarMensagemPeloGateway({
    atorUserId: bot.botUserId,
    conversationId: channelId,
    content: conteudo.data,
    replyToId,
  });

  if (resultado === null) return erroApi("gateway_unavailable");
  if (!resultado.ok) {
    // "nao encontrada" / "canal de voz" -> 404 (nao revelamos). "invalida" ->
    // 400. O resto -> 400 generico.
    if (
      resultado.codigo === "nao_encontrada" ||
      resultado.codigo === "canal_de_voz"
    ) {
      return erroApi("not_found");
    }
    return erroApi("bad_request", { message: resultado.error });
  }

  return okApi(resultado.message, 201);
}
