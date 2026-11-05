import "server-only";

import { prisma } from "@aether/db";
import { carregarHub, flagLigada, motivoParaNaoEntrarNoHub } from "@aether/access";
import {
  HUB_MAX_SALAS,
  MENSAGEM_DE_RECUSA_DO_HUB,
  type ActionResult,
  type MotivoDeRecusaDoHub,
} from "@aether/shared";
import { writeAudit } from "../audit";
import { banAtivo } from "./moderation";
import { criarSalaDeGrupo } from "./salas-de-grupo";

/**
 * Hub global "AETHER · Grupos" (fase 2, estagio 4b-1).
 *
 * O hub e um servidor marcado (`Server.hub`). Entrar nele = virar membro com o
 * cargo padrao, depois de aceitar as regras e passar pelos requisitos de conta
 * (`motivoParaNaoEntrarNoHub`, em `@aether/access`). Daqui em diante, voz,
 * permissao e lotacao sao as de qualquer servidor — nenhuma regra nova de
 * autorizacao para "entrar em sala sem ser membro".
 */

export interface EstadoDoHub {
  hubId: string;
  /** ja e membro do hub */
  membro: boolean;
  /** por que NAO pode entrar agora; `null` = pode */
  motivo: MotivoDeRecusaDoHub | null;
}

/**
 * O hub como esta pessoa o ve. `null` = nao ha hub para mostrar (flag
 * desligada ou nenhum servidor marcado) — a tela simplesmente nao tem a secao.
 */
export async function estadoDoHub(userId: string): Promise<EstadoDoHub | null> {
  if (!(await flagLigada("hub_grupos"))) return null;
  const hub = await carregarHub();
  if (!hub) return null;

  const [conta, membro, banido] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        createdAt: true,
        emailVerificadoEm: true,
        silenciadoEm: true,
        silenciadoAte: true,
        equipe: true,
      },
    }),
    prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: hub.id, userId } },
      select: { id: true },
    }),
    banAtivo(hub.id, userId),
  ]);
  if (!conta) return null;

  return {
    hubId: hub.id,
    membro: membro !== null,
    motivo: motivoParaNaoEntrarNoHub(conta, { banido }),
  };
}

/**
 * Entra no hub: cria a participacao com o cargo padrao. Idempotente — quem ja e
 * membro recebe o id do hub de volta.
 *
 * Os requisitos sao conferidos AQUI, no servidor, mesmo que a tela ja os tenha
 * mostrado: a tela so esconde o botao.
 */
export async function entrarNoHub(
  userId: string,
): Promise<ActionResult<{ hubId: string }>> {
  const estado = await estadoDoHub(userId);
  // Hub desligado ou inexistente: nao revelamos se existe (regra do projeto).
  if (!estado) return { ok: false, error: "Hub nao encontrado" };
  if (estado.motivo) {
    return { ok: false, error: MENSAGEM_DE_RECUSA_DO_HUB[estado.motivo] };
  }
  if (estado.membro) return { ok: true, data: { hubId: estado.hubId } };

  const cargoPadrao = await prisma.role.findFirst({
    where: { serverId: estado.hubId, isDefault: true },
    select: { id: true },
  });

  // Mesma forma do `joinServerByCode`: membro e cargo padrao numa transacao.
  try {
    await prisma.$transaction(async (tx) => {
      const member = await tx.serverMember.create({
        data: { serverId: estado.hubId, userId },
        select: { id: true },
      });
      if (cargoPadrao) {
        await tx.memberRole.create({
          data: { memberId: member.id, roleId: cargoPadrao.id },
        });
      }
    });
  } catch (error) {
    // Dois cliques ao mesmo tempo: o segundo bate no unique e ja e membro.
    if ((error as { code?: string })?.code !== "P2002") throw error;
    return { ok: true, data: { hubId: estado.hubId } };
  }

  await writeAudit({
    serverId: estado.hubId,
    actorId: userId,
    action: "server.join",
    targetType: "user",
    targetId: userId,
    metadata: { via: "hub" },
  });
  return { ok: true, data: { hubId: estado.hubId } };
}

/**
 * Cria (ou devolve) a sala da pessoa no hub. Mesma funcao das salas de grupo
 * de servidor, com o teto e a lotacao do hub.
 *
 * Exige ser membro: quem cria sala tem de ter aceitado as regras.
 */
export async function criarSalaNoHub(params: {
  userId: string;
  jogo: string;
  tamanho: number;
}): Promise<ActionResult<{ hubId: string; channelId: string; jaExistia: boolean }>> {
  const estado = await estadoDoHub(params.userId);
  if (!estado) return { ok: false, error: "Hub nao encontrado" };
  if (estado.motivo) {
    return { ok: false, error: MENSAGEM_DE_RECUSA_DO_HUB[estado.motivo] };
  }
  if (!estado.membro) {
    return { ok: false, error: "Entre no hub antes de criar uma sala." };
  }

  const { channelId, jaExistia } = await criarSalaDeGrupo({
    serverId: estado.hubId,
    jogo: params.jogo,
    criadaPor: params.userId,
    teto: HUB_MAX_SALAS,
    tamanho: params.tamanho,
  });
  return { ok: true, data: { hubId: estado.hubId, channelId, jaExistia } };
}

/**
 * Bane do hub (estagio 4b-2) — decisao da EQUIPE, nao do criador da sala.
 *
 * Usa o `Ban` de servidor de sempre, no servidor do hub: `entrarNoHub` ja
 * recusa banido (`banAtivo` -> motivo "banido"), e o `joinServerByCode` tambem.
 * Funciona mesmo que a pessoa nao seja membro agora (ela nao volta a entrar).
 *
 * Quem chama confere que e equipe e tira a pessoa do gateway depois.
 */
export async function banirDoHub(params: {
  userId: string;
  porQuem: string;
  motivo: string | null;
  ate: Date | null;
}): Promise<ActionResult<{ hubId: string }>> {
  const hub = await carregarHub();
  if (!hub) return { ok: false, error: "Nao ha hub marcado." };

  await prisma.$transaction([
    prisma.ban.upsert({
      where: { serverId_userId: { serverId: hub.id, userId: params.userId } },
      create: {
        serverId: hub.id,
        userId: params.userId,
        issuedById: params.porQuem,
        reason: params.motivo,
        expiresAt: params.ate,
      },
      update: {
        issuedById: params.porQuem,
        reason: params.motivo,
        expiresAt: params.ate,
        createdAt: new Date(),
      },
    }),
    prisma.serverMember.deleteMany({
      where: { serverId: hub.id, userId: params.userId },
    }),
  ]);
  return { ok: true, data: { hubId: hub.id } };
}
