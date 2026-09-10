"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@aether/db";
import {
  createServerSchema,
  deleteServerSchema,
  inviteCodeSchema,
  joinServerSchema,
  transferOwnershipSchema,
  updateServerSchema,
  type ActionResult,
} from "@aether/shared";
import { verifyPassword } from "../auth/password";
import { clientKey, rateLimit } from "../auth/rate-limit";
import { writeAudit } from "../audit";
import { requireMember, requirePermission, requireUser } from "../guards";
import { evictFromGateway, notifyServerDeleted, resyncGatewayRooms } from "../realtime-notify";
import {
  createServerForUser,
  generateInviteCode,
  reorderServers,
} from "../services/servers";
import { joinServerByCode } from "../services/invites";
import { reavaliarVitrinePorRenomear } from "../services/descoberta";
import { uploadServerIcon } from "../storage";
import { fail, ok, toActionError } from "./action-result";

/**
 * Confere a senha da CONTA de quem esta agindo — nao a do servidor, que nao
 * existe. Usado para reconfirmar identidade antes de transferir posse ou
 * excluir o servidor: as duas acoes valem para sempre (a segunda de fato nao
 * tem volta), e a sessao ja aberta sozinha nao prova que quem esta na frente
 * da tela agora e o dono e nao alguem que achou o notebook destravado.
 */
async function confirmOwnerPassword(
  userId: string,
  password: string,
): Promise<boolean> {
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!actor) return false;
  return verifyPassword(password, actor.passwordHash);
}

export async function createServerAction(
  _prev: ActionResult<{ serverId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ serverId: string }>> {
  let serverId: string;
  try {
    const session = await requireUser();

    const limit = await rateLimit(`create-server:${session.user.id}`, 5, 60 * 60_000);
    if (!limit.ok) {
      return fail("Limite de criacao de servidores atingido. Tente mais tarde.");
    }

    const parsed = createServerSchema.safeParse({ name: formData.get("name") });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Nome invalido", "name");
    }

    const result = await createServerForUser({
      ownerId: session.user.id,
      name: parsed.data.name,
    });
    serverId = result.serverId;

    await writeAudit({
      serverId,
      actorId: session.user.id,
      action: "server.create",
      targetType: "server",
      targetId: serverId,
      metadata: { name: parsed.data.name },
    });
  } catch (error) {
    return toActionError(error);
  }

  revalidatePath("/app");
  redirect(`/app/s/${serverId}`);
}

export async function joinServerAction(
  _prev: ActionResult<{ serverId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ serverId: string }>> {
  let serverId: string;
  try {
    const session = await requireUser();

    const limit = await rateLimit(await clientKey("join-server"), 20, 10 * 60_000);
    if (!limit.ok) {
      return fail(`Muitas tentativas. Aguarde ${limit.retryAfter}s.`);
    }

    const parsed = joinServerSchema.safeParse({ code: formData.get("code") });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Codigo invalido", "code");
    }

    const result = await joinServerByCode(session.user.id, parsed.data.code);
    if (!result.ok) return result;
    serverId = result.data.serverId;
  } catch (error) {
    return toActionError(error);
  }

  revalidatePath("/app");
  redirect(`/app/s/${serverId}`);
}

/**
 * Aceitar um convite pela PAGINA de convite (`/invite/<codigo>`).
 *
 * Separada da `joinServerAction` (que le `code` de um FormData e e usada pelo
 * modal "entrar com convite") porque esta recebe o codigo direto e devolve o
 * `serverId` para o cliente navegar — a pagina de convite ja mostrou a previa
 * e o clique e o "sim". A regra de entrada e a mesma: `joinServerByCode`
 * revalida convite, ban, duplicidade e limite no servidor.
 */
