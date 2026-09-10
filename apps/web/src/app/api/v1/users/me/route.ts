import { prisma } from "@aether/db";
import type { ApiSelf } from "@aether/shared";
import { autenticarBot, ehIdentidade } from "@/server/api-v1/auth";
import { limitarBot } from "@/server/api-v1/limite";
import { erroApi, okApi } from "@/server/api-v1/resposta";

/**
 * `GET /api/v1/users/me` — a identidade do proprio bot.
 *
 * O Discord usa `/users/@me`; aqui e `/me` porque `@` prefixa rota paralela no
 * Next e nao da para nomear a pasta `@me`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const bot = await autenticarBot(request);
  if (!ehIdentidade(bot)) return bot;

  const limite = await limitarBot({
    applicationId: bot.applicationId,
    escrita: false,
  });
  if (limite) return limite;

  const linha = await prisma.user.findUnique({
    where: { id: bot.botUserId },
    select: { id: true, username: true, displayName: true, avatarUrl: true },
  });
  if (!linha) return erroApi("not_found");

  const corpo: ApiSelf = {
    id: linha.id,
    username: linha.username,
    displayName: linha.displayName,
    avatarUrl: linha.avatarUrl,
    kind: "BOT",
    applicationId: bot.applicationId,
  };
  return okApi(corpo);
}
