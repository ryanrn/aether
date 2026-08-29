import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ViewerContext } from "@aether/shared";
import { requireMember } from "@/server/guards";
import { getServerContext } from "@/server/services/servers";
import { listActiveBans } from "@/server/services/moderation";
import { listAuditLog } from "@/server/services/audit-log";
import { viewerCan } from "@/lib/permissions";
import { SettingsTabs } from "@/components/server-settings/settings-tabs";

/**
 * Configuracoes do servidor.
 *
 * Rota propria (e nao um modal gigante) por tres motivos: da link direto,
 * separa o bundle do resto do app e e onde o painel administrativo da fase 6
 * vai crescer sem reescrever nada.
 */
export default async function ServerSettingsPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;

  let context;
  try {
    context = await requireMember(serverId);
  } catch (erro) {
    /**
     * O 404 continua, mas o motivo NAO se perde mais.
     *
     * Este catch era vazio, e por isso qualquer falha aqui — sessao expirada,
     * erro do Prisma, coluna nova num cliente velho — virava a mesma tela de
     * "nao existe". Diagnosticar isso a partir de um 404 e impossivel: a tela
     * diz a mesma coisa nos cinco casos.
     *
     * Nao revelar ao VISITANTE continua certo (e a regra do projeto: acesso
     * indevido responde 404, nao 403). Nao registrar para NOS e outra coisa —
     * e foi o que fez perder tempo procurando um defeito de permissao quando o
     * dado estava correto o tempo todo.
     */
    console.error(
      `[settings] requireMember falhou para o servidor ${serverId}:`,
      erro,
    );
    notFound();
  }

  const viewer: ViewerContext = {
    memberId: context.memberId,
    isOwner: context.isOwner,
    permissions: context.permissions.toString(),
    roleIds: context.roleIds,
    highestRolePosition: context.isOwner
      ? Number.MAX_SAFE_INTEGER
      : context.highestRolePosition,
  };

  // sem nenhuma permissao de gestao, esta pagina nao existe para o visitante
  const canManage =
    viewer.isOwner ||
    viewerCan(viewer, "MANAGE_SERVER") ||
    viewerCan(viewer, "MANAGE_ROLES") ||
    // Quem so audita tambem precisa chegar ate aqui: sem isto, ter
    // VIEW_AUDIT_LOG sem gerenciar nada daria 404 na propria pagina.
    viewerCan(viewer, "VIEW_AUDIT_LOG") ||
    viewerCan(viewer, "BAN_MEMBERS");
  if (!canManage) notFound();

  const data = await getServerContext(serverId, context);

  /**
   * Banimentos so sao consultados por quem pode ve-los. Carregar sempre seria
   * uma consulta a mais em toda visita as configuracoes, para uma aba que a
   * maioria nao abre.
   */
  const bans = viewerCan(viewer, "BAN_MEMBERS")
    ? await listActiveBans(serverId)
    : [];

  const audit = viewerCan(viewer, "VIEW_AUDIT_LOG")
    ? await listAuditLog(serverId)
    : { entries: [], hasMore: false };
  if (!data) notFound();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[900px] px-6 py-8">
        <Link
          href={`/app/s/${serverId}`}
          className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink-400 transition-colors hover:text-ink-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para o servidor
        </Link>

        <h1 className="text-lg font-semibold text-ink-100">{data.server.name}</h1>
        <p className="mt-1 text-[13px] text-ink-400">
          Configuracoes, cargos e membros deste servidor.
        </p>

        <div className="mt-6">
          <SettingsTabs
            serverId={serverId}
            serverName={data.server.name}
            serverIconUrl={data.server.iconUrl}
            roles={data.roles}
            members={data.members}
            ownerId={data.server.ownerId}
            viewer={viewer}
            bans={bans}
            audit={audit}
          />
        </div>
      </div>
    </div>
  );
}
