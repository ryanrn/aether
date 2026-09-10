"use server";

import { revalidatePath } from "next/cache";
import {
  appDescricaoSchema,
  appNameSchema,
  displayNameSchema,
  usernameSchema,
  type ActionResult,
} from "@aether/shared";
import { requirePermission, requireUser } from "@/server/guards";
import { fail, ok, toActionError } from "./action-result";
import { writeAudit } from "@/server/audit";
import { evictFromGateway, resyncGatewayRooms } from "@/server/realtime-notify";
import {
  appParaInstalar,
  desinstalarBot,
  instalarBot,
} from "@/server/services/instalacao";
import {
  AppInstaladaEmServidores,
  BotJaHabilitado,
  BotNaoHabilitado,
  UsernameEmUso,
  apagarApp,
  atualizarApp,
  criarApp,
  gerarTokenDeApp,
  habilitarBot,
} from "@/server/services/aplicativos";
import {
  CanalInvalido,
  criarWebhook,
  regenerarToken,
  revogarWebhook,
} from "@/server/services/webhooks";

/**
 * Instalar / desinstalar um bot num servidor.
 *
 * Quem instala e um HUMANO com "Gerenciar servidor" — `requirePermission` e o
 * mesmo guard de mudar nome/icone. O link `/app/authorize?app=<id>` so leva
 * ate aqui; a autorizacao de verdade e a action.
 */

export async function instalarBotAction(params: {
  applicationId: string;
  serverId: string;
}): Promise<ActionResult<{ serverId: string; jaEstava: boolean }>> {
  try {
    const { applicationId, serverId } = params;
    if (!applicationId || !serverId) return fail("Dados invalidos.");

    const context = await requirePermission(serverId, "MANAGE_SERVER");

    const app = await appParaInstalar(applicationId);
    if (!app) {
      return fail("Este aplicativo nao esta disponivel para instalar.");
    }

    const { jaEstava } = await instalarBot({
      applicationId,
      serverId,
      botUserId: app.botUserId,
      installedBy: context.session.user.id,
    });

    if (!jaEstava) {
      await resyncGatewayRooms({ serverId });
      await writeAudit({
        serverId,
        actorId: context.session.user.id,
        action: "bot.install",
        targetType: "user",
        targetId: app.botUserId,
        metadata: { applicationId, name: app.name },
      });
    }

    revalidatePath(`/app/s/${serverId}`, "layout");
    return ok({ serverId, jaEstava });
  } catch (error) {
    return toActionError(error);
  }
}

export async function desinstalarBotAction(params: {
  applicationId: string;
  serverId: string;
}): Promise<ActionResult<{ serverId: string }>> {
  try {
    const { applicationId, serverId } = params;
    if (!applicationId || !serverId) return fail("Dados invalidos.");

    const context = await requirePermission(serverId, "MANAGE_SERVER");

    const app = await appParaInstalar(applicationId);
    // App sumido/bloqueado: ainda deixamos desinstalar pelo `botUserId` que a
    // instalacao guarda? Nao — sem o `botUserId` nao da para tirar o membro
    // certo. App bloqueada e tratada pelo painel de admin (evict global).
    if (!app) return fail("Aplicativo nao encontrado.");

    const { removido } = await desinstalarBot({
      applicationId,
      serverId,
      botUserId: app.botUserId,
    });

    if (removido) {
      await evictFromGateway({ serverId, userId: app.botUserId });
      await writeAudit({
        serverId,
        actorId: context.session.user.id,
        action: "bot.uninstall",
        targetType: "user",
        targetId: app.botUserId,
        metadata: { applicationId, name: app.name },
      });
    }

    revalidatePath(`/app/s/${serverId}`, "layout");
    return ok({ serverId });
  } catch (error) {
    return toActionError(error);
  }
}

// ===========================================================================
// Developer Portal — CRUD de Application, bot e token (Etapa 8)
// ===========================================================================

export async function criarAppAction(
  nome: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireUser();
    const parsed = appNameSchema.safeParse(nome);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Nome invalido", "name");
    }
    const { id } = await criarApp({
      ownerId: session.user.id,
      name: parsed.data,
    });
    revalidatePath("/app/developers");
    return ok({ id });
  } catch (error) {
    return toActionError(error);
  }
}

