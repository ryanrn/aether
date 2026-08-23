"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@aether/db";
import { findFriendship } from "@aether/access";
import { usernameSchema, type ActionResult } from "@aether/shared";
import { clientKey, rateLimit } from "../auth/rate-limit";
import { requireUser } from "../guards";
import { notifyFriendsChanged } from "../realtime-notify";
import { fail, ok, toActionError } from "./action-result";

/**
 * Amizades: pedir, aceitar, recusar, desfazer.
 *
 * Duas decisoes deste arquivo merecem estar escritas, porque nenhuma das duas
 * e obvia olhando so o codigo:
 *
 * 1. SO POR NOME DE USUARIO EXATO. Nao existe busca, nem listagem, nem
 *    "pessoas que voce talvez conheca". Um endpoint de procurar gente vira um
 *    catalogo de quem tem conta aqui, e catalogo assim serve para montar lista
 *    de alvo. Quem quer ser achado passa o proprio nome.
 *
 * 2. DIZEMOS quando o nome nao existe — diferente da recuperacao de senha, que
 *    responde igual dos dois jeitos. A diferenca nao e descuido:
 *
 *      - la o dado e o E-MAIL, que identifica a pessoa fora daqui; aqui e o
 *        nome de usuario, que ja aparece para qualquer um que divida um
 *        servidor com ela — nao ha segredo novo a proteger;
 *      - engolir o erro faria todo erro de digitacao virar um pedido que nunca
 *        chega, sem jeito de perceber. O recurso ficaria quebrado na pratica
 *        para proteger o que ja e publico.
 *
 *    O que sobra de risco e alguem varrer nomes para descobrir quais existem.
 *    Contra isso ha rate limit, e ele e por IP e por CONTA: so por IP daria
 *    para varrer trocando de rede.
 */

/** Teto por janela. Generoso para uso normal, curto para varredura. */
const LIMITE_PEDIDOS = 20;
const JANELA_MS = 60 * 60_000;

