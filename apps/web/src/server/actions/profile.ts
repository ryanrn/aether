"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@aether/db";
import {
  bioSchema,
  displayNameSchema,
  ehCosmeticType,
  molduraPorId,
  planoAtende,
  podeAvatarAnimado,
  setNicknameSchema,
  type ActionResult,
  type CosmeticoDeLoja,
  type CosmeticType,
} from "@aether/shared";
import { flagLigada } from "@aether/access";
import { writeAudit } from "../audit";
import {
  assertHierarchy,
  requireMember,
  requirePermission,
  requireUser,
} from "../guards";
import {
  CosmeticoIndisponivel,
  catalogoParaUsuario,
  equiparCosmetico,
} from "../services/cosmeticos";
import { notifyProfileChanged, resyncGatewayRooms } from "../realtime-notify";
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

    /*
     * O PLANO VEM DA SESSAO, e nao do formulario. A sessao ja carrega o plano
     * efetivo — vencimento aplicado na leitura —, entao uma assinatura que
     * venceu ha um segundo ja nao autoriza movimento aqui.
     */
    const result = await uploadUserAvatar(
      session.user.id,
      file,
      podeAvatarAnimado(session.user.plano),
    );
    if (!result.ok) return fail(result.error);

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        avatarUrl: result.url,
        /*
         * Sempre gravado, inclusive como NULO quando a imagem nova e parada:
         * sem isso, trocar um avatar animado por uma foto comum deixaria para
         * tras o gemeo do avatar ANTERIOR, e perder o plano faria aparecer uma
         * foto que a pessoa ja tinha substituido.
         */
        avatarEstaticoUrl: result.urlEstatica ?? null,
      },
    });

    await notifyProfileChanged({ userId: session.user.id });
    revalidatePath("/app", "layout");
    return ok({ avatarUrl: result.url });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Escolhe a moldura do avatar. `null` remove.
 *
 * A AUTORIZACAO E AQUI, no servidor, e nao na tela que desenha o catalogo. A
 * tela esconde o que a pessoa nao tem; esta funcao e que impede alguem de
 * mandar o id de uma moldura paga direto para a action.
 *
 * Guarda a escolha mesmo que o plano caia depois: quem decide se ela APARECE e
 * a leitura (`molduraEfetiva`). Assim reativar o plano devolve a moldura sem a
 * pessoa precisar lembrar qual era.
 */
export async function setMolduraAction(
  molduraId: string | null,
): Promise<ActionResult<{ molduraId: string | null }>> {
  try {
    const session = await requireUser();

    if (molduraId !== null) {
      const moldura = molduraPorId(molduraId);
      // 404 em vez de "essa moldura nao existe": nao confirmamos catalogo a
      // quem esta chutando id.
      if (!moldura) return fail("Moldura invalida");
      if (!planoAtende(session.user.plano, moldura.tier)) {
        return fail("Esta moldura pede um plano superior");
      }
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { molduraId },
    });

    await notifyProfileChanged({ userId: session.user.id });
    revalidatePath("/app", "layout");
    return ok({ molduraId });
  } catch (error) {
    return toActionError(error);
  }
}

/* ----------------------------------------------- cosmeticos com asset (R2) -- */

/**
 * A loja/seletor de cosmeticos so aparece com a flag `loja_de_cosmeticos`
 * ligada — ate haver pecas publicadas e a tela pronta, nada disto existe para
 * o usuario. O painel da equipe (cadastro) NAO passa por aqui.
 */
async function lojaAberta(): Promise<boolean> {
  return flagLigada("loja_de_cosmeticos");
}

function lerTipo(valor: unknown): CosmeticType | null {
  return ehCosmeticType(valor) ? valor : null;
}

