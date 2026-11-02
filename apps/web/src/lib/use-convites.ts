"use client";

import { useCallback, useState } from "react";
import type { ConviteAck, ConviteDeJogo, TipoDeConvite } from "@aether/shared";
import { useSocket } from "@/components/realtime/realtime-provider";
import { useConviteCom, useConvitesStore } from "@/lib/stores/convites-store";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { toast } from "@/lib/stores/toast-store";

/** Sem ack em 8 s: o gateway caiu no meio. A acao pode ou nao ter valido. */
const ACK_MS = 8_000;
const SEM_RESPOSTA = "Sem resposta do servidor. Confira de novo em instantes.";

/**
 * Acoes de convite de jogo. Cada uma fala com o gateway, guarda o convite que
 * voltou no ack (para a tela reagir antes do `game-invite:update`) e mostra a
 * recusa como aviso. `ocupado` cobre o carregamento do botao.
 */
export function useConvites() {
  const socket = useSocket();
  const [ocupado, setOcupado] = useState(false);

  const tratar = useCallback((semResposta: Error | null, r: ConviteAck | undefined) => {
    setOcupado(false);
    if (semResposta || !r) {
      toast.erro(SEM_RESPOSTA);
      return false;
    }
    if (!r.ok) {
      toast.erro(r.error);
      return false;
    }
    useConvitesStore.getState().atualizar(r.convite);
    return true;
  }, []);

  const enviar = useCallback(
    (paraId: string, tipo: TipoDeConvite, comoEntrar?: string) => {
      if (!socket) return;
      setOcupado(true);
      socket
        .timeout(ACK_MS)
        .emit("game-invite:send", { paraId, tipo, comoEntrar: comoEntrar ?? null }, (e, r) => {
          if (tratar(e, r) && r?.ok) {
            toast.info(
              tipo === "pedir"
                ? `Pedido enviado para ${r.convite.para.displayName}.`
                : `Convite enviado para ${r.convite.para.displayName}.`,
            );
          }
        });
    },
    [socket, tratar],
  );

  const responder = useCallback(
    (id: string, aceitar: boolean, comoEntrar?: string) => {
      if (!socket) return;
      setOcupado(true);
      socket
        .timeout(ACK_MS)
        .emit("game-invite:respond", { id, aceitar, comoEntrar: comoEntrar ?? null }, tratar);
    },
    [socket, tratar],
  );

  const cancelar = useCallback(
    (id: string) => {
      if (!socket) return;
      setOcupado(true);
      socket.timeout(ACK_MS).emit("game-invite:cancel", { id }, tratar);
    },
    [socket, tratar],
  );

  return { enviar, responder, cancelar, ocupado };
}

/** Pendente e ainda dentro do prazo (o relogio do cliente so decide o botao). */
export function estaPendente(
  convite: ConviteDeJogo | null,
): convite is ConviteDeJogo & { estado: "pendente" } {
  return (
    convite !== null &&
    convite.estado === "pendente" &&
    new Date(convite.expiraEm).getTime() > Date.now()
  );
}

/**
 * O que da para fazer com um amigo em termos de jogo, AGORA:
 * - `pedir`: ele esta jogando algo visivel -> "Pedir para entrar";
 * - `convidar`: VOCE esta jogando (o gateway sabe, via app de desktop) ->
 *   "Convidar para jogar".
 * Junto vai o ultimo convite seu nessa direcao, para trocar o botao por
 * "Pedido enviado / Cancelar". Disponivel aqui nao e garantido: o gateway
 * revalida o jogo e a amizade no envio.
 */
export function useJogoComAmigo(amigoId: string) {
  const eu = useRealtimeStore((estado) => estado.selfUserId);
  const jogoDoAmigo = useRealtimeStore((estado) => estado.activity[amigoId]?.game ?? null);
  const meuJogo = useConvitesStore((estado) => estado.meuJogo);
  const pedido = useConviteCom(eu, amigoId, "pedir");
  const convite = useConviteCom(eu, amigoId, "convidar");
  return { jogoDoAmigo, meuJogo, pedido, convite };
}
