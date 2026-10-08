"use client";

import { useEffect, useRef } from "react";
import type { MediaGrant, PublicUser } from "@aether/shared";
import { useSocket } from "@/components/realtime/realtime-provider";
import { useChamadaDmStore } from "@/lib/stores/chamada-dm-store";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import {
  AUSENCIA_MS,
  TOQUE_MS,
  aoAtenderem,
  aoEncerrar,
  reagirAChamada,
} from "@/lib/voice/chamada-dm";
import {
  atenderChamadaDm,
  encerrarChamadaDm,
} from "@/lib/voice/use-chamada-dm";
import type { VoiceRoomHandle } from "@/lib/voice/room";
import { iniciarToque, playJoinChime, playLeaveChime } from "@/lib/voice/sounds";

/**
 * Motor da chamada de voz em conversa direta. Nao desenha nada.
 *
 * Mora no `<RealtimeRoot>`, ao lado da `<VoiceSession>`, pelo mesmo motivo: a
 * chamada tem de sobreviver a navegacao. Atender na DM e ir olhar um servidor
 * nao pode derrubar o audio.
 *
 * Faz quatro coisas:
 *  1. traduz os avisos do gateway (`dmcall:*`) em estado, via as funcoes puras
 *     de `chamada-dm.ts`;
 *  2. toca o telefone e desiste depois de `TOQUE_MS`;
 *  3. conecta a sala `dm:<dmId>` do SFU enquanto a fase for `em_chamada`,
 *     reaproveitando a MESMA `room.ts` da voz de servidor (filtro de ruido,
 *     dispositivos preferidos, recuperacao de queda);
 *  4. encerra quando o outro some da sala de midia por mais de `AUSENCIA_MS` —
 *     o unico jeito de perceber que ele fechou a aba sem desligar, ja que o
 *     gateway nao guarda chamada.
 */
