"use client";

/**
 * Perfis de qualidade do compartilhamento de tela.
 *
 * Nao existe trava artificial aqui: 1080p60 nao e "recurso pago", e so uma
 * escolha de banda. O que limita de verdade e o seu upload, a CPU para
 * codificar e o plano do SFU.
 *
 * O parametro que mais importa nao e a resolucao, e o `contentHint`. Ele diz
 * ao codificador o que sacrificar quando a banda aperta:
 *
 *  - "detail" preserva NITIDEZ e derruba quadros. Codigo e texto ficam
 *    legiveis; o movimento fica travado — e para ler isso nao importa.
 *  - "motion" preserva FLUIDEZ e borra a imagem. Jogo fica suave; texto pequeno
 *    fica ilegivel — e num jogo isso nao importa.
 *
 * Escolher errado aqui e o que faz "a tela ficar horrivel" mesmo com banda
 * sobrando.
 */

export type SharePresetId = "leitura" | "equilibrado" | "movimento";

export interface SharePreset {
  id: SharePresetId;
  label: string;
  description: string;
  width: number;
  height: number;
  frameRate: number;
  contentHint: "detail" | "motion";
  /** teto de bitrate em bits por segundo */
  maxBitrate: number;
}

export const SHARE_PRESETS: Record<SharePresetId, SharePreset> = {
  leitura: {
    id: "leitura",
    label: "Leitura",
    description: "Codigo e documentos — prioriza nitidez, poucos quadros",
    width: 2560,
    height: 1440,
    frameRate: 15,
    contentHint: "detail",
    maxBitrate: 2_500_000,
  },
  equilibrado: {
    id: "equilibrado",
    label: "Equilibrado",
    description: "1080p a 30fps — serve para quase tudo",
    width: 1920,
    height: 1080,
    frameRate: 30,
    contentHint: "detail",
    maxBitrate: 3_000_000,
  },
  movimento: {
    id: "movimento",
    label: "Movimento",
    description: "Jogos e video — 1080p a 60fps, prioriza fluidez",
    width: 1920,
    height: 1080,
    frameRate: 60,
    contentHint: "motion",
    maxBitrate: 6_000_000,
  },
};

export const DEFAULT_PRESET: SharePresetId = "equilibrado";

export const PRESET_LIST: SharePreset[] = [
  SHARE_PRESETS.leitura,
  SHARE_PRESETS.equilibrado,
  SHARE_PRESETS.movimento,
];

/** O navegador suporta captura de tela? Exige contexto seguro (HTTPS ou localhost). */
export function canCaptureScreen(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}
