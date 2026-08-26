"use client";

/**
 * Atualizacao do app de desktop, do lado da pagina.
 *
 * O download continua automatico e invisivel — o que muda e o AVISO. Antes ele
 * era um `dialog.showMessageBox` do Electron: caixa nativa do Windows, fora do
 * desenho do app, roubando o foco de quem podia estar no meio de uma call.
 * Agora vira um botao dentro da barra de titulo, clicado quando a pessoa
 * quiser.
 *
 * Ignorar o botao nao custa nada: `autoInstallOnAppQuit` segue ligado, entao a
 * versao nova entra sozinha no proximo fechamento.
 */

interface PonteAtualizacao {
  pendente: () => Promise<string | null>;
  instalar: () => Promise<boolean>;
  aoFicarPronta: (callback: (versao: string) => void) => () => void;
}

function ponte(): PonteAtualizacao | null {
  if (typeof window === "undefined") return null;
  const desktop = (
    window as { aetherDesktop?: { atualizacao?: PonteAtualizacao } }
  ).aetherDesktop;
  return desktop?.atualizacao ?? null;
}

/**
 * A versao ja baixada e esperando, ou `null`.
 *
 * Perguntar ao montar e o que cobre o caso mais provavel: o download termina
 * durante o boot, antes de a pagina existir. O evento acontece uma vez, entao
 * quem chega depois nunca o veria — e o botao so apareceria na proxima
 * abertura, que e justamente quando ele ja nao seria necessario.
 */
export async function atualizacaoPendente(): Promise<string | null> {
  const api = ponte();
  if (!api) return null;
  try {
    return (await api.pendente()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Assina o aviso de "ficou pronta". Devolve a funcao de cancelar.
 *
 * Existe alem de `atualizacaoPendente` porque o download tambem pode terminar
 * com o app aberto ha horas — a verificacao roda de 6 em 6 horas.
 */
export function aoFicarPronta(
  callback: (versao: string) => void,
): () => void {
  const api = ponte();
  if (!api) return () => undefined;
  try {
    return api.aoFicarPronta(callback);
  } catch {
    return () => undefined;
  }
}

/** Fecha e reabre o app na versao nova. */
export async function instalarAtualizacao(): Promise<boolean> {
  const api = ponte();
  if (!api) return false;
  try {
    return (await api.instalar()) === true;
  } catch {
    return false;
  }
}
