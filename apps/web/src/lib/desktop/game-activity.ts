"use client";

/**
 * Ponte com a deteccao de jogo do app de desktop.
 *
 * O navegador NAO enumera processos — e nao deve mesmo. Entao isto so existe
 * dentro do Electron, onde o processo principal faz o casamento e entrega
 * apenas o nome do jogo. Aqui nao ha deteccao nenhuma: so recebemos.
 *
 * No navegador todas as funcoes respondem "nao da", e a interface usa isso
 * para explicar em vez de mostrar um botao que nao faria nada.
 */

/** O que o processo principal entrega: nome ja resolvido e icone do executavel. */
export interface DetectedGame {
  nome: string;
  icone: string | null;
}

interface GameDetectionBridge {
  isEnabled: () => Promise<boolean>;
  setEnabled: (enabled: boolean) => Promise<boolean>;
  getCurrent: () => Promise<DetectedGame | null>;
  /** devolve a funcao que cancela a inscricao */
  onChange: (callback: (game: DetectedGame | null) => void) => () => void;
  definirCatalogo: (lista: { chave: string; nome: string }[]) => Promise<number>;
  listarCandidatos: () => Promise<string[]>;
}

function bridge(): GameDetectionBridge | null {
  if (typeof window === "undefined") return null;
  const desktop = (
    window as { aetherDesktop?: { gameDetection?: GameDetectionBridge } }
  ).aetherDesktop;
  return desktop?.gameDetection ?? null;
}

/** O app consegue detectar jogo? So no desktop, e so no Windows. */
export function canDetectGames(): boolean {
  return bridge() !== null;
}

export async function isGameDetectionEnabled(): Promise<boolean> {
  const api = bridge();
  if (!api) return false;
  try {
    return await api.isEnabled();
  } catch {
    return false;
  }
}

export async function setGameDetectionEnabled(
  enabled: boolean,
): Promise<boolean> {
  const api = bridge();
  if (!api) return false;
  try {
    return await api.setEnabled(enabled);
  } catch {
    return false;
  }
}

/**
 * O jogo ja detectado, sem esperar a proxima troca.
 *
 * Necessario porque o vigia do processo principal avisa apenas em MUDANCA: uma
 * pagina que carrega depois de o jogo ja ter sido detectado nunca receberia o
 * aviso, e o jogo nao apareceria ate a pessoa fechar e abrir o jogo.
 */
export async function currentGame(): Promise<DetectedGame | null> {
  const api = bridge();
  if (!api) return null;
  try {
    return await api.getCurrent();
  } catch {
    return null;
  }
}

/**
 * Escuta as trocas de jogo. Devolve a funcao de cancelar — sempre chamar na
 * limpeza do efeito, senao cada remontagem empilha mais um ouvinte.
 */
export function onGameChange(
  callback: (game: DetectedGame | null) => void,
): () => void {
  const api = bridge();
  if (!api) return () => undefined;
  try {
    return api.onChange(callback);
  } catch {
    return () => undefined;
  }
}

/**
 * Abrir o app junto com o Windows.
 *
 * Mora neste arquivo por conveniencia de vizinhanca — e a mesma ponte
 * `window.aetherDesktop` — mas nao tem relacao com deteccao de jogo. Se
 * aparecer uma terceira preferencia de desktop, vale um arquivo proprio.
 *
 * A PREFERENCIA E DO SISTEMA. `isEnabled` pergunta ao processo principal toda
 * vez em vez de guardar um valor: a pessoa pode ter tirado o Aether da
 * inicializacao pelo Gerenciador de Tarefas, e uma copia nossa continuaria
 * dizendo que esta ligado enquanto o app nao abre.
 */
interface PonteInicio {
  isEnabled: () => Promise<boolean>;
  setEnabled: (ligar: boolean) => Promise<boolean>;
}

function ponteInicio(): PonteInicio | null {
  if (typeof window === "undefined") return null;
  const desktop = (
    window as { aetherDesktop?: { iniciarComWindows?: PonteInicio } }
  ).aetherDesktop;
  return desktop?.iniciarComWindows ?? null;
}

/** O app consegue configurar isso? So no desktop. */
export function podeIniciarComWindows(): boolean {
  return ponteInicio() !== null;
}

export async function iniciaComWindows(): Promise<boolean> {
  const api = ponteInicio();
  if (!api) return false;
  try {
    return (await api.isEnabled()) === true;
  } catch {
    return false;
  }
}

/** Devolve o que o SISTEMA passou a dizer, nao o que foi pedido. */
export async function setIniciarComWindows(ligar: boolean): Promise<boolean> {
  const api = ponteInicio();
  if (!api) return false;
  try {
    return (await api.setEnabled(ligar)) === true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------
 * Biblioteca da comunidade
 * ------------------------------------------------------------------------- */

/**
 * Busca o catalogo aprovado e entrega ao processo principal.
 *
 * A PAGINA busca porque a sessao vive aqui. O processo principal so recebe —
 * dar-lhe credencial propria seria criar um segundo lugar com segredo.
 *
 * Silencioso em qualquer falha: catalogo da comunidade e um extra sobre a
 * deteccao que ja funciona, e nao pode virar erro na tela de quem so abriu o
 * app.
 */
export async function sincronizarCatalogoDeJogos(): Promise<number> {
  const api = bridge();
  if (!api) return 0;
  try {
    const resposta = await fetch("/api/jogos", { cache: "no-store" });
    if (!resposta.ok) return 0;
    const dados = (await resposta.json()) as {
      jogos?: { chave: string; nome: string }[];
    };
    return await api.definirCatalogo(dados.jogos ?? []);
  } catch {
    return 0;
  }
}

/**
 * Os processos que a pessoa poderia sugerir como jogo.
 *
 * Lista vazia quando a deteccao esta desligada — quem nao quis que lessemos a
 * lista de programas nao passa a querer por ter aberto um menu.
 */
export async function listarCandidatosAJogo(): Promise<string[]> {
  const api = bridge();
  if (!api) return [];
  try {
    return await api.listarCandidatos();
  } catch {
    return [];
  }
}