export function ChamadaDmSession() {
  const socket = useSocket();
  const chamada = useChamadaDmStore((estado) => estado.chamada);
  const outroNaSala = useChamadaDmStore((estado) => estado.outroNaSala);
  const mudo = useChamadaDmStore((estado) => estado.mudo);
  const surdo = useChamadaDmStore((estado) => estado.surdo);

  const fase = chamada?.fase ?? null;
  const dmId = chamada?.dmId ?? null;
  const outroId = chamada?.outro.id ?? null;
  const media = chamada?.fase === "em_chamada" ? chamada.media : null;

  const roomRef = useRef<VoiceRoomHandle | null>(null);

  // 1. avisos do gateway
  useEffect(() => {
    if (!socket) return;
    const euId = () => useRealtimeStore.getState().selfUserId;

    const aoReceber = ({ dmId, de }: { dmId: string; de: PublicUser }) => {
      const store = useChamadaDmStore.getState();
      switch (reagirAChamada(store.chamada, dmId)) {
        case "tocar":
          store.setAviso(null);
          store.definir({ fase: "recebendo", dmId, outro: de, desde: Date.now() });
          return;
        case "atender":
          atenderChamadaDm(socket, dmId);
          return;
        case "ocupado":
          // Recusa so ESTA ligacao — `encerrarChamadaDm` mexeria na atual.
          socket.emit("dmcall:end", { dmId, motivo: "ocupado" });
          return;
        case "ignorar":
          return;
      }
    };

    const aoAtender = (evento: { dmId: string; por: string }) => {
      const store = useChamadaDmStore.getState();
      const proximo = aoAtenderem(store.chamada, evento, euId());
      if (proximo !== store.chamada) store.definir(proximo);
    };

    const aoAcabar = (evento: Parameters<typeof aoEncerrar>[1]) => {
      const store = useChamadaDmStore.getState();
      const { proximo, aviso } = aoEncerrar(store.chamada, evento, euId());
      if (proximo === store.chamada) return;
      store.definir(proximo);
      if (aviso) store.setAviso({ dmId: evento.dmId, texto: aviso });
    };

    socket.on("dmcall:incoming", aoReceber);
    socket.on("dmcall:accepted", aoAtender);
    socket.on("dmcall:ended", aoAcabar);
    return () => {
      socket.off("dmcall:incoming", aoReceber);
      socket.off("dmcall:accepted", aoAtender);
      socket.off("dmcall:ended", aoAcabar);
    };
  }, [socket]);

  // 2. toque e desistencia
  useEffect(() => {
    if (fase !== "chamando" && fase !== "recebendo") return;
    const parar = iniciarToque(fase);

    const timer = setTimeout(() => {
      const atual = useChamadaDmStore.getState().chamada;
      if (!atual || atual.dmId !== dmId || atual.fase !== fase) return;
      if (fase === "chamando") {
        encerrarChamadaDm(
          socket,
          "sem_resposta",
          `${atual.outro.displayName} nao atendeu.`,
        );
      } else {
        /**
         * Quem RECEBE so limpa a propria tela, sem avisar o gateway: o
         * `sem_resposta` e de quem ligou mandar. Fica um pouco depois do
         * limite de quem liga, para o aviso dele chegar primeiro — isto e a
         * rede de seguranca para quando esse aviso se perde.
         */
        const store = useChamadaDmStore.getState();
        store.definir(null);
        store.setAviso({
          dmId: atual.dmId,
          texto: `Chamada perdida de ${atual.outro.displayName}.`,
        });
      }
    }, fase === "chamando" ? TOQUE_MS : TOQUE_MS + 5000);

    return () => {
      parar();
      clearTimeout(timer);
    };
  }, [fase, dmId, socket]);

  // 3. conexao com a sala de midia da conversa
  useEffect(() => {
    if (!dmId || !media || !socket || !outroId) return;
    let cancelado = false;
    const store = useChamadaDmStore.getState;

    import("@/lib/voice/room")
      .then(({ connectVoiceRoom }) =>
        connectVoiceRoom({
          url: media.url,
          token: media.token,
          canPublish: media.canPublish,
          callbacks: {
            // Sem indicador de fala publicado: so os dois estao na sala, e a
            // fala se ouve. Nada vai para o gateway.
            onSpeakingChange: () => undefined,
            onConnectionChange: (conectado) => store().setConectado(conectado),
            onRemoteParticipantsChange: (ids) =>
              store().setOutroNaSala(ids.includes(outroId)),
            // O token da chamada nao permite tela nem camera.
            onScreenSharesChange: () => undefined,
            onCamerasChange: () => undefined,
            onLocalShareEnded: () => undefined,
            onError: (mensagem) => store().setErro(mensagem),
            deveEstarMutado: () => store().mudo,
            renovarCredencial: () =>
              new Promise<MediaGrant | null>((resolve) => {
                if (!socket.connected) {
                  resolve(null);
                  return;
                }
                let respondido = false;
                const encerra = (grant: MediaGrant | null) => {
                  if (respondido) return;
                  respondido = true;
                  resolve(grant);
                };
                socket.emit("dmcall:refresh-token", { dmId }, (r) => {
                  if (r.ok) {
                    store().setErro(null);
                    encerra(r.media);
                  } else {
                    store().setErro(r.error);
                    encerra(null);
                  }
                });
                setTimeout(() => encerra(null), 8000);
              }),
          },
        }),
      )
      .then((handle) => {
        if (cancelado) {
          void handle.disconnect();
          return;
        }
        roomRef.current = handle;
        store().setErro(null);
        handle.setDeafened(store().surdo);
      })
      .catch((erro: unknown) => {
        if (cancelado) return;
        const mensagem =
          erro instanceof Error ? erro.message : "Falha ao conectar o audio";
        store().setErro(`Audio indisponivel: ${mensagem}`);
        store().setConectado(false);
      });

    return () => {
      cancelado = true;
      const handle = roomRef.current;
      roomRef.current = null;
      store().setConectado(false);
      store().setOutroNaSala(false);
      void handle?.disconnect();
    };
  }, [dmId, media, socket, outroId]);

  // 4. o outro sumiu da sala (fechou a aba, caiu de vez) — ou nunca chegou
  useEffect(() => {
    if (fase !== "em_chamada" || outroNaSala) return;
    const timer = setTimeout(() => {
      const atual = useChamadaDmStore.getState().chamada;
      if (atual?.dmId !== dmId || atual?.fase !== "em_chamada") return;
      encerrarChamadaDm(socket, "encerrada", "A chamada caiu.");
    }, AUSENCIA_MS);
    return () => clearTimeout(timer);
  }, [fase, outroNaSala, dmId, socket]);

  // som de entrada/saida, como na call de servidor
  const outroNaSalaAntes = useRef(false);
  useEffect(() => {
    if (outroNaSala && !outroNaSalaAntes.current && !surdo) playJoinChime();
    outroNaSalaAntes.current = outroNaSala;
  }, [outroNaSala, surdo]);

  const faseAntes = useRef(fase);
  useEffect(() => {
    if (faseAntes.current === "em_chamada" && fase === null) playLeaveChime();
    faseAntes.current = fase;
  }, [fase]);

  // mudo e surdo com efeito real sobre a midia
  useEffect(() => {
    void roomRef.current?.setMicrophoneEnabled(!mudo);
  }, [mudo]);
  useEffect(() => {
    roomRef.current?.setDeafened(surdo);
  }, [surdo]);

  /**
   * Fechar a aba no meio da chamada: avisa o outro na hora, em vez de deixa-lo
   * esperando `AUSENCIA_MS` ate perceber pela sala vazia. Melhor esforco — o
   * socket pode nao conseguir mandar a tempo, e ai a ausencia cobre.
   */
  useEffect(() => {
    if (!socket) return;
    const aoSair = () => {
      // So o que E desta aba. Tocando, a ligacao toca nas outras abas
      // tambem — fechar uma nao pode recusar por todas.
      const fase = useChamadaDmStore.getState().chamada?.fase;
      if (fase === "em_chamada" || fase === "chamando") encerrarChamadaDm(socket);
    };
    window.addEventListener("pagehide", aoSair);
    return () => window.removeEventListener("pagehide", aoSair);
  }, [socket]);

  return null;
}
