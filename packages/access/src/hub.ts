import { prisma } from "@aether/db";
import {
  HUB_IDADE_MINIMA_HORAS,
  type MotivoDeRecusaDoHub,
} from "@aether/shared";
import { estaSilenciado } from "./moderacao-global";

/**
 * Hub global "AETHER · Grupos" (fase 2, estagio 4b) — QUEM pode entrar.
 *
 * O hub e um servidor de verdade (`Server.hub`); depois de entrar, quem decide
 * voz, permissao e lotacao e a mesma regra de qualquer servidor
 * (`loadMemberAccess` + `getChannelPermissions`). O que mora aqui e so a PORTA:
 * o servidor comum se entra por convite, o hub se entra por esta regra.
 *
 * Em `@aether/access` pela regra do projeto — permissao num lugar so. Hoje so o
 * web chama; o gateway nao decide entrada no hub.
 */

export interface ContaParaOHub {
  createdAt: Date;
  emailVerificadoEm: Date | null;
  silenciadoEm: Date | null;
  silenciadoAte: Date | null;
  equipe: boolean;
}

/**
 * `null` = pode entrar. Pura, para os testes cobrirem cada recusa sozinha.
 *
 * A ORDEM e a da mensagem mais util primeiro: banido e silenciado sao estados
 * que a pessoa nao resolve sozinha; e-mail e idade, sim.
 *
 * Equipe passa pelos requisitos de conta (idade, e-mail) — quem modera o hub
 * precisa entrar nele —, mas NAO pelo ban: ban e decisao explicita.
 */
export function motivoParaNaoEntrarNoHub(
  conta: ContaParaOHub,
  contexto: { banido: boolean; agora?: Date },
): MotivoDeRecusaDoHub | null {
  if (contexto.banido) return "banido";
  if (estaSilenciado(conta)) return "silenciado";
  if (conta.equipe) return null;
  if (!conta.emailVerificadoEm) return "email_nao_verificado";

  const agora = contexto.agora ?? new Date();
  const idadeMs = agora.getTime() - conta.createdAt.getTime();
  if (idadeMs < HUB_IDADE_MINIMA_HORAS * 3_600_000) return "conta_nova";

  return null;
}

/** O servidor marcado como hub, ou `null` se ninguem foi marcado ainda. */
export async function carregarHub(): Promise<{ id: string } | null> {
  return await prisma.server.findFirst({
    where: { hub: true },
    select: { id: true },
  });
}
