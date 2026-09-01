"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { EmptyState } from "@/components/layout/empty-state";

/**
 * O 404 PROPRIO deste canal, e nao o global de `app/not-found.tsx`.
 *
 * POR QUE PRECISA EXISTIR: `deleteChannelAction` chama `revalidatePath` e o
 * gateway avisa os outros por `server:changed` — as duas coisas fazem o Next
 * re-executar a pagina do canal que acabou de sumir. Ela chama `notFound()`
 * (o canal nao existe mais, ou a permissao de ver mudou), e sem um limite
 * NESTE segmento isso subia ate o 404 global: trocava a tela INTEIRA,
 * sidebar e barra de controles junto — a mesma pagina de "este link nao
 * existe", para quem so acabou de excluir um canal que estava vendo.
 *
 * Por morar no segmento `c/[channelId]`, o layout do servidor (a casca com a
 * arvore de canais) continua montado por cima deste boundary — so o painel
 * do canal e trocado.
 *
 * REDIRECIONA, e nao so avisa: ficar parado numa URL que aponta para um
 * canal que nao existe mais deixaria a pessoa presa la ate clicar em outro
 * canal na sidebar. `replace`, e nao `push`, para o "voltar" do navegador nao
 * devolver a essa mesma URL morta.
 *
 * COBRE OS DOIS LADOS: tanto quem excluiu quanto qualquer outra pessoa que
 * estivesse com aquele canal aberto quando ALGUEM MAIS o excluiu — os dois
 * chegam aqui pelo mesmo caminho, porque os dois tem a mesma pagina
 * re-executada sob os pes.
 */
export default function CanalNaoEncontrado() {
  const router = useRouter();
  const params = useParams<{ serverId?: string }>();

  useEffect(() => {
    if (!params?.serverId) return;
    router.replace(`/app/s/${params.serverId}`);
  }, [params?.serverId, router]);

  return (
    <EmptyState
      title="Este canal nao existe mais"
      description="Foi excluido, ou voce perdeu acesso a ele. Voltando para o servidor..."
    />
  );
}
