"use client";

import { useCallback } from "react";
import type { MotivoFimDeChamada, PublicUser } from "@aether/shared";
import {
  useSocket,
  type TypedSocket,
} from "@/components/realtime/realtime-provider";
import { useChamadaDmStore } from "@/lib/stores/chamada-dm-store";
import { toast } from "@/lib/stores/toast-store";
import { motivoAoEncerrar } from "@/lib/voice/chamada-dm";
import { sairDaVozDeServidor } from "@/lib/voice/use-entrar-na-voz";

/**
 * Acoes da chamada de voz em conversa direta: ligar, atender, encerrar.
 *
 * A permissao NAO e decidida aqui — o gateway checa `loadDmAccess` em cada
 * `dmcall:ring`/`dmcall:accept` e so entao emite o token da sala. Isto so
 * cuida do estado da tela e de nunca deixar a pessoa em duas salas de voz.
 */

/**
 * Encerra a chamada direta desta aba, se houver. Funcao solta porque entrar
 * num canal de voz de servidor tambem chama (as duas se excluem).
 *
 * Solta o microfone ANTES de qualquer resposta da rede: o estado vira `null`
 * na hora e a `<ChamadaDmSession>` desconecta do SFU. O aviso ao outro lado
 * vai sem ack — se o socket estiver fora, o outro percebe pela ausencia na
 * sala de midia.
 */
export function encerrarChamadaDm(
  socket: TypedSocket | null,
  motivo?: MotivoFimDeChamada,
  aviso?: string,
): void {
  const store = useChamadaDmStore.getState();
  const atual = store.chamada;
  if (!atual) return;

  socket?.emit("dmcall:end", {
    dmId: atual.dmId,
    motivo: motivo ?? motivoAoEncerrar(atual),
  });
  store.definir(null);
  if (aviso) store.setAviso({ dmId: atual.dmId, texto: aviso });
}

/**
 * Atende a chamada desta conversa. Usado pelo botao "Atender" e pela resposta
 * automatica quando os dois ligam ao mesmo tempo.
 */
/**
 * Quanto esperar o gateway responder a `dmcall:ring`/`dmcall:accept`.
 *
 * Sem limite, um gateway que nao conhece o evento (versao antiga no ar, na
 * janela entre o deploy da web e o `fly deploy`) nunca responde — e o botao
 * ficaria parado sem dizer nada. Com o `socket.timeout`, o callback recebe um
 * erro e a tela explica.
 */
const ACK_MS = 8000;
const SEM_RESPOSTA = "Chamadas de voz indisponiveis no momento. Tente de novo em instantes.";

export function atenderChamadaDm(socket: TypedSocket, dmId: string): void {
  const store = useChamadaDmStore.getState();
  const atual = store.chamada;
  if (!atual || atual.dmId !== dmId) return;

  sairDaVozDeServidor(socket);
  if (atual.fase === "recebendo") store.definir({ ...atual, fase: "atendendo" });

  socket.timeout(ACK_MS).emit("dmcall:accept", { dmId }, (semResposta, resultado) => {
    const agora = useChamadaDmStore.getState();
    // Desligaram (ou recusei noutra aba) enquanto o ack viajava.
    if (agora.chamada?.dmId !== dmId) return;

    if (semResposta) {
      agora.definir(null);
      toast.erro(SEM_RESPOSTA);
      return;
    }
    if (!resultado.ok) {
      agora.definir(null);
      toast.erro(resultado.error);
      return;
    }
    // Ja em chamada (o outro religou depois de recarregar): a conexao de pe
    // continua valendo, nao ha por que trocar de token e reconectar.
    if (agora.chamada.fase === "em_chamada") return;

    agora.definir({
      fase: "em_chamada",
      dmId,
      outro: agora.chamada.outro,
      // Quem ligou ja tinha token desde o ring; quem recebeu ganha agora.
      media: agora.chamada.fase === "chamando" ? agora.chamada.media : resultado.media,
      desde: Date.now(),
    });
  });
}

export function useChamadaDm() {
  const socket = useSocket();
  const chamada = useChamadaDmStore((estado) => estado.chamada);

  const ligar = useCallback(
    (dmId: string, outro: PublicUser) => {
      if (!socket) return;
      const atual = useChamadaDmStore.getState().chamada;
      if (atual?.dmId === dmId) return;
      // Ligar para outra pessoa encerra a ligacao atual — nunca duas.
      if (atual) encerrarChamadaDm(socket);

      sairDaVozDeServidor(socket);
      useChamadaDmStore.getState().setAviso(null);

      socket.timeout(ACK_MS).emit("dmcall:ring", { dmId }, (semResposta, resultado) => {
        const store = useChamadaDmStore.getState();
        if (semResposta) {
          toast.erro(SEM_RESPOSTA);
          return;
        }
        if (!resultado.ok) {
          toast.erro(resultado.error);
          return;
        }
        /**
         * Os dois ligaram ao mesmo tempo e o `dmcall:incoming` do outro chegou
         * ANTES deste ack: esta aba esta "recebendo" a ligacao dele. Os dois
         * querem falar — atende na hora. Sem isto, cada lado ficava tocando
         * a ligacao do outro, e o aceite de um nao tirava o outro do toque.
         */
        if (store.chamada?.dmId === dmId && store.chamada.fase === "recebendo") {
          atenderChamadaDm(socket, dmId);
          return;
        }
        // A resposta automatica ja nos pos em chamada: nao volta para "chamando".
        if (store.chamada?.dmId === dmId) return;
        if (store.chamada) {
          // Outra chamada comecou nesse meio-tempo: desiste desta.
          socket.emit("dmcall:end", { dmId, motivo: "cancelada" });
          return;
        }
        store.definir({
          fase: "chamando",
          dmId,
          outro,
          media: resultado.media,
          desde: Date.now(),
        });
      });
    },
    [socket],
  );

  const atender = useCallback(() => {
    const atual = useChamadaDmStore.getState().chamada;
    if (!socket || !atual) return;
    atenderChamadaDm(socket, atual.dmId);
  }, [socket]);

  /** Recusar, cancelar ou desligar — o motivo sai da fase atual. */
  const encerrar = useCallback(() => {
    encerrarChamadaDm(socket);
  }, [socket]);

  return { chamada, ligar, atender, encerrar };
}