/** Envia pedido de amizade para um nome de usuario exato. */
export async function sendFriendRequestAction(
  username: string,
): Promise<ActionResult<{ enviado: "pedido" | "aceito" }>> {
  try {
    const session = await requireUser();

    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) {
      return fail(
        parsed.error.issues[0]?.message ?? "Nome de usuario invalido",
        "username",
      );
    }
    const alvo = parsed.data;

    const porIp = await rateLimit(
      await clientKey("amigo-ip"),
      LIMITE_PEDIDOS,
      JANELA_MS,
    );
    if (!porIp.ok) {
      return fail(`Muitos pedidos. Tente de novo em ${porIp.retryAfter}s.`);
    }
    const porConta = await rateLimit(
      `amigo-conta:${session.user.id}`,
      LIMITE_PEDIDOS,
      JANELA_MS,
    );
    if (!porConta.ok) {
      return fail(`Muitos pedidos. Tente de novo em ${porConta.retryAfter}s.`);
    }

    /**
     * Comparacao sem diferenciar maiuscula: quem digita o nome de alguem nao
     * sabe como a pessoa cadastrou. O banco guarda como foi escrito.
     */
    const outro = await prisma.user.findFirst({
      where: { username: { equals: alvo, mode: "insensitive" } },
      select: { id: true, username: true },
    });
    if (!outro) return fail("Nao existe ninguem com esse nome.", "username");

    if (outro.id === session.user.id) {
      return fail("Esse e voce.", "username");
    }

    /**
     * As duas direcoes numa consulta so. O indice unico do banco e por
     * DIRECAO, entao ele nao barraria o par invertido — quem barra e isto.
     */
    const existente = await findFriendship(session.user.id, outro.id);

    if (existente?.status === "ACCEPTED") {
      return fail(`Voce e ${outro.username} ja sao amigos.`, "username");
    }

    if (existente?.status === "PENDING") {
      if (existente.requesterId === session.user.id) {
        return fail("Voce ja pediu. Espere a resposta.", "username");
      }
      /**
       * Ela ja tinha pedido para voce, e agora voce pediu para ela: as duas
       * querem. Vira amizade direto em vez de virar um segundo pedido — o
       * contrario deixaria dois pedidos cruzados pendentes, cada uma
       * esperando a outra aceitar.
       */
      await prisma.friendship.update({
        where: { id: existente.id },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      await depoisDeMudar([session.user.id, outro.id]);
      return ok({ enviado: "aceito" as const });
    }

    await prisma.friendship.create({
      data: { requesterId: session.user.id, addresseeId: outro.id },
    });
    await depoisDeMudar([session.user.id, outro.id]);
    return ok({ enviado: "pedido" as const });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Aceita ou recusa um pedido recebido.
 *
 * A checagem que importa: so o DESTINATARIO decide. Sem ela, quem enviou
 * poderia aceitar o proprio pedido mandando o id da linha — a acao chega do
 * navegador, e confiar no id que veio de la nao e defesa nenhuma.
 */
export async function respondFriendRequestAction(
  friendshipId: string,
  aceitar: boolean,
): Promise<ActionResult<undefined>> {
  try {
    const session = await requireUser();
    if (typeof friendshipId !== "string" || friendshipId.length === 0) {
      return fail("Pedido invalido.");
    }

    const pedido = await prisma.friendship.findUnique({
      where: { id: friendshipId },
      select: { id: true, requesterId: true, addresseeId: true, status: true },
    });

    /**
     * Um unico erro para "nao existe" e "nao e seu": distinguir contaria a
     * quem chutou um id que aquela linha existe. Mesma politica do 404 em vez
     * de 403 no resto do projeto.
     */
    if (
      !pedido ||
      pedido.addresseeId !== session.user.id ||
      pedido.status !== "PENDING"
    ) {
      return fail("Esse pedido nao existe mais.");
    }

    if (aceitar) {
      await prisma.friendship.update({
        where: { id: pedido.id },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
    } else {
      /**
       * Recusar APAGA a linha, nao marca "recusado". Guardar a recusa
       * significaria guardar para sempre que fulano disse nao a sicrano, e
       * impedir um pedido futuro — o que seria bloqueio, e bloqueio nao esta
       * no escopo. Contra insistencia ha o rate limit.
       */
      await prisma.friendship.delete({ where: { id: pedido.id } });
    }

    await depoisDeMudar([pedido.requesterId, pedido.addresseeId]);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Desfaz uma amizade, ou cancela um pedido que voce enviou.
 *
 * Recebe o id da OUTRA PESSOA, e nao o da linha: quem esta na tela ve pessoas.
 * Achar a linha nas duas direcoes e trabalho do servidor.
 */
export async function removeFriendAction(
  otherUserId: string,
): Promise<ActionResult<undefined>> {
  try {
    const session = await requireUser();
    if (typeof otherUserId !== "string" || otherUserId.length === 0) {
      return fail("Pessoa invalida.");
    }

    const relacao = await findFriendship(session.user.id, otherUserId);
    if (!relacao) return fail("Voces nao tem nenhuma relacao aqui.");

    await prisma.friendship.delete({ where: { id: relacao.id } });
    await depoisDeMudar([relacao.requesterId, relacao.addresseeId]);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * O que sempre acontece depois de mexer numa amizade.
 *
 * Numa funcao so porque esquecer QUALQUER uma das duas partes quebra de um
 * jeito silencioso: sem `revalidatePath` a lista fica velha na tela de quem
 * clicou; sem `notifyFriendsChanged` o gateway segue com a lista antiga em
 * memoria, e a presenca do amigo novo so apareceria quando os dois
 * reconectassem.
 */
async function depoisDeMudar(userIds: string[]): Promise<void> {
  revalidatePath("/app/amigos");
  await notifyFriendsChanged({ userIds });
}
