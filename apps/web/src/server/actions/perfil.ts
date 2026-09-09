"use server";

import type { ActionResult, PerfilParaCartao } from "@aether/shared";
import { requireUser } from "../guards";
import { perfilParaCartao } from "../services/perfil";
import { fail, ok, toActionError } from "./action-result";

/**
 * Dados do cartao de perfil — bio, apelido/cargos no servidor aberto, estado da
 * relacao de amizade. Buscado quando o cartao ABRE (clique no avatar/nome no
 * chat), nao antes: e informacao que so a tela do cartao usa e nao vale
 * carregar para toda mensagem.
 *
 * `serverId` opcional: ausente = conversa direta, o cartao mostra so o perfil
 * global.
 */
export async function carregarPerfilAction(entrada: {
  userId: string;
  serverId?: string;
}): Promise<ActionResult<PerfilParaCartao>> {
  try {
    const session = await requireUser();
    const alvoId = entrada?.userId;
    if (typeof alvoId !== "string" || alvoId.length === 0) {
      return fail("Usuario invalido");
    }

    const perfil = await perfilParaCartao(
      session.user.id,
      alvoId,
      typeof entrada.serverId === "string" ? entrada.serverId : null,
    );
    return ok(perfil);
  } catch (error) {
    return toActionError(error);
  }
}