export async function acceptInviteAction(
  code: unknown,
): Promise<ActionResult<{ serverId: string }>> {
  try {
    const session = await requireUser();

    const limit = await rateLimit(await clientKey("join-server"), 20, 10 * 60_000);
    if (!limit.ok) {
      return fail(`Muitas tentativas. Aguarde ${limit.retryAfter}s.`);
    }

    const parsed = inviteCodeSchema.safeParse(code);
    if (!parsed.success) return fail("Convite invalido.", "code");

    const result = await joinServerByCode(session.user.id, parsed.data);
    if (!result.ok) return result;

    revalidatePath("/app");
    return ok(result.data);
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Revoga um convite. Exige a MESMA permissao de criar (`CREATE_INVITE`):
 * revogar e gerar outro sao o mesmo gesto de "trocar o link".
 *
 * Soft delete — `revokedAt` em vez de `DELETE` — para a pagina distinguir
 * "revogado" de "nunca existiu" e para o log guardar quem revogou.
 */
export async function revokeInviteAction(
  serverId: string,
  code: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const context = await requirePermission(serverId, "CREATE_INVITE");

    const parsed = inviteCodeSchema.safeParse(code);
    if (!parsed.success) return fail("Convite invalido.");

    // `updateMany` com `serverId` no WHERE: o convite tem de ser DESTE
    // servidor. Sem isso, o id do codigo viria do cliente e daria para
    // revogar convite de outro servidor.
    const { count } = await prisma.invite.updateMany({
      where: { code: parsed.data.toLowerCase(), serverId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) return fail("Convite nao encontrado.");

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "invite.revoke",
      targetType: "invite",
      targetId: parsed.data.toLowerCase(),
    });

    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/** Gera um convite novo. Exige a permissao CREATE_INVITE. */
export async function createInviteAction(
  serverId: string,
): Promise<ActionResult<{ code: string }>> {
  try {
    const context = await requirePermission(serverId, "CREATE_INVITE");

    const limit = await rateLimit(`invite:${context.session.user.id}`, 15, 60 * 60_000);
    if (!limit.ok) {
      return fail(`Muitos convites gerados. Aguarde ${limit.retryAfter}s.`);
    }

    const code = generateInviteCode();
    await prisma.invite.create({
      data: { code, serverId, creatorId: context.session.user.id },
    });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "invite.create",
      targetType: "invite",
      targetId: code,
    });

    return ok({ code });
  } catch (error) {
    return toActionError(error);
  }
}

/** Convite mais recente ainda valido, para o botao "convidar". */
export async function getOrCreateInviteAction(
  serverId: string,
): Promise<ActionResult<{ code: string }>> {
  try {
    await requirePermission(serverId, "CREATE_INVITE");

    const existing = await prisma.invite.findFirst({
      where: {
        serverId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
      select: { code: true, maxUses: true, uses: true },
    });

    if (existing && (existing.maxUses === null || existing.uses < existing.maxUses)) {
      return ok({ code: existing.code });
    }
    return createInviteAction(serverId);
  } catch (error) {
    return toActionError(error);
  }
}

/** Renomeia o servidor. Exige MANAGE_SERVER. */
export async function updateServerAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = updateServerSchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Nome invalido", "name");
    }

    const context = await requirePermission(parsed.data.serverId, "MANAGE_SERVER");

    const antes = await prisma.server.findUnique({
      where: { id: parsed.data.serverId },
      select: { name: true },
    });

    await prisma.server.update({
      where: { id: parsed.data.serverId },
      data: { name: parsed.data.name },
    });

    /**
     * RENOMEAR UM SERVIDOR LISTADO O DEVOLVE A FILA DA VITRINE.
     *
     * Sem isto a revisao seria facil de driblar, e este e o caso mais grave: o
     * nome e o que identifica a comunidade na vitrine. Aprova-se "Comunidade
     * de Xadrez" e renomeia-se para o que se quiser — inclusive para algo que
     * imite um servidor oficial, que e justamente o risco que a aprovacao
     * existe para conter.
     *
     * So mexe em quem esta APROVADO; privado e pendente editam a vontade.
     */
    if (antes && antes.name !== parsed.data.name) {
      await reavaliarVitrinePorRenomear(parsed.data.serverId);
    }

    await writeAudit({
      serverId: parsed.data.serverId,
      actorId: context.session.user.id,
      action: "server.update",
      targetType: "server",
      targetId: parsed.data.serverId,
      metadata: { name: parsed.data.name },
    });

    revalidatePath(`/app/s/${parsed.data.serverId}`, "layout");
    revalidatePath("/app");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Envia (ou substitui) o icone do servidor. Mesma permissao do renomear.
 *
 * Nao apaga o arquivo antigo no Storage quando substitui ou remove — cada
 * envio ganha um nome novo, entao o anterior fica orfao no bucket. Aceito de
 * proposito: apagar exigiria guardar o path (nao so a URL publica) e mais uma
 * chamada de rede que pode falhar, por um espaco que custa centavos.
 */
export async function uploadServerIconAction(
  serverId: string,
  formData: FormData,
): Promise<ActionResult<{ iconUrl: string }>> {
  try {
    const context = await requirePermission(serverId, "MANAGE_SERVER");

    const file = formData.get("icon");
    if (!(file instanceof File)) {
      return fail("Nenhum arquivo enviado");
    }

    const result = await uploadServerIcon(serverId, file);
    if (!result.ok) return fail(result.error);

    await prisma.server.update({
      where: { id: serverId },
      data: { iconUrl: result.url },
    });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "server.update",
      targetType: "server",
      targetId: serverId,
      metadata: { icon: "uploaded" },
    });

    revalidatePath(`/app/s/${serverId}`, "layout");
    revalidatePath("/app");
    return ok({ iconUrl: result.url });
  } catch (error) {
    return toActionError(error);
  }
}

