import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { listarJogosAprovados } from "@/server/services/jogos";

/**
 * O catalogo de jogos aprovados — o que o app desktop baixa para reconhecer
 * jogo que nenhuma loja declarou.
 *
 * ROTA, E NAO SERVER ACTION, porque quem consome nao e um formulario: e o
 * processo principal do Electron, por IPC a partir da pagina. Action existe
 * para mutacao vinda de tela; leitura de catalogo e GET.
 *
 * EXIGE SESSAO. Nao ha nada sensivel na lista — sao nomes de jogos —, mas ela
 * e trabalho de curadoria da nossa comunidade, e nao ha razao para servi-la a
 * quem nem conta tem. Deixar aberta seria escolher ser raspado.
 *
 * Sem `revalidate`: o catalogo muda quando a equipe aprova algo, e servir uma
 * versao velha significaria o jogo recem-aprovado continuar sem aparecer sem
 * ninguem entender por que. A consulta e um `findMany` por indice; o custo nao
 * justifica a confusao.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const sessao = await getSession();
  /**
   * 404 e nao 401: a regra do projeto e nao revelar existencia de recurso, e
   * isso vale para quem nao esta logado tambem.
   */
  if (!sessao) {
    return NextResponse.json({ error: "Nao encontrado" }, { status: 404 });
  }

  const jogos = await listarJogosAprovados();
  return NextResponse.json(
    { jogos },
    {
      headers: {
        /**
         * O desktop guarda o proprio catalogo em disco e so refaz o pedido de
         * tempos em tempos; um cache intermediario aqui so atrasaria a chegada
         * de um jogo aprovado.
         */
        "cache-control": "private, no-store",
      },
    },
  );
}
