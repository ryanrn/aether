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

export type SharePresetId =
  | "leve"
  | "padrao"
  | "gameplay"
  | "ultra"
  | "nitidez";

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
  /**
   * A ESCADA COMECA EM 720p, e isso nao e detalhe.
   *
   * Antes o perfil mais baixo era 1080p. Quando o teto por plano entrou, o
   * gratuito (720p) ficou com os TRES perfis trancados — quem nao paga
   * simplesmente nao conseguia compartilhar. Um limite que zera o recurso nao
   * e limite, e remocao.
   */
  leve: {
    id: "leve",
    label: "Leve",
    description: "720p a 30fps — gasta pouca banda, funciona em qualquer conexao",
    width: 1280,
    height: 720,
    frameRate: 30,
    contentHint: "detail",
    maxBitrate: 1_500_000,
  },
  padrao: {
    id: "padrao",
    label: "Padrao",
    description: "1080p a 30fps — serve para quase tudo",
    width: 1920,
    height: 1080,
    frameRate: 30,
    contentHint: "detail",
    maxBitrate: 3_000_000,
  },
  gameplay: {
    id: "gameplay",
    label: "Gameplay",
    description: "1080p a 60fps — movimento fluido, para jogo e video",
    width: 1920,
    height: 1080,
    frameRate: 60,
    contentHint: "motion",
    maxBitrate: 6_000_000,
  },
  ultra: {
    id: "ultra",
    label: "Ultra",
    description: "1440p a 60fps — o maximo, exige banda e placa boa",
    width: 2560,
    height: 1440,
    frameRate: 60,
    contentHint: "motion",
    maxBitrate: 10_000_000,
  },
  /**
   * NITIDEZ e o antigo "Leitura", e o nome novo diz o que ele faz.
   *
   * Ele nao esta na escada de qualidade: e 1440p com apenas 15 quadros, o que
   * o torna o MELHOR perfil para ler codigo e o PIOR para jogo. Chamado de
   * "Leitura" e listado primeiro, parecia o mais basico — e a duvida
   * "por que o mais simples esta trancado?" era inevitavel, porque ele e, na
   * verdade, o de maior resolucao.
   */
  nitidez: {
    id: "nitidez",
    label: "Nitidez",
    description: "1440p a 15fps — para ler codigo e texto pequeno",
    width: 2560,
    height: 1440,
    frameRate: 15,
    contentHint: "detail",
    maxBitrate: 2_500_000,
  },
};

export const DEFAULT_PRESET: SharePresetId = "padrao";

/**
 * A ordem da lista e a ESCADA DE QUALIDADE, do mais leve ao mais pesado, com
 * o perfil de texto no fim. Ordenar por outra coisa faria o cadeado aparecer
 * no meio da lista, e "por que o de cima esta trancado e o de baixo nao?" nao
 * tem resposta boa.
 */
export const PRESET_LIST: SharePreset[] = [
  SHARE_PRESETS.leve,
  SHARE_PRESETS.padrao,
  SHARE_PRESETS.gameplay,
  SHARE_PRESETS.ultra,
  SHARE_PRESETS.nitidez,
];

/** O navegador suporta captura de tela? Exige contexto seguro (HTTPS ou localhost). */
export function canCaptureScreen(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

/**
 * Preferencia de levar o som do sistema junto.
 *
 * Existe porque `getDisplayMedia` e TUDO-OU-NADA com audio: nao ha como pedir
 * "som se der, mas nao falhe". Quando o sistema recusa abrir a captura de som
 * ("Could not start audio source" — outro programa segurando o audio em modo
 * exclusivo, driver, ou o proprio navegador), a captura INTEIRA falha, video
 * junto.
 *
 * A versao antiga descobria isso tentando e, no erro, refazia a captura sem
 * audio — o que reabria o seletor nativo. Trocar surpresa por escolha: a
 * pessoa decide ANTES, e quando o som falha desligamos a opcao e lembramos,
 * para nao repetir o transtorno na proxima vez.
 */
const SHARE_AUDIO_KEY = "aether.share.systemAudio";

export function readShareAudioPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    // Padrao LIGADO: levar o som e o que a maioria espera.
    return window.localStorage.getItem(SHARE_AUDIO_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveShareAudioPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SHARE_AUDIO_KEY, enabled ? "on" : "off");
  } catch {
    // Storage bloqueado: a escolha vale so nesta sessao.
  }
}

