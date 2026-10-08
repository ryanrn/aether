import { create } from "zustand";
import type { ChamadaDm } from "@/lib/voice/chamada-dm";

/**
 * Estado da chamada de voz em conversa direta, nesta aba.
 *
 * Store propria, e nao mais um pedaco da `realtime-store`: a voz de servidor
 * tem ocupacao publicada pelo gateway (`voice:update`, `voiceIntent`,
 * religar no reconnect), e a chamada direta nao tem nada disso — misturar os
 * dois faria cada acao da voz de servidor ter de perguntar "qual das duas?".
 * Nao persiste em `sessionStorage`: recarregar a aba encerra a chamada (o
 * outro lado percebe pela ausencia na sala de midia). Ver limitacoes no README.
 */
interface ChamadaDmState {
  chamada: ChamadaDm | null;
  /** conectado a sala do SFU agora */
  conectado: boolean;
  /** o outro participante esta na sala de midia agora */
  outroNaSala: boolean;
  mudo: boolean;
  surdo: boolean;
  /** ultimo aviso sobre a chamada ("recusou", "nao atendeu"), por conversa */
  aviso: { dmId: string; texto: string } | null;
  /** erro de midia (microfone, SFU) — mostrado no painel da chamada */
  erro: string | null;

  definir: (chamada: ChamadaDm | null) => void;
  setConectado: (conectado: boolean) => void;
  setOutroNaSala: (presente: boolean) => void;
  setMudo: (mudo: boolean) => void;
  setSurdo: (surdo: boolean) => void;
  setAviso: (aviso: { dmId: string; texto: string } | null) => void;
  setErro: (erro: string | null) => void;
}

export const useChamadaDmStore = create<ChamadaDmState>((set) => ({
  chamada: null,
  conectado: false,
  outroNaSala: false,
  mudo: false,
  surdo: false,
  aviso: null,
  erro: null,

  definir: (chamada) =>
    set((estado) => {
      // Chamada nova (ou nenhuma): zera o que era da anterior. Mudo e surdo
      // tambem — entrar numa ligacao ja mudo por causa da ultima seria a
      // surpresa de "ninguem me ouve" sem motivo aparente.
      const mesma =
        chamada !== null && estado.chamada?.dmId === chamada.dmId;
      return mesma
        ? { chamada }
        : {
            chamada,
            conectado: false,
            outroNaSala: false,
            mudo: false,
            surdo: false,
            erro: null,
          };
    }),
  setConectado: (conectado) => set({ conectado }),
  setOutroNaSala: (outroNaSala) => set({ outroNaSala }),
  setMudo: (mudo) => set({ mudo }),
  setSurdo: (surdo) => set({ surdo }),
  setAviso: (aviso) => set({ aviso }),
  setErro: (erro) => set({ erro }),
}));
