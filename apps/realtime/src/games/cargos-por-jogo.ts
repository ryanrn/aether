import { prisma } from "@aether/db";
import { normalizarNome } from "@aether/shared";
import { log } from "@aether/shared/log";
import type { AetherServer } from "../types";
import { resyncEavisarServidor } from "../rooms";
import { presenceEntryOf } from "../state";
import { diffDeCargos } from "./diff-de-cargos";

export { diffDeCargos } from "./diff-de-cargos";

/**
 * Cargo automatico por jogo (fase 2, estagio 2).
 *
 * QUEM ATRIBUI E O GATEWAY, e nao o app web, porque "esta jogando X" so existe
 * aqui: vem do `presence:game` do app de desktop e mora no estado em memoria.
 * O web nunca sabe. Entao e daqui que sai a escrita em `MemberRole` quando o
 * jogo abre e fecha — do mesmo jeito que o handler de presenca ja grava
 * `User.status`.
 *
 * SEGURANCA: o clamp de permissao NAO esta aqui, esta no `updateRole` do web
 * (`desired &= PERMISSOES_DE_CARGO_DE_JOGO`). Quando este codigo roda, o cargo
 * ja nasceu sem poder de moderacao. Aqui so decidimos QUEM tem o cargo, nunca
 * O QUE o cargo pode.
 */

/**
 * Deixa os cargos-por-jogo de um usuario num servidor coerentes com o jogo que
 * ele esta com aberto agora (`jogoAtual`, ou `null` se fechou / ficou
 * invisivel / desconectou).
 *
 * Devolve `true` se algum `MemberRole` mudou — ai quem chama re-sincroniza as
 * salas e avisa a interface. No caminho comum devolve `false` depois de UMA
 * consulta indexada: servidor sem nenhum cargo vinculado a jogo nao paga mais
 * do que isso por troca de jogo.
 *
 * Com o recurso DESLIGADO no servidor (`cargoPorJogo` = false) o alvo e vazio:
 * a funcao vira uma limpeza (tira cargo-de-jogo que tenha sobrado) e nada mais.
 */
export async function sincronizarCargoPorJogo(
  userId: string,
  serverId: string,
  jogoAtual: string | null,
): Promise<boolean> {
  const cargosDeJogo = await prisma.role.findMany({
    where: { serverId, jogoNormalizado: { not: null } },
    select: { id: true, jogoNormalizado: true },
  });
  if (cargosDeJogo.length === 0) return false;

  const [membro, server] = await Promise.all([
    prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
      select: { id: true },
    }),
    prisma.server.findUnique({
      where: { id: serverId },
      select: { cargoPorJogo: true },
    }),
  ]);
  // Corrida rara: saiu do servidor entre o anuncio e esta consulta.
  if (!membro) return false;

  const jogoNorm =
    server?.cargoPorJogo && jogoAtual ? normalizarNome(jogoAtual) : null;

  const idsDeJogo = cargosDeJogo.map((c) => c.id);
  const alvo = jogoNorm
    ? cargosDeJogo.filter((c) => c.jogoNormalizado === jogoNorm).map((c) => c.id)
    : [];

  const atuais = (
    await prisma.memberRole.findMany({
      where: { memberId: membro.id, roleId: { in: idsDeJogo } },
      select: { roleId: true },
    })
  ).map((m) => m.roleId);

  const { aAdicionar, aRemover } = diffDeCargos(atuais, alvo);
  if (aAdicionar.length === 0 && aRemover.length === 0) return false;

  if (aRemover.length > 0) {
    await prisma.memberRole.deleteMany({
      where: { memberId: membro.id, roleId: { in: aRemover } },
    });
  }
  if (aAdicionar.length > 0) {
    await prisma.memberRole.createMany({
      data: aAdicionar.map((roleId) => ({ memberId: membro.id, roleId })),
      skipDuplicates: true,
    });
  }

  log.info("gateway.cargo_por_jogo", "cargo por jogo sincronizado", {
    userId,
    serverId,
    jogo: jogoNorm,
    adicionou: aAdicionar.length,
    removeu: aRemover.length,
  });
  return true;
}

/**
 * Limpa cargo-por-jogo obsoleto quando o usuario conecta.
 *
 * O "esta jogando" vive so na memoria do gateway. Se ele reinicia, o
 * `MemberRole` fica no banco mas ninguem esta mais jogando pelo ponto de vista
 * do gateway — ate o app de desktop reenviar `presence:game` (segundos, mas so
 * se estiver com um jogo aberto). Sem esta limpeza, quem estava jogando na
 * hora do restart carregaria o cargo indefinidamente.
 *
 * So age quando NAO ha jogo no estado (conexao nova, ou a pessoa nao esta
 * jogando). Se ha — outra aba ja anunciou —, o proprio `presence:game` mantem
 * tudo certo e nao ha o que limpar. Restrito aos servidores que tem cargo
 * vinculado a jogo, para nao varrer o banco de quem nao usa o recurso.
 */
export async function limparCargosDeJogoNaConexao(
  io: AetherServer,
  userId: string,
): Promise<void> {
  if ((await presenceEntryOf(userId))?.game) return;

  const membros = await prisma.serverMember.findMany({
    where: {
      userId,
      server: { roles: { some: { jogoNormalizado: { not: null } } } },
    },
    select: { serverId: true },
  });

  for (const { serverId } of membros) {
    try {
      if (await sincronizarCargoPorJogo(userId, serverId, null)) {
        await resyncEavisarServidor(io, serverId);
      }
    } catch (erro) {
      log.warn(
        "gateway.cargo_por_jogo.limpeza_falhou",
        "não limpei cargo por jogo obsoleto",
        { err: erro, userId, serverId },
      );
    }
  }
}
