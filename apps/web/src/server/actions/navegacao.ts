"use server";

import { prisma } from "@aether/db";
import {
  getChannelPermissionMap,
  loadDmList,
  loadMemberAccess,
} from "@aether/access";
import { has, type ActionResult } from "@aether/shared";
import { requireUser } from "../guards";
import { ok, toActionError } from "./action-result";

/**
 * Indice para o trocador rapido (Ctrl+K).
 *
 * POR QUE PRECISA DE UMA ACTION. O cliente so conhece os canais do servidor
 * ABERTO — a arvore chega pelo layout daquele servidor. Um trocador que so
 * enxerga onde voce ja esta nao serve para nada: o ponto dele e justamente
 * pular para outro lugar sem procurar.
 *
 * A PERMISSAO E CALCULADA AQUI, canal por canal, com a mesma
 * `getChannelPermissionMap` que a arvore usa. Sem isso o trocador viraria uma
 * listagem de canais privados: bastaria digitar parte do nome para descobrir
 * que existe um canal que voce nao pode ver — e o resto do sistema responde
 * 404 justamente para nao revelar isso.
 */

export interface ItemDeNavegacao {
  tipo: "servidor" | "canal" | "conversa";
  id: string;
  /** Para onde ir ao escolher. */
  href: string;
  /** O que aparece em destaque. */
  titulo: string;
  /** Contexto abaixo do titulo: nome do servidor, "@usuario". */
  subtitulo: string | null;
  /** Canal de voz e desenhado diferente do de texto. */
  variante?: "TEXT" | "VOICE";
  iconUrl?: string | null;
}

export async function carregarIndiceDeNavegacao(): Promise<
  ActionResult<{ itens: ItemDeNavegacao[] }>
> {
  try {
    const session = await requireUser();
    const userId = session.user.id;

    const membros = await prisma.serverMember.findMany({
      where: { userId },
      orderBy: [{ position: "asc" }, { joinedAt: "asc" }],
      select: {
        serverId: true,
        server: { select: { id: true, name: true, iconUrl: true } },
      },
    });

    const itens: ItemDeNavegacao[] = [];

    for (const membro of membros) {
      itens.push({
        tipo: "servidor",
        id: membro.server.id,
        href: `/app/s/${membro.server.id}`,
        titulo: membro.server.name,
        subtitulo: "Servidor",
        iconUrl: membro.server.iconUrl,
      });

      /**
       * `loadMemberAccess` + `getChannelPermissionMap` sao as MESMAS funcoes
       * que montam a arvore e as salas do gateway. Repetir a regra aqui, ainda
       * que "mais simples", criaria uma segunda verdade sobre o que cada
       * pessoa enxerga — e a que ficasse para tras seria um vazamento.
       */
      const acesso = await loadMemberAccess(membro.serverId, userId);
      if (!acesso) continue;

      const permissoes = await getChannelPermissionMap(acesso);
      const visiveis = [...permissoes.entries()]
        .filter(([, bits]) => has(bits, "VIEW_CHANNEL"))
        .map(([channelId]) => channelId);
      if (visiveis.length === 0) continue;

      const canais = await prisma.channel.findMany({
        where: { id: { in: visiveis } },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, type: true },
      });

      for (const canal of canais) {
        itens.push({
          tipo: "canal",
          id: canal.id,
          href: `/app/s/${membro.serverId}/c/${canal.id}`,
          titulo: canal.name,
          subtitulo: membro.server.name,
          variante: canal.type,
        });
      }
    }

    /**
     * Conversas diretas passam por `loadDmList`, que ja aplica bloqueio e
     * amizade. Uma consulta propria aqui poderia listar conversa de alguem que
     * bloqueou voce — a lista tem de concordar com o acesso, sempre.
     */
    const conversas = await loadDmList(userId);
    if (conversas.length > 0) {
      const usuarios = await prisma.user.findMany({
        where: { id: { in: conversas.map((c) => c.outroId) } },
        select: { id: true, username: true, displayName: true, avatarUrl: true },
      });
      const porId = new Map(usuarios.map((u) => [u.id, u]));

      for (const conversa of conversas) {
        const outro = porId.get(conversa.outroId);
        if (!outro) continue;
        itens.push({
          tipo: "conversa",
          id: conversa.dmId,
          href: `/app/dm/${conversa.dmId}`,
          titulo: outro.displayName,
          subtitulo: `@${outro.username}`,
          iconUrl: outro.avatarUrl,
        });
      }
    }

    return ok({ itens });
  } catch (error) {
    return toActionError(error);
  }
}
