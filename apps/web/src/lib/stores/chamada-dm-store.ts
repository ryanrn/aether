import { create } from "zustand";
import type { Track } from "livekit-client";
import type { ChamadaDm } from "@/lib/voice/chamada-dm";
import type { RemoteCamera, RemoteScreenShare } from "@/lib/voice/room";
import type { SharePresetId } from "@/lib/voice/screen-share";

/**
 * O que a interface pode pedir a sala de midia da chamada. Publicado pela
 * `<ChamadaDmSession>` enquanto a conexao existe; `null` fora dela — o painel
 * desabilita os botoes em vez de prometer o que nao tem como cumprir.
 */
export interface ControlesDaChamada {
  setUserVolume: (userId: string, volume: number) => void;
  setScreenAudioVolume: (volume: number) => void;
  /** `false` se a pessoa cancelou o seletor de tela */
  iniciarTela: (preset: SharePresetId, comAudio: boolean) => Promise<boolean>;
  trocarQualidade: (preset: SharePresetId) => Promise<boolean>;
  pararTela: () => Promise<void>;
  /** `false` quando o dispositivo recusou */
  setCamera: (ligada: boolean) => Promise<boolean>;
}

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
  /** telas e cameras do OUTRO, vindas do SFU */
  telas: RemoteScreenShare[];
  cameras: RemoteCamera[];
  /** as minhas faixas de video, para a previa (null = desligada) */
  minhaTela: Track | null;
  minhaCamera: Track | null;
  qualidadeDaTela: SharePresetId | null;
  controles: ControlesDaChamada | null;

  definir: (chamada: ChamadaDm | null) => void;
  setConectado: (conectado: boolean) => void;
  setOutroNaSala: (presente: boolean) => void;
  setMudo: (mudo: boolean) => void;
  setSurdo: (surdo: boolean) => void;
  setAviso: (aviso: { dmId: string; texto: string } | null) => void;
  setErro: (erro: string | null) => void;
  setTelas: (telas: RemoteScreenShare[]) => void;
  setCameras: (cameras: RemoteCamera[]) => void;
  setMinhaTela: (track: Track | null, qualidade?: SharePresetId | null) => void;
  setMinhaCamera: (track: Track | null) => void;
  setControles: (controles: ControlesDaChamada | null) => void;
}

/** Tudo que e da CONEXAO de midia — some junto com ela. */
const SEM_MIDIA = {
  conectado: false,
  outroNaSala: false,
  telas: [],
  cameras: [],
  minhaTela: null,
  minhaCamera: null,
  qualidadeDaTela: null,
  controles: null,
} satisfies Partial<ChamadaDmState>;

export const useChamadaDmStore = create<ChamadaDmState>((set) => ({
  chamada: null,
  mudo: false,
  surdo: false,
  aviso: null,
  erro: null,
  ...SEM_MIDIA,

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
            ...SEM_MIDIA,
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
  setTelas: (telas) => set({ telas }),
  setCameras: (cameras) => set({ cameras }),
  setMinhaTela: (minhaTela, qualidade) =>
    set({
      minhaTela,
      qualidadeDaTela: minhaTela ? (qualidade ?? null) : null,
    }),
  setMinhaCamera: (minhaCamera) => set({ minhaCamera }),
  setControles: (controles) => set({ controles }),
}));