/**
 * O erro e do SOM, e nao da tela?
 *
 * `NotReadableError` e o que o Chrome lanca quando nao consegue abrir a fonte
 * de audio. Distinguir importa: nesse caso a tela funcionaria perfeitamente
 * sem o som, e a mensagem para o usuario e outra.
 */
export function isAudioSourceError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "NotReadableError") return true;
  return /audio source|audio capture/i.test(error.message);
}

/**
 * Estamos rodando dentro do app desktop?
 *
 * O preload do Electron publica `window.aetherDesktop`. Isso importa para o
 * SOM: no desktop existe um seletor proprio, com a chave de audio dele, e o
 * Chromium so entrega faixa de audio se o RENDERER tambem tiver pedido —
 * verificado. Ou seja, se o app web mandar `audio: false`, a chave do seletor
 * vira enfeite.
 *
 * Entao no desktop pedimos audio SEMPRE e deixamos o seletor decidir. A chave
 * daqui, que existe porque no navegador pedir som pode derrubar a captura
 * inteira, nao faz sentido la — o seletor tem a dele.
 */
export function isDesktopApp(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as { aetherDesktop?: unknown }).aetherDesktop === "object" &&
    (window as { aetherDesktop?: unknown }).aetherDesktop !== null
  );
}

interface AetherDesktopBridge {
  reportAudioCaptureFailed?: (detalhes: {
    erro: string;
    dispositivo: string | null;
  }) => void;
}

/**
 * O rotulo da saida de audio PADRAO agora.
 *
 * Vai junto com o aviso de falha para o processo principal decidir se a marca
 * de "som falhou" ainda vale na proxima vez: trocar de fone merece nova
 * tentativa, e sem o nome do aparelho nao ha como saber que trocou.
 *
 * Devolve `null` quando nao da — sem rotulo o registro fica menos util, mas
 * nada quebra.
 */
async function saidaPadraoDeAudio(): Promise<string | null> {
  try {
    const dispositivos = await navigator.mediaDevices.enumerateDevices();
    const saida = dispositivos.find(
      (d) => d.kind === "audiooutput" && d.deviceId === "default",
    );
    return saida?.label ?? null;
  } catch {
    return null;
  }
}

/**
 * Avisa o processo principal do Electron que a captura de som falhou.
 *
 * Existe porque no desktop pedimos audio SEMPRE (ver `isDesktopApp`) — quem
 * decide se tenta de verdade e o seletor proprio, la no main process. Sem
 * avisar a falha, o seletor continuaria pedindo som na proxima tentativa e
 * cairia no MESMO erro, para sempre, numa maquina onde o loopback nao
 * funciona (verificado com dongle de audio sem fio).
 */
export async function reportDesktopAudioFailure(erro: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  const bridge = (window as { aetherDesktop?: AetherDesktopBridge }).aetherDesktop;
  if (!bridge?.reportAudioCaptureFailed) return;

  /**
   * O erro vai por INTEIRO (nome e mensagem), e nao reduzido a um booleano.
   * Foi a falta disto que deixou o problema semanas sem causa: o app tinha o
   * `NotReadableError: Could not start audio source` na mao e descartava.
   */
  const descricao =
    erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro);

  bridge.reportAudioCaptureFailed({
    erro: descricao,
    dispositivo: await saidaPadraoDeAudio(),
  });
}
