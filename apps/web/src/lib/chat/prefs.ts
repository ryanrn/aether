"use client";

import { create } from "zustand";

/**
 * Preferencias de aparencia do chat.
 *
 * Ficam no `localStorage` (por aparelho), como todo o resto de preferencia
 * deste app — `audio-prefs`, `devices`, `codecs`, `volumes`. Aparencia e
 * decisao de quem esta olhando a tela AGORA, nesta maquina; sincronizar entre
 * dispositivos exigiria uma tabela e um evento no gateway para um ganho que
 * quase ninguem sente. Se um dia precisar, migra.
 *
 * ETAPA 1: so `fontSize`, `densidade` e `timestamps` sao aplicados. `uiScale`,
 * espacamentos finos, tamanho de avatar e os toggles de acessibilidade entram
 * na etapa 2 (precisam do provedor no layout de `/app`).
 */

export interface ChatPrefs {
  /** corpo da mensagem, em px. 13–19. */
  fontSize: number;
  /** preset que define espacamento, avatar e ritmo de leitura de uma vez. */
  densidade: "compacta" | "confortavel" | "espacosa";
  /** quando mostrar o horario de cada mensagem. */
  timestamps: "sempre" | "hover" | "nunca";
}

export const PREFS_PADRAO: ChatPrefs = {
  fontSize: 15,
  densidade: "confortavel",
  timestamps: "hover",
};

const CHAVE = "aether:chat:prefs";
export const FONT_MIN = 13;
export const FONT_MAX = 19;

function ler(): ChatPrefs {
  if (typeof window === "undefined") return PREFS_PADRAO;
  try {
    const cru = window.localStorage.getItem(CHAVE);
    if (!cru) return PREFS_PADRAO;
    const salvo = JSON.parse(cru) as Partial<ChatPrefs>;
    return {
      fontSize: clampFonte(
        typeof salvo.fontSize === "number" ? salvo.fontSize : PREFS_PADRAO.fontSize,
      ),
      densidade:
        salvo.densidade === "compacta" ||
        salvo.densidade === "espacosa" ||
        salvo.densidade === "confortavel"
          ? salvo.densidade
          : PREFS_PADRAO.densidade,
      timestamps:
        salvo.timestamps === "sempre" ||
        salvo.timestamps === "nunca" ||
        salvo.timestamps === "hover"
          ? salvo.timestamps
          : PREFS_PADRAO.timestamps,
    };
  } catch {
    return PREFS_PADRAO;
  }
}

export function clampFonte(valor: number): number {
  if (!Number.isFinite(valor)) return PREFS_PADRAO.fontSize;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(valor)));
}

interface PrefsStore extends ChatPrefs {
  definir: <K extends keyof ChatPrefs>(chave: K, valor: ChatPrefs[K]) => void;
  restaurar: () => void;
}

/**
 * Nasce com os padroes (o servidor renderiza assim) e hidrata do
 * `localStorage` uma vez, no cliente — `hidratarPrefsDoChat` e chamado pelo
 * provedor de aparencia. Ler direto aqui no create daria mismatch de
 * hidratacao: servidor com padrao, cliente com o valor salvo.
 */
export const usePrefsDoChat = create<PrefsStore>((set) => ({
  ...PREFS_PADRAO,
  definir: (chave, valor) => {
    set((estado) => {
      const proximo = { ...estado, [chave]: valor };
      gravar(proximo);
      return { [chave]: valor } as Pick<ChatPrefs, typeof chave>;
    });
  },
  restaurar: () => {
    gravar(PREFS_PADRAO);
    set(PREFS_PADRAO);
  },
}));

function gravar(prefs: ChatPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CHAVE,
      JSON.stringify({
        fontSize: prefs.fontSize,
        densidade: prefs.densidade,
        timestamps: prefs.timestamps,
      }),
    );
  } catch {
    /* modo privado — vale so nesta sessao */
  }
}

let hidratou = false;
/** Chamado uma vez no cliente para trazer o que foi salvo. */
export function hidratarPrefsDoChat() {
  if (hidratou || typeof window === "undefined") return;
  hidratou = true;
  const salvo = ler();
  usePrefsDoChat.setState(salvo);
}
