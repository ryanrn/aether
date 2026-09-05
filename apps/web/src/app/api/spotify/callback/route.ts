import { tratarCallbackDeConexao } from "@/server/conexoes/retorno";

/**
 * Volta da autorizacao do Spotify.
 *
 * ROTA PROPRIA, e nao a generica `/api/conexoes/[provider]/callback`, por um
 * motivo que nao e tecnico: este endereco esta REGISTRADO no painel do
 * Spotify como `redirect_uri`. Trocar a URL exigiria editar aquele cadastro,
 * e um redirect_uri que nao bate faz o Spotify recusar a troca do `code` —
 * quebrando a conexao de quem ja usa.
 *
 * O trabalho todo e do handler compartilhado. Provedores NOVOS entram pela
 * rota generica e nao precisam de arquivo nenhum aqui.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // `spotify` na chave de retorno porque a `control-bar` ja le `?spotify=ok`.
  return tratarCallbackDeConexao(request, "SPOTIFY", "spotify");
}
