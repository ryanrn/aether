import "server-only";

import { prisma } from "@aether/db";
import { planoAtende, planoEfetivo } from "@aether/shared";
import type {
  PerfilParaCartao,
  PlanTier,
  PublicRole,
  RelacaoComUsuario,
} from "@aether/shared";

/**
 * O que o cartao de perfil precisa alem do `PublicUser` que ele ja tem da
 * mensagem: bio (global), apelido e cargos (do servidor aberto) e o estado da
 * relacao de amizade. Uma consulta por pilar, todas por indice.
 *
 * `serverId` ausente = contexto de DM: sem apelido, sem cargos.
 *
 * Regra de nao-revelar: se o servidor foi passado e QUEM OLHA nao e membro
 * dele, ou o ALVO nao e, os cargos voltam vazios (nao da erro — o cartao
 * simplesmente nao mostra a secao). O 404 de verdade e responsabilidade da
 * pagina; aqui a pessoa ja esta vendo uma mensagem do alvo.
 */
export async function perfilParaCartao(
  viewerId: string,
  alvoId: string,
  serverId: string | null,
): Promise<PerfilParaCartao> {
  const [alvo, relacao, dadosServidor] = await Promise.all([
    prisma.user.findUnique({
      where: { id: alvoId },
      select: {
        bio: true,
        assinatura: { select: { tier: true, expiraEm: true } },
        banner: { select: { assetUrl: true, ativo: true, tierMinimo: true } },
      },
    }),
    calcularRelacao(viewerId, alvoId),
    serverId ? cargosNoServidor(viewerId, alvoId, serverId) : null,
  ]);

  return {
    bio: alvo?.bio?.trim() || null,
    banner: bannerResolvido(alvo),
    nickname: dadosServidor?.nickname ?? null,
    roles: dadosServidor?.roles ?? [],
    relacao: alvoId === viewerId ? "eu" : relacao.estado,
    friendshipId: relacao.friendshipId,
  };
}

/**
 * O banner equipado que de fato vale — resolvido contra o plano (vencimento
 * aplicado) e contra `ativo`, como a moldura e a decoracao. Some se o plano
 * caiu; a escolha continua no banco.
 */
function bannerResolvido(
  alvo: {
    assinatura: { tier: PlanTier; expiraEm: Date | null } | null;
    banner: { assetUrl: string; ativo: boolean; tierMinimo: PlanTier } | null;
  } | null,
): string | null {
  const b = alvo?.banner;
  if (!b || !b.ativo) return null;
  const plano = planoEfetivo(alvo?.assinatura ?? null);
  return planoAtende(plano, b.tierMinimo) ? b.assetUrl : null;
}

async function cargosNoServidor(
  viewerId: string,
  alvoId: string,
  serverId: string,
): Promise<{ nickname: string | null; roles: PublicRole[] } | null> {
  const [souMembro, membroAlvo] = await Promise.all([
    prisma.serverMember.findFirst({
      where: { serverId, userId: viewerId },
      select: { id: true },
    }),
    prisma.serverMember.findFirst({
      where: { serverId, userId: alvoId },
      select: {
        nickname: true,
        roles: {
          select: {
            role: {
              select: {
                id: true,
                name: true,
                color: true,
                position: true,
                isDefault: true,
                isOwner: true,
                permissions: true,
              },
            },
          },
        },
      },
    }),
  ]);

  if (!souMembro || !membroAlvo) return null;

  return {
    nickname: membroAlvo.nickname,
    roles: membroAlvo.roles
      .map(({ role }) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        isDefault: role.isDefault,
        isOwner: role.isOwner,
        // bigint nao sobrevive a serializacao para o client component
        permissions: role.permissions.toString(),
      }))
      // o cargo padrao ("todo mundo") nao vira etiqueta
      .filter((r) => !r.isDefault)
      .sort((a, b) => b.position - a.position),
  };
}

async function calcularRelacao(
  viewerId: string,
  alvoId: string,
): Promise<{ estado: RelacaoComUsuario; friendshipId: string | null }> {
  if (viewerId === alvoId) return { estado: "eu", friendshipId: null };

  const [bloqueio, amizade] = await Promise.all([
    prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: alvoId },
          { blockerId: alvoId, blockedId: viewerId },
        ],
      },
      select: { blockerId: true },
    }),
    prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: viewerId, addresseeId: alvoId },
          { requesterId: alvoId, addresseeId: viewerId },
        ],
      },
      select: { id: true, requesterId: true, status: true },
    }),
  ]);

  if (bloqueio) {
    return {
      estado: bloqueio.blockerId === viewerId ? "bloqueado" : "bloqueou-voce",
      friendshipId: null,
    };
  }
  if (!amizade) return { estado: "nenhuma", friendshipId: null };
  if (amizade.status === "ACCEPTED") {
    return { estado: "amigos", friendshipId: amizade.id };
  }
  return {
    estado:
      amizade.requesterId === viewerId ? "pedido-enviado" : "pedido-recebido",
    friendshipId: amizade.id,
  };
}