/** Remove o icone do servidor, voltando ao avatar gerado por iniciais. */
export async function removeServerIconAction(
  serverId: string,
): Promise<ActionResult<undefined>> {
  try {
    const context = await requirePermission(serverId, "MANAGE_SERVER");

    await prisma.server.update({
      where: { id: serverId },
      data: { iconUrl: null },
    });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "server.update",
      targetType: "server",
      targetId: serverId,
      metadata: { icon: "removed" },
    });

    revalidatePath(`/app/s/${serverId}`, "layout");
    revalidatePath("/app");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/** Sair do servidor. O dono nao pode sair sem transferir a posse (fase 6). */
export async function leaveServerAction(
  serverId: string,
): Promise<ActionResult<undefined>> {
  try {
    const context = await requireMember(serverId);
    if (context.isOwner) {
      return fail("O dono nao pode sair do proprio servidor.");
    }

    await prisma.serverMember.delete({ where: { id: context.memberId } });
    // Mesmo motivo do kick/ban: sem isto, quem saiu continuaria recebendo o
    // chat pelo socket ate recarregar a pagina.
    await evictFromGateway({ serverId, userId: context.session.user.id });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "server.leave",
      targetType: "user",
      targetId: context.session.user.id,
    });

    revalidatePath("/app");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Reordena o trilho de servidores DESTA pessoa.
 *
 * Nao ha checagem de permissao de servidor aqui de proposito: a ordem e uma
 * preferencia de quem olha, e a unica coisa que precisa ser verdade e que a
 * sessao existe. `reorderServers` so mexe nas linhas de `ServerMember` do
 * proprio usuario — um id de servidor alheio simplesmente nao acha membro e e
 * ignorado.
 */
