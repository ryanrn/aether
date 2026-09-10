"use client";

import { useState } from "react";
import type { PublicFriendship } from "@aether/shared";
import { FriendsList } from "./friends-list";
import { ActivityPanel } from "./activity-panel";

/**
 * A tela de Amigos.
 *
 * A navegacao DO APP (Amigos, Loja, Grupos, Olimpo, Explorar, painel da equipe)
 * e as conversas diretas moram no `HomeNavPanel`, a coluna a esquerda que o
 * layout de `/app` monta fora de um servidor. O que sobra aqui sao duas
 * colunas: a lista (com as secoes amigos / solicitacoes / bloqueados nas abas
 * do topo) e o "Ativo agora".
 *
 * A lista vem RENDERIZADA do servidor (`listFriendships`); o que os componentes
 * acrescentam e o estado VIVO — quem esta online e o que joga — que chega pelo
 * socket na sala pessoal.
 */
export type SecaoAmigos = "amigos" | "solicitacoes" | "bloqueados";

export function FriendsScreen({
  friendships,
}: {
  friendships: PublicFriendship[];
}) {
  const [secao, setSecao] = useState<SecaoAmigos>("amigos");

  const amigos = friendships.filter((f) => f.kind === "friend");
  const recebidos = friendships.filter((f) => f.kind === "incoming");
  const enviados = friendships.filter((f) => f.kind === "outgoing");
  const bloqueados = friendships.filter((f) => f.kind === "blocked");

  return (
    <div className="flex h-full min-h-0 bg-base-950">
      <FriendsList
        secao={secao}
        onSecao={setSecao}
        pedidosRecebidos={recebidos.length}
        amigos={amigos}
        recebidos={recebidos}
        enviados={enviados}
        bloqueados={bloqueados}
      />

      <ActivityPanel amigos={amigos} />
    </div>
  );
}
