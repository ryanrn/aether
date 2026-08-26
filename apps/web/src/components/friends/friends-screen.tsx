"use client";

import { useState } from "react";
import type { PublicFriendship } from "@aether/shared";
import { FriendsNav, type SecaoAmigos } from "./friends-nav";
import { FriendsList } from "./friends-list";
import { ActivityPanel } from "./activity-panel";

/**
 * Tela de amigos, em tres paineis fixos.
 *
 *   244px          flexivel          260px
 *   navegacao      lista             "Ativo agora"
 *
 * Os tres convivem sempre; nenhum flutua sobre o outro e nenhum vira tela
 * separada. Isso importa mais do que parece: o formulario de adicionar mora
 * DENTRO da lista, e nao numa tela vazia propria — quem acabou de adicionar
 * ve a lista mudar no mesmo lugar em que estava olhando.
 *
 * A lista vem RENDERIZADA do servidor (`listFriendships`); quem decide o que e
 * "pendente" e "aceito" e o banco. O que os componentes acrescentam e o estado
 * VIVO — quem esta online agora e o que esta jogando — que chega pelo socket
 * na sala pessoal e nao existe no banco.
 */
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
      <FriendsNav
        secao={secao}
        onSecao={setSecao}
        pedidosRecebidos={recebidos.length}
      />

      <FriendsList
        secao={secao}
        amigos={amigos}
        recebidos={recebidos}
        enviados={enviados}
        bloqueados={bloqueados}
      />

      <ActivityPanel amigos={amigos} />
    </div>
  );
}