export async function atualizarAppAction(params: {
  appId: string;
  name?: string;
  descricao?: string;
}): Promise<ActionResult<undefined>> {
  try {
    const session = await requireUser();

    let name: string | undefined;
    if (params.name !== undefined) {
      const p = appNameSchema.safeParse(params.name);
      if (!p.success) {
        return fail(p.error.issues[0]?.message ?? "Nome invalido", "name");
      }
      name = p.data;
    }

    let descricao: string | undefined;
    if (params.descricao !== undefined) {
      const p = appDescricaoSchema.safeParse(params.descricao);
      if (!p.success) {
        return fail(
          p.error.issues[0]?.message ?? "Descricao invalida",
          "descricao",
        );
      }
      descricao = p.data;
    }

    const r = await atualizarApp({
      appId: params.appId,
      userId: session.user.id,
      name,
      descricao,
    });
    if (!r) return fail("Aplicativo nao encontrado.");

    revalidatePath(`/app/developers/${params.appId}`);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function apagarAppAction(
  appId: string,
): Promise<ActionResult<undefined>> {
  try {
    const session = await requireUser();
    const { removido } = await apagarApp(appId, session.user.id);
    if (!removido) return fail("Aplicativo nao encontrado.");
    revalidatePath("/app/developers");
    return ok();
  } catch (error) {
    if (error instanceof AppInstaladaEmServidores) {
      return fail(
        "Desinstale o bot de todos os servidores antes de excluir o aplicativo.",
      );
    }
    return toActionError(error);
  }
}

export async function habilitarBotAction(params: {
  appId: string;
  username: string;
  displayName: string;
}): Promise<ActionResult<undefined>> {
  try {
    const session = await requireUser();

    const u = usernameSchema.safeParse(params.username);
    if (!u.success) {
      return fail(u.error.issues[0]?.message ?? "Nome invalido", "username");
    }
    const d = displayNameSchema.safeParse(params.displayName);
    if (!d.success) {
      return fail(d.error.issues[0]?.message ?? "Nome invalido", "displayName");
    }

    const r = await habilitarBot({
      appId: params.appId,
      userId: session.user.id,
      username: u.data,
      displayName: d.data,
    });
    if (!r) return fail("Aplicativo nao encontrado.");

    revalidatePath(`/app/developers/${params.appId}`);
    return ok();
  } catch (error) {
    if (error instanceof UsernameEmUso) {
      return fail("Este nome de usuario ja esta em uso.", "username");
    }
    if (error instanceof BotJaHabilitado) {
      return fail("Este aplicativo ja tem um bot.");
    }
    return toActionError(error);
  }
}

/**
 * Gera/rotaciona o token. Devolve o segredo EM CLARO — a unica vez. O cliente
 * mostra uma vez e nao guarda.
 */
export async function gerarTokenAction(
  appId: string,
): Promise<ActionResult<{ token: string; prefixo: string }>> {
  try {
    const session = await requireUser();
    const r = await gerarTokenDeApp(appId, session.user.id);
    if (!r) return fail("Aplicativo nao encontrado.");
    revalidatePath(`/app/developers/${appId}`);
    return ok(r);
  } catch (error) {
    if (error instanceof BotNaoHabilitado) {
      return fail("Habilite o bot antes de gerar um token.");
    }
    return toActionError(error);
  }
}

// ===========================================================================
// Webhooks de entrada — geridos nas configuracoes do servidor (Etapa 11)
// ===========================================================================

export async function criarWebhookAction(params: {
  serverId: string;
  channelId: string;
  name: string;
}): Promise<ActionResult<{ id: string; token: string }>> {
  try {
    const context = await requirePermission(params.serverId, "MANAGE_SERVER");

    const nome = displayNameSchema.safeParse(params.name);
    if (!nome.success) {
      return fail(nome.error.issues[0]?.message ?? "Nome invalido", "name");
    }

    const { id, token } = await criarWebhook({
      serverId: params.serverId,
      channelId: params.channelId,
      name: nome.data,
      creatorId: context.session.user.id,
    });

    await writeAudit({
      serverId: params.serverId,
      actorId: context.session.user.id,
      action: "webhook.create",
      targetType: "channel",
      targetId: params.channelId,
      metadata: { name: nome.data, webhookId: id },
    });

    revalidatePath(`/app/s/${params.serverId}/settings`);
    return ok({ id, token });
  } catch (error) {
    if (error instanceof CanalInvalido) {
      return fail("Escolha um canal de texto deste servidor.", "channelId");
    }
    return toActionError(error);
  }
}

export async function regenerarWebhookTokenAction(params: {
  serverId: string;
  webhookId: string;
}): Promise<ActionResult<{ token: string }>> {
  try {
    await requirePermission(params.serverId, "MANAGE_SERVER");
    const r = await regenerarToken(params);
    if (!r) return fail("Webhook nao encontrado.");
    revalidatePath(`/app/s/${params.serverId}/settings`);
    return ok(r);
  } catch (error) {
    return toActionError(error);
  }
}

export async function revogarWebhookAction(params: {
  serverId: string;
  webhookId: string;
}): Promise<ActionResult<undefined>> {
  try {
    const context = await requirePermission(params.serverId, "MANAGE_SERVER");
    const { revogado } = await revogarWebhook(params);
    if (revogado) {
      await writeAudit({
        serverId: params.serverId,
        actorId: context.session.user.id,
        action: "webhook.revoke",
        targetType: "channel",
        metadata: { webhookId: params.webhookId },
      });
    }
    revalidatePath(`/app/s/${params.serverId}/settings`);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}
