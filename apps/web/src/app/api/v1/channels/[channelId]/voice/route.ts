import { prisma } from "@aether/db";
import type { ApiVoiceGrant } from "@aether/shared";
import { autenticarBot, ehIdentidade } from "@/server/api-v1/auth";
import { limitarBot } from "@/server/api-v1/limite";
import { erroApi, okApi } from "@/server/api-v1/resposta";
import {
  entrarEmVozPeloGateway,
  sairDaVozPeloGateway,
} from "@/server/realtime-notify";

/**
 * Voz para bot (EXPERIMENTAL — Music Bot, ver docs/developer-platform.md).
 *
 *  POST   — entra no canal de voz. Devolve as credenciais do LiveKit.
 *  DELETE — sai do canal de voz que o bot ocupa agora.
 *
 * A autorizacao de verdade (VIEW_CHANNEL + CONNECT do proprio bot) roda no
 * GATEWAY, dentro de `entrarNaVoz` — a MESMA funcao que `voice:join` humano
 * chama (`apps/realtime/src/entrar-em-voz.ts`). Aqui so resolvemos o canal
 * cedo o bastante para dar 404 sem gastar a chamada interna a toa; a REST
 * nunca decide permissao sozinha, so traduz a recusa do gateway em status
 * HTTP.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ channelId: string }> },
): Promise<Response> {
  const bot = await autenticarBot(request);
  if (!ehIdentidade(bot)) return bot;

  const { channelId } = await ctx.params;

  const canal = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true, type: true },
  });
  if (!canal || canal.type !== "VOICE") return erroApi("not_found");

  const limite = await limitarBot({
    applicationId: bot.applicationId,
    serverId: canal.serverId,
    escrita: true,
  });
  if (limite.bloqueado) return limite.bloqueado;

  const resultado = await entrarEmVozPeloGateway({
    botUserId: bot.botUserId,
    channelId,
  });

  if (resultado === null) return erroApi("gateway_unavailable");
  if (!resultado.ok) {
    if (resultado.codigo === "nao_encontrada") return erroApi("not_found");
    if (resultado.codigo === "voz_desligada") {
      return erroApi("gateway_unavailable", { message: resultado.error });
    }
    // "sem_permissao" / "cheio": o canal existe e o bot o enxerga (tem
    // VIEW_CHANNEL) — nao e caso de esconder, e de dizer por que nao deu.
    return erroApi("bad_request", { message: resultado.error });
  }

  // LiveKit nao configurado neste ambiente: ocupacao registrada, sem midia
  // nenhuma para o bot fazer algo com ela — falha alto em vez de devolver
  // credenciais inuteis.
  if (!resultado.media) {
    return erroApi("gateway_unavailable", {
      message: "Voz sem audio configurado neste ambiente.",
    });
  }

  const corpo: ApiVoiceGrant = {
    url: resultado.media.url,
    token: resultado.media.token,
    roomName: `channel:${channelId}`,
    canPublish: resultado.media.canPublish,
    canShareScreen: resultado.media.canShareScreen,
    canUseCamera: resultado.media.canUseCamera,
    expiresAt: resultado.media.expiresAt,
  };
  return okApi(corpo, 200, limite.headers);
}

export async function DELETE(request: Request): Promise<Response> {
  const bot = await autenticarBot(request);
  if (!ehIdentidade(bot)) return bot;

  const limite = await limitarBot({ applicationId: bot.applicationId, escrita: false });
  if (limite.bloqueado) return limite.bloqueado;

  const ok = await sairDaVozPeloGateway({ botUserId: bot.botUserId });
  if (!ok) return erroApi("gateway_unavailable");
  return okApi({ ok: true }, 200, limite.headers);
}
