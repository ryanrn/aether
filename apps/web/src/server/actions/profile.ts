"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@aether/db";
import {
  displayNameSchema,
  setNicknameSchema,
  type ActionResult,
} from "@aether/shared";
import { writeAudit } from "../audit";
import {
  assertHierarchy,
  requireMember,
  requirePermission,
  requireUser,
} from "../guards";
import { resyncGatewayRooms } from "../realtime-notify";
import { uploadUserAvatar } from "../storage";
import { fail, ok, toActionError } from "./action-result";

/**
 * Perfil do proprio usuario.
 *
 * Nao ha guard de permissao aqui alem de `requireUser`, e nao ha `userId` na
 * entrada: cada pessoa so mexe no proprio perfil, e o id vem do cookie de
 * sessao. Aceitar um `userId` do cliente seria abrir "editar o perfil de
 * qualquer um" atras de um campo de formulario.
 *
 * Nao ha auditoria: o log de auditoria e por SERVIDOR, e trocar a propria foto
 * nao pertence a nenhum. O `revalidatePath` cobre /app inteiro porque o avatar
 * aparece na barra de controles, no painel de membros, nas mensagens e nos
 * cards de voz — todos abaixo desse layout.
 */

export async function uploadAvatarAction(
  formData: FormData,
): Promise<ActionResult<{ avatarUrl: string }>> {
  try {
    const session = await requireUser();

    const file = formData.get("avatar");
    if (!(file instanceof File)) return fail("Nenhum arquivo enviado");

    const result = await uploadUserAvatar(session.user.id, file);
    if (!result.ok) return fail(result.error);

    await prisma.user.update({
      where: { id: session.user.id },
      data: { avatarUrl: result.url },
    });

    revalidatePath("/app", "layout");
    return ok({ avatarUrl: result.url });
  } catch (error) {
    return toActionError(error);
  }
}

/** Volta ao avatar gerado pelas iniciais. */
export async function removeAvatarAction(): Promise<ActionResult<undefined>> {
  try {
    const session = await requireUser();

    await prisma.user.update({
      where: { id: session.user.id },
      data: { avatarUrl: null },
    });

    revalidatePath("/app", "layout");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/** Troca o nome de exibicao — o que aparece no lugar do @usuario. */
export async function updateDisplayNameAction(
  displayName: string,
): Promise<ActionResult<{ displayName: string }>> {
  try {
    const session = await requireUser();

    const parsed = displayNameSchema.safeParse(displayName);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Nome invalido", "displayName");
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { displayName: parsed.data },
    });

    revalidatePath("/app", "layout");
    return ok({ displayName: parsed.data });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Apelido por servidor — o nome que vale SO neste servidor.
 *
 * Duas regras de acesso, e a diferenca importa:
 *  - o proprio apelido, qualquer membro muda (e o proprio nome dele);
 *  - o apelido dos OUTROS exige MANAGE_NICKNAMES e passa pela hierarquia.
 *    Sem a hierarquia, um membro com a permissao renomearia o dono.
 *
 * Apelido vazio APAGA (volta ao nome de exibicao). Guardar string vazia
 * deixaria o membro sem nome nenhum na lista.
 */
export async function setNicknameAction(
  serverId: string,
  input: unknown,
): Promise<ActionResult<{ nickname: string | null }>> {
  try {
    const parsed = setNicknameSchema.safeParse(input);
    if (!parsed.success) {
      return fail(
        parsed.error.issues[0]?.message ?? "Apelido invalido",
        "nickname",
      );
    }

    const self = await requireMember(serverId);
    const isSelf = parsed.data.memberId === self.memberId;

    if (!isSelf) {
      await requirePermission(serverId, "MANAGE_NICKNAMES");
      await assertHierarchy(self, parsed.data.memberId);
    }

    const nickname = parsed.data.nickname.trim() || null;

    /**
     * `updateMany` com o serverId no filtro: impede renomear um membro de
     * OUTRO servidor mandando o memberId dele. O guard ja confinou o ator a
     * este servidor, e o filtro confina o alvo.
     */
    const result = await prisma.serverMember.updateMany({
      where: { id: parsed.data.memberId, serverId },
      data: { nickname },
    });
    if (result.count === 0) return fail("Membro nao encontrado");

    await writeAudit({
      serverId,
      actorId: self.session.user.id,
      action: "member.nickname",
      targetType: "member",
      targetId: parsed.data.memberId,
      metadata: { nickname, self: isSelf },
    });

    // A lista de membros e renderizada pelo servidor; o sinal faz os outros
    // pedirem a arvore de novo em vez de esperarem um F5.
    await resyncGatewayRooms({ serverId });

    revalidatePath(`/app/s/${serverId}`, "layout");
    return ok({ nickname });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Liga ou desliga "aceitar conversa de quem divide um servidor comigo".
 *
 * Nao mexe em amizade: amigo passa por cima desta chave, sempre. O que ela
 * governa e so o caminho "conheci num servidor".
 *
 * DESLIGAR NAO APAGA NADA. As conversas ja abertas continuam no banco — quem
 * nao e mais alcancavel simplesmente deixa de passar por `podeFalarCom` na
 * proxima acao. Religando, tudo volta como estava.
 */
export async function setAllowServerDmsAction(
  allow: unknown,
): Promise<ActionResult<{ allowServerDms: boolean }>> {
  try {
    const session = await requireUser();

    // Vem do cliente: so aceita booleano de verdade, nada de coercao.
    if (typeof allow !== "boolean") {
      return fail("Valor invalido", "allowServerDms");
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { allowServerDms: allow },
    });

    revalidatePath("/app", "layout");
    return ok({ allowServerDms: allow });
  } catch (error) {
    return toActionError(error);
  }
}
