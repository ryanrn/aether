"use client";

import { create } from "zustand";

/**
 * Preferencias de aparencia e acessibilidade.
 *
 * Ficam no `localStorage` (por aparelho), como todo o resto de preferencia
 * deste app — `audio-prefs`, `devices`, `codecs`, `volumes`. Aparencia e
 * decisao de quem esta olhando a tela AGORA, nesta maquina; sincronizar entre
 * dispositivos exigiria uma tabela e um evento no gateway para um ganho que
 * quase ninguem sente. Se um dia precisar, migra.
 *
 * O que e do CHAT (fonte, densidade, espacamentos, avatar, timestamps) vira
 * variavel CSS no container da lista. O que e GLOBAL (escala, contraste,
 * movimento, legibilidade) vira `--app-scale` e `data-*` no `<html>`, aplicado
 * pelo `<AparenciaProvider>` e por um script sem-flash no layout raiz.
 */

export type Densidade = "compacta" | "confortavel" | "espacosa";
export type ModoTimestamp = "sempre" | "hover" | "nunca";

export interface ChatPrefs {
  /* ---- chat ---- */
  fontSize: number; // 13–19 px
  densidade: Densidade;
  timestamps: ModoTimestamp;
  gapMensagem: number; // 0–12 px, dentro do grupo
  gapGrupo: number; // 6–40 px, entre grupos
  tamanhoAvatar: number; // 24–44 px

  /* ---- acessibilidade / global ---- */
  escalaInterface: number; // 0.9–1.2 — afeta o app inteiro
  contrasteAlto: boolean;
  reduzirMovimento: boolean;
  reduzirAnimacoes: boolean;
  legibilidade: boolean; // peso maior + linhas mais soltas no texto
}

/** Cada preset de densidade traz um conjunto coerente de medidas. */
export const PRESETS_DENSIDADE: Record<
  Densidade,
  Pick<ChatPrefs, "fontSize" | "gapMensagem" | "gapGrupo" | "tamanhoAvatar">
> = {
  compacta: { fontSize: 14, gapMensagem: 2, gapGrupo: 10, tamanhoAvatar: 26 },
  confortavel: { fontSize: 15, gapMensagem: 3, gapGrupo: 17, tamanhoAvatar: 32 },
  espacosa: { fontSize: 16, gapMensagem: 6, gapGrupo: 26, tamanhoAvatar: 38 },
};

export const PREFS_PADRAO: ChatPrefs = {
  densidade: "confortavel",
  timestamps: "hover",
  ...PRESETS_DENSIDADE.confortavel,
  escalaInterface: 1,
  contrasteAlto: false,
  reduzirMovimento: false,
  reduzirAnimacoes: false,
  legibilidade: false,
};

const CHAVE = "aether:chat:prefs";

export const LIMITES = {
  fontSize: [13, 19],
  gapMensagem: [0, 12],
  gapGrupo: [6, 40],
  tamanhoAvatar: [24, 44],
  escalaInterface: [0.9, 1.2],
} as const;

function clamp(valor: number, [min, max]: readonly [number, number]): number {
  if (!Number.isFinite(valor)) return min;
  return Math.min(max, Math.max(min, valor));
}

/** Normaliza qualquer coisa vinda do storage (editavel a mao) para algo valido. */
export function sanear(cru: unknown): ChatPrefs {
  const p = (cru ?? {}) as Partial<ChatPrefs>;
  const densidade: Densidade =
    p.densidade === "compacta" || p.densidade === "espacosa"
      ? p.densidade
      : "confortavel";
  const base = PRESETS_DENSIDADE[densidade];
  return {
    densidade,
    timestamps:
      p.timestamps === "sempre" || p.timestamps === "nunca"
        ? p.timestamps
        : "hover",
    fontSize: Math.round(
      clamp(num(p.fontSize, base.fontSize), LIMITES.fontSize),
    ),
    gapMensagem: Math.round(
      clamp(num(p.gapMensagem, base.gapMensagem), LIMITES.gapMensagem),
    ),
    gapGrupo: Math.round(clamp(num(p.gapGrupo, base.gapGrupo), LIMITES.gapGrupo)),
    tamanhoAvatar: Math.round(
      clamp(num(p.tamanhoAvatar, base.tamanhoAvatar), LIMITES.tamanhoAvatar),
    ),
    escalaInterface:
      Math.round(clamp(num(p.escalaInterface, 1), LIMITES.escalaInterface) * 20) /
      20,
    contrasteAlto: p.contrasteAlto === true,
    reduzirMovimento: p.reduzirMovimento === true,
    reduzirAnimacoes: p.reduzirAnimacoes === true,
    legibilidade: p.legibilidade === true,
  };
}

function num(v: unknown, padrao: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : padrao;
}

interface PrefsStore extends ChatPrefs {
  definir: <K extends keyof ChatPrefs>(chave: K, valor: ChatPrefs[K]) => void;
  restaurar: () => void;
}

/**
 * Nasce com os padroes (o servidor renderiza assim) e hidrata do
 * `localStorage` uma vez, no cliente, via `hidratarPrefsDoChat`. Ler no create
 * daria mismatch de hidratacao.
 */
export const usePrefsDoChat = create<PrefsStore>((set, get) => ({
  ...PREFS_PADRAO,
  definir: (chave, valor) => {
    set(() => {
      // Trocar de densidade reescreve as medidas do preset — o ajuste fino
      // parte de um ponto coerente em vez de continuar com os numeros antigos.
      if (chave === "densidade") {
        const proximo = {
          densidade: valor as Densidade,
          ...PRESETS_DENSIDADE[valor as Densidade],
        };
        gravar({ ...get(), ...proximo });
        return proximo;
      }
      const patch = { [chave]: valor } as Pick<ChatPrefs, typeof chave>;
      gravar({ ...get(), ...patch });
      return patch;
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
    window.localStorage.setItem(CHAVE, JSON.stringify(prefs));
  } catch {
    /* modo privado — vale so nesta sessao */
  }
}

let hidratou = false;
/** Chamado uma vez no cliente (pelo AparenciaProvider) para trazer o salvo. */
export function hidratarPrefsDoChat() {
  if (hidratou || typeof window === "undefined") return;
  hidratou = true;
  try {
    const cru = window.localStorage.getItem(CHAVE);
    usePrefsDoChat.setState(sanear(cru ? JSON.parse(cru) : {}));
  } catch {
    /* mantem os padroes */
  }
}
