"use client";

import { useCallback, useEffect, useState } from "react";
import { preCarregarPerfil } from "@/lib/perfil-cache";
import type { PublicMessage, PublicUser } from "@aether/shared";
import {
  useRealtimeStore,
  type ChatMessage,
} from "@/lib/stores/realtime-store";
import { CartaoDePerfil } from "@/components/profile/cartao-de-perfil";
import { MessageList } from "./message-list";
import { MessageComposer } from "./message-composer";
import { useMarcarLeitura } from "@/lib/chat/use-marcar-leitura";

/** Quem clicou em qual avatar/nome, e onde — para ancorar o cartao. */
export interface PerfilAberto {
  user: PublicUser;
  ancora: DOMRect;
}

/**
 * Junta lista e campo de envio, e semeia a store com o historico que veio do
 * SSR.
 *
 * A semeadura e um merge por id, nao uma substituicao: se o socket ja entregou
 * mensagens novas enquanto a pagina carregava, elas nao podem ser descartadas
 * pelo historico mais velho que chegou junto do HTML.
 */
export function ChatPanel({
  channelId,
  channelName,
  initialMessages,
  initialHasMore,
  selfUser,
  canSend,
  serverId,
  serverName,
  ehConversaDireta = false,
}: {
  channelId: string;
  channelName: string;
  initialMessages: PublicMessage[];
  initialHasMore: boolean;
  selfUser: PublicUser;
  canSend: boolean;
  /** servidor aberto — ausente em conversa direta; o cartao usa para os cargos */
  serverId?: string;
  serverName?: string;
  /** Repassado para a lista: conversa direta nao mostra "#". */
  ehConversaDireta?: boolean;
}) {
  const prependHistory = useRealtimeStore((state) => state.prependHistory);
  const setActiveChannel = useRealtimeStore((state) => state.setActiveChannel);

  const [perfil, setPerfil] = useState<PerfilAberto | null>(null);
  const [respondendoA, setRespondendoA] = useState<ChatMessage | null>(null);

  /**
   * Clicar na MESMA pessoa fecha; noutra, troca. O `id` decide o toggle e a
   * `ancora` nova reposiciona o cartao.
   */
  const abrirPerfil = useCallback((user: PublicUser, ancora: DOMRect) => {
    setPerfil((atual) =>
      atual?.user.id === user.id ? null : { user, ancora },
    );
  }, []);

  // Trocar de conversa cancela a resposta pendente — ela e daquele canal.
  useEffect(() => setRespondendoA(null), [channelId]);

  useEffect(() => {
    prependHistory(channelId, initialMessages, initialHasMore);
  }, [channelId, initialMessages, initialHasMore, prependHistory]);

  /**
   * Enquanto este canal esta na tela, mensagem que chega nele nasce lida.
   * Ao sair, voltamos para "nenhum canal aberto" — senao o canal continuaria
   * marcando tudo como visto depois que voce foi embora.
   */
  useEffect(() => {
    setActiveChannel(channelId);
    return () => setActiveChannel(null);
  }, [channelId, setActiveChannel]);

  // E salva a leitura no servidor, para o contador valer em outro aparelho.
  useMarcarLeitura(channelId);

  return (
    /**
     * O espaco embaixo NAO e respiro: e a area que a HUD flutuante ocupa.
     *
     * Ela mora no palco com `position: absolute`, ou seja, fora do fluxo — sem
     * reservar isto, o campo de mensagem fica DEBAIXO dela. Medido: a HUD tem
     * 54px de altura e flutua a 20px do fundo, entao 80px cobrem com folga.
     */
    <div className="flex min-h-0 flex-1 flex-col pb-20">
      <MessageList
        channelId={channelId}
        channelName={channelName}
        ehConversaDireta={ehConversaDireta}
        initialMessages={initialMessages}
        onAbrirPerfil={abrirPerfil}
        onPreCarregarPerfil={(userId) => preCarregarPerfil(userId, serverId)}
        onResponder={setRespondendoA}
      />
      <MessageComposer
        channelId={channelId}
        channelName={channelName}
        selfUser={selfUser}
        canSend={canSend}
        respondendoA={respondendoA}
        aoCancelarResposta={() => setRespondendoA(null)}
      />

      {perfil ? (
        <CartaoDePerfil
          key={perfil.user.id}
          user={perfil.user}
          serverId={serverId}
          serverName={serverName}
          ancora={perfil.ancora}
          onClose={() => setPerfil(null)}
        />
      ) : null}
    </div>
  );
}
