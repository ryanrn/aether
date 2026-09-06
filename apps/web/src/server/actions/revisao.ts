"use server";

import type { ActionResult, RevisoesPendentes } from "@aether/shared";
import { sessaoDaEquipe } from "../guards";
import { contarPedidosPendentes } from "../services/descoberta";
import { contarJogosPendentes } from "../services/jogos";
import { contarDenunciasAbertas } from "../services/denuncia";
import { fail, ok, toActionError } from "./action-result";

/**
 * Quantas coisas esperam a equipe — o numerinho na engrenagem.
 *
 * POR QUE EXISTE: as duas filas (jogos sugeridos e pedidos de vitrine) so
 * contavam o que espera DEPOIS que voce abria a aba delas. Quem nao abre nao
 * descobre, e um pedido podia ficar dias parado sem ninguem saber que chegou.
 * A fila protege o que APARECE para todo mundo; nao adianta ela existir se
 * ninguem e avisado de que ha o que revisar.
 *
 * AS DUAS NA MESMA CHAMADA de proposito. Um aviso que mostrasse metade do que
 * espera seria pior que nenhum: voce olharia a engrenagem limpa e concluiria
 * que nao ha nada, com um pedido parado na outra fila.
 *
 * ARQUIVO PROPRIO porque cruza os dois assuntos. Enfiar em `jogos.ts` faria
 * aquele arquivo importar o servico de descoberta (e vice-versa) so por causa
 * de um contador.
 */
export async function contarRevisoesAction(): Promise<
  ActionResult<RevisoesPendentes>
> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");

    const [jogos, comunidades, denuncias] = await Promise.all([
      contarJogosPendentes(),
      contarPedidosPendentes(),
      contarDenunciasAbertas(),
    ]);
    return ok({ jogos, comunidades, denuncias });
  } catch (error) {
    return toActionError(error);
  }
}
