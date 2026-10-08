import type {
  MediaGrant,
  MotivoFimDeChamada,
  PublicUser,
} from "@aether/shared";

/**
 * Maquina de estados da chamada de voz numa conversa direta — PURA.
 *
 * O gateway nao guarda chamada nenhuma (ver `apps/realtime/src/handlers/
 * dm-call.ts`): ele so repassa "tocou", "atendeu" e "acabou" para as salas
 * pessoais dos dois. Quem decide o que cada aviso significa para ESTA aba e
 * esta funcao. Fica fora do componente para ser testada sem React e sem socket
 * (`tests/unit/chamada-dm.test.ts`) — e porque as decisoes de corrida (os dois
 * ligam ao mesmo tempo, duas abas tocando, eco do proprio aviso) sao
 * exatamente o tipo de coisa que quebra calada.
 */

export type ChamadaDm =
  /** eu liguei; o token ja veio, a conexao com o SFU so abre quando atenderem */
  | {
      fase: "chamando";
      dmId: string;
      outro: PublicUser;
      media: MediaGrant;
      desde: number;
    }
  /** estao me ligando */
  | { fase: "recebendo"; dmId: string; outro: PublicUser; desde: number }
  /** cliquei em atender e espero o token */
  | { fase: "atendendo"; dmId: string; outro: PublicUser; desde: number }
  /** chamada de pe: conectado (ou conectando) a sala `dm:<dmId>` do SFU */
  | {
      fase: "em_chamada";
      dmId: string;
      outro: PublicUser;
      media: MediaGrant;
      desde: number;
    };

/** Quanto tempo o telefone toca antes de virar "nao atendeu". */
export const TOQUE_MS = 30_000;

/**
 * Quanto tempo esperar o outro aparecer (ou voltar) na sala de midia antes de
 * dar a chamada por encerrada. Cobre o outro lado ainda conectando depois de
 * atender, e uma queda de rede curta dele — que a reconexao do LiveKit
 * resolve sozinha dentro disso.
 */
export const AUSENCIA_MS = 20_000;

/** O que fazer quando chega `dmcall:incoming`. */
export type ReacaoAChamada =
  /** ninguem na linha: toca */
  | "tocar"
  /**
   * Eu ja estava ligando PARA ESTA PESSOA (os dois clicaram juntos), ou ja
   * estou em chamada com ela e ela ligou de novo (recarregou a aba e perdeu a
   * chamada do lado dela). Atender na hora, sem tocar: os dois querem falar.
   */
  | "atender"
  /** estou em chamada (ou tocando) com OUTRA pessoa: recusa automatica */
  | "ocupado"
  /** aviso repetido do que ja esta tocando */
  | "ignorar";

export function reagirAChamada(
  atual: ChamadaDm | null,
  dmId: string,
): ReacaoAChamada {
  if (!atual) return "tocar";
  if (atual.dmId !== dmId) return "ocupado";
  if (atual.fase === "chamando" || atual.fase === "em_chamada") return "atender";
  return "ignorar";
}

/**
 * `dmcall:accepted` chegou. Devolve o proximo estado (o mesmo objeto quando o
 * aviso nao muda nada para esta aba).
 */
export function aoAtenderem(
  atual: ChamadaDm | null,
  evento: { dmId: string; por: string },
  euId: string | null,
): ChamadaDm | null {
  if (!atual || atual.dmId !== evento.dmId) return atual;

  // Eu liguei e o outro atendeu.
  if (atual.fase === "chamando" && evento.por !== euId) {
    return {
      fase: "em_chamada",
      dmId: atual.dmId,
      outro: atual.outro,
      media: atual.media,
      desde: Date.now(),
    };
  }

  // Eu mesmo atendi — mas em OUTRA aba. Esta para de tocar.
  if (atual.fase === "recebendo" && evento.por === euId) return null;

  // Eco do proprio aceite, ou aviso atrasado: nada muda.
  return atual;
}

export interface FimDeChamada {
  proximo: ChamadaDm | null;
  /** o que dizer na tela; `null` quando o fim foi pedido por esta pessoa */
  aviso: string | null;
}

/** `dmcall:ended` chegou. */
export function aoEncerrar(
  atual: ChamadaDm | null,
  evento: { dmId: string; por: string; motivo: MotivoFimDeChamada },
  euId: string | null,
): FimDeChamada {
  if (!atual || atual.dmId !== evento.dmId) return { proximo: atual, aviso: null };

  // Fui eu (nesta ou noutra aba): a aba que pediu ja escreveu o proprio aviso.
  if (evento.por === euId) return { proximo: null, aviso: null };

  return { proximo: null, aviso: textoDoFim(evento.motivo, atual) };
}

function textoDoFim(motivo: MotivoFimDeChamada, atual: ChamadaDm): string {
  const nome = atual.outro.displayName;
  switch (motivo) {
    case "recusada":
      return `${nome} recusou a chamada.`;
    case "ocupado":
      return `${nome} esta em outra chamada.`;
    case "sem_resposta":
    case "cancelada":
      // Do lado de quem RECEBIA: a ligacao parou de tocar sem ser atendida.
      return `Chamada perdida de ${nome}.`;
    case "encerrada":
      return `${nome} encerrou a chamada.`;
  }
}

/**
 * Qual motivo mandar ao encerrar por conta propria, a partir da fase atual.
 * Um botao so ("desligar"/"recusar") cobre todas — quem decide o nome e a fase.
 */
export function motivoAoEncerrar(atual: ChamadaDm): MotivoFimDeChamada {
  switch (atual.fase) {
    case "chamando":
      return "cancelada";
    case "recebendo":
    case "atendendo":
      return "recusada";
    case "em_chamada":
      return "encerrada";
  }
}