/** O catalogo de um tipo (DECORATION | BANNER), com o estado desta pessoa. */
export async function listarCatalogoDeCosmeticosAction(
  tipo: unknown,
): Promise<ActionResult<CosmeticoDeLoja[]>> {
  try {
    const session = await requireUser();
    if (!(await lojaAberta())) return ok([]);

    const t = lerTipo(tipo);
    if (!t) return fail("Tipo invalido");

    return ok(await catalogoParaUsuario(session.user.id, session.user.plano, t));
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Equipa (ou, com `null`, desequipa) a decoracao ou o banner.
 *
 * A autorizacao e AQUI: a tela esconde o bloqueado, mas quem impede de mandar
 * o id de uma peca paga/inativa direto e esta funcao. Guarda a escolha mesmo
 * sem plano — a leitura decide se aparece, como a moldura.
 */
export async function equiparCosmeticoAction(
  tipo: unknown,
  cosmeticId: string | null,
): Promise<ActionResult<{ tipo: CosmeticType; cosmeticId: string | null }>> {
  try {
    const session = await requireUser();
    if (!(await lojaAberta())) return fail("Nao encontrado");

    const t = lerTipo(tipo);
    if (!t) return fail("Tipo invalido");
    const id =
      cosmeticId === null || cosmeticId === ""
        ? null
        : typeof cosmeticId === "string"
          ? cosmeticId
          : undefined;
    if (id === undefined) return fail("Cosmetico invalido");

    const valendo = await equiparCosmetico(
      session.user.id,
      session.user.plano,
      t,
      id,
    );

    await notifyProfileChanged({ userId: session.user.id });
    revalidatePath("/app", "layout");
    return ok({ tipo: t, cosmeticId: valendo });
  } catch (error) {
    if (error instanceof CosmeticoIndisponivel) {
      return fail("Esse cosmético não está disponível para você.");
    }
    return toActionError(error);
  }
}

/** Volta ao avatar gerado pelas iniciais. */
export async function removeAvatarAction(): Promise<ActionResult<undefined>> {
  try {
    const session = await requireUser();

    await prisma.user.update({
      where: { id: session.user.id },
      data: { avatarUrl: null, avatarEstaticoUrl: null },
    });

    await notifyProfileChanged({ userId: session.user.id });
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
      return fail(
        parsed.error.issues[0]?.message ?? "Nome invalido",
        "displayName",
      );
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { displayName: parsed.data },
    });

    await notifyProfileChanged({ userId: session.user.id });
    revalidatePath("/app", "layout");
    return ok({ displayName: parsed.data });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Bio do perfil global. Sem `userId` na entrada — cada um mexe na propria, id
 * vindo do cookie. Vazia APAGA (volta a nulo). Nao propaga por `PublicUser`,
 * entao nao precisa de `notifyProfileChanged` — o cartao busca sob demanda e ja
 * pega o novo valor na proxima abertura.
 */
export async function atualizarBioAction(
  bio: string,
): Promise<ActionResult<{ bio: string | null }>> {
  try {
    const session = await requireUser();

    const parsed = bioSchema.safeParse(bio);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Bio invalida", "bio");
    }

    const valor = parsed.data.length > 0 ? parsed.data : null;
    await prisma.user.update({
      where: { id: session.user.id },
      data: { bio: valor },
    });

    return ok({ bio: valor });
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

/**
 * Liga ou desliga "aceitar pedido de amizade de quem divide um servidor".
 *
 * Chave SEPARADA da de conversa direta: sao decisoes diferentes, e juntar as
 * duas obrigaria quem quer metade a abrir mao da outra. Nao afeta o caminho
 * por nome de usuario exato — quem entregou o proprio nome ja decidiu ser
 * encontravel por ali.
 */
export async function setAllowServerFriendRequestsAction(
  allow: unknown,
): Promise<ActionResult<{ allowServerFriendRequests: boolean }>> {
  try {
    const session = await requireUser();
    if (typeof allow !== "boolean") {
      return fail("Valor invalido", "allowServerFriendRequests");
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { allowServerFriendRequests: allow },
    });

    revalidatePath("/app", "layout");
    return ok({ allowServerFriendRequests: allow });
  } catch (error) {
    return toActionError(error);
  }
}