export async function reorderServersAction(
  orderedServerIds: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const session = await requireUser();

    if (
      !Array.isArray(orderedServerIds) ||
      orderedServerIds.some((id) => typeof id !== "string")
    ) {
      return fail("Ordem invalida.");
    }
    // Teto de sanidade: ninguem tem mil servidores, e a lista vem do cliente.
    if (orderedServerIds.length > 200) return fail("Ordem invalida.");

    await reorderServers(session.user.id, orderedServerIds as string[]);
    revalidatePath("/app", "layout");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Transfere a posse do servidor para outro membro. So o DONO pode chamar —
 * nao quem tem MANAGE_SERVER por cargo (Administrador, por exemplo): a
 * permissao de gerenciar nao e a mesma coisa que ser dono, e um Administrador
 * transferindo o servidor para si mesmo seria uma escalada de privilegio.
 *
 * Exige a senha da CONTA de quem esta transferindo — ver `confirmOwnerPassword`.
 *
 * O cargo "Dono" (isOwner, com ALL_PERMISSIONS) MIGRA junto do antigo dono
 * para o novo. `isOwner` no calculo de permissao (`loadMemberAccess`) olha so
 * `Server.ownerId`, mas o CARGO em si continua valendo o que seus bits dizem
 * — se ele ficasse com quem deixou de ser dono, essa pessoa manteria
 * permissao total como "membro comum" depois da transferencia.
 */
export async function transferOwnershipAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = transferOwnershipSchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Dados invalidos");
    }
    const { serverId, targetMemberId, password } = parsed.data;

    const context = await requireMember(serverId);
    if (!context.isOwner) {
      return fail("So o dono do servidor pode transferir a posse.");
    }

    const limit = await rateLimit(
      `transfer-ownership:${context.session.user.id}`,
      5,
      15 * 60_000,
    );
    if (!limit.ok) {
      return fail(`Muitas tentativas. Aguarde ${limit.retryAfter}s.`, "password");
    }

    if (!(await confirmOwnerPassword(context.session.user.id, password))) {
      return fail("Senha incorreta.", "password");
    }

    const target = await prisma.serverMember.findUnique({
      where: { id: targetMemberId },
      select: { id: true, serverId: true, userId: true },
    });
    if (!target || target.serverId !== serverId) {
      return fail("Membro nao encontrado.");
    }
    if (target.userId === context.session.user.id) {
      return fail("Voce ja e o dono deste servidor.");
    }

    const donoRole = await prisma.role.findFirst({
      where: { serverId, isOwner: true },
      select: { id: true },
    });

    await prisma.$transaction([
      prisma.server.update({
        where: { id: serverId },
        data: { ownerId: target.userId },
      }),
      ...(donoRole
        ? [
            prisma.memberRole.deleteMany({
              where: { roleId: donoRole.id, memberId: context.memberId },
            }),
            prisma.memberRole.upsert({
              where: {
                memberId_roleId: { memberId: target.id, roleId: donoRole.id },
              },
              create: { memberId: target.id, roleId: donoRole.id },
              update: {},
            }),
          ]
        : []),
    ]);

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "server.transfer_ownership",
      targetType: "user",
      targetId: target.userId,
    });

    // O que os dois PODEM ver mudou (o cargo "Dono" trocou de mao); ninguem
    // saiu do servidor, entao e resync de salas, nao evict.
    await resyncGatewayRooms({ serverId });

    revalidatePath(`/app/s/${serverId}`, "layout");
    revalidatePath("/app");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Exclui o servidor inteiro. So o DONO pode chamar, com a senha da conta
 * reconfirmada — mesma trava da transferencia, e mais critica aqui: isto NAO
 * TEM VOLTA. O cascade do schema (`onDelete: Cascade` a partir de `Server`)
 * cuida de membros, cargos, categorias, canais, mensagens, convites,
 * banimentos e o log de auditoria — nao ha limpeza manual para fazer aqui.
 */
export async function deleteServerAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = deleteServerSchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Dados invalidos");
    }
    const { serverId, password } = parsed.data;

    const context = await requireMember(serverId);
    if (!context.isOwner) {
      return fail("So o dono do servidor pode exclui-lo.");
    }

    const limit = await rateLimit(
      `delete-server:${context.session.user.id}`,
      5,
      15 * 60_000,
    );
    if (!limit.ok) {
      return fail(`Muitas tentativas. Aguarde ${limit.retryAfter}s.`, "password");
    }

    if (!(await confirmOwnerPassword(context.session.user.id, password))) {
      return fail("Senha incorreta.", "password");
    }

    const members = await prisma.serverMember.findMany({
      where: { serverId },
      select: { userId: true },
    });

    /**
     * ANTES de apagar: o gateway precisa consultar os canais deste servidor
     * para saber de quais salas tirar cada socket, e o cascade levaria essas
     * linhas embora antes de ele conseguir perguntar.
     */
    await notifyServerDeleted({
      serverId,
      userIds: members.map((member) => member.userId),
    });

    await prisma.server.delete({ where: { id: serverId } });
  } catch (error) {
    return toActionError(error);
  }

  revalidatePath("/app");
  redirect("/app");
}
