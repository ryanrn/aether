"use client";

import { useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import type {
  PublicChannel,
  PublicMember,
  PublicRole,
  UserStatus,
  ViewerContext,
} from "@aether/shared";
import { Avatar } from "@/components/ui/avatar";
import { SeloPlano } from "@/components/ui/selo-plano";
import { MemberRolesModal } from "@/components/members/member-roles-modal";
import {
  UserActivityCard,
  type CardAnchor,
} from "@/components/profile/user-activity-card";
import { canManageRole, viewerCan } from "@/lib/permissions";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { cn } from "@/lib/utils";

/**
 * Painel de membros.
 *
 * "Na chamada" no topo, depois os grupos por cargo (estilo TeamSpeak). Quem
 * esta em voz aparece nos dois — a lista por cargo continua sendo a identidade
 * do painel, "Na chamada" e um atalho para ver quem esta na conversa agora.
 *
 * A presenca vem do gateway, nao do banco: `user.status` gravado e apenas a
 * preferencia do usuario (ele escolheu DND). Quem esta de fato conectado agora
 * so o socket sabe, entao e o socket que manda no ponto verde.
 */
export function MemberPanel({
  jaRelacionados,
  members,
  roles,
  ownerId,
  serverId,
  serverName,
  voiceChannels,
  viewer,
}: {
  members: PublicMember[];
  /** ids que ja tem amizade, pedido pendente ou bloqueio comigo */
  jaRelacionados: Set<string>;
  roles: PublicRole[];
  ownerId: string;
  serverId: string;
  /** nome do servidor — o cartao de atividade diz onde a pessoa esta */
  serverName: string;
  /** canais de voz, para o cartao resolver o nome do canal ocupado */
  voiceChannels: PublicChannel[];
  viewer: ViewerContext;
}) {
  const [editing, setEditing] = useState<PublicMember | null>(null);
  const [openCard, setOpenCard] = useState<
    { member: PublicMember; anchor: CardAnchor } | null
  >(null);
  // O registro inteiro em vez de um seletor por membro: hook dentro do map
  // quebraria as regras dos hooks, e a referencia so muda quando a presenca muda.
  const presence = useRealtimeStore((state) => state.presence);
  /**
   * Todos os participantes de voz do servidor ABERTO — o mapa `voice` ja e so
   * deste servidor (troca de servidor troca o mapa). Chave = userId.
   */
  const voice = useRealtimeStore((state) => state.voice);
  const canManageMembers = viewerCan(viewer, "MANAGE_ROLES");

  const groups = new Map<string, { color: string; members: PublicMember[] }>();
  for (const member of members) {
    // roles ja vem ordenado por position desc
    const top = member.roles.find((role) => !role.isDefault) ?? member.roles[0];
    const key = top?.name ?? "Membros";
    const group = groups.get(key) ?? { color: top?.color ?? "#6B7280", members: [] };
    group.members.push(member);
    groups.set(key, group);
  }

  /**
   * Membros em voz, na ordem em que aparecem em `members` (ja vem ordenado).
   * Quem fala primeiro nao "sobe" — a lista pular a cada palavra seria ruido.
   */
  const naChamada = members.filter((m) => voice[m.user.id]?.channelId != null);

  function abrirCartao(member: PublicMember, event: React.MouseEvent) {
    const rect = event.currentTarget.getBoundingClientRect();
    setOpenCard((current) =>
      current?.member.id === member.id
        ? null
        : { member, anchor: { x: rect.left - 280, y: rect.top } },
    );
  }

  return (
    <>
      <aside className="hidden w-[200px] shrink-0 flex-col border-l border-line bg-base-900 lg:flex">
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {naChamada.length > 0 ? (
            <section className="mb-4">
              <h3 className="flex items-center gap-1.5 px-1.5 pb-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-accent-300">
                <AetherIcon name="voice" size="sm" className="h-3 w-3" />
                Na chamada — {naChamada.length}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {naChamada.map((member) => (
                  <MemberRow
                    key={`voz-${member.id}`}
                    member={member}
                    color={undefined}
                    isOwner={member.user.id === ownerId}
                    editable={false}
                    presence={presence[member.user.id] ?? "OFFLINE"}
                    voiceState={voice[member.user.id]}
                    onOpenCard={abrirCartao}
                    onEditRoles={() => setEditing(member)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {[...groups.entries()].map(([name, group]) => (
            <section key={name} className="mb-4">
              <h3
                /*
                  Mesma escala que os cabecalhos de categoria da arvore
                  passaram a usar. A COR continua vindo do cargo (`style`).
                */
                className="px-1.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.1em]"
                style={{ color: group.color }}
              >
                {name} — {group.members.length}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {group.members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    color={group.color}
                    isOwner={member.user.id === ownerId}
                    editable={
                      canManageMembers &&
                      member.user.id !== ownerId &&
                      member.id !== viewer.memberId
                    }
                    presence={presence[member.user.id] ?? "OFFLINE"}
                    voiceState={undefined}
                    onOpenCard={abrirCartao}
                    onEditRoles={() => setEditing(member)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </aside>

      {openCard ? (
        <UserActivityCard
          podeAdicionarAmigo={!jaRelacionados.has(openCard.member.user.id)}
          user={openCard.member.user}
          nickname={openCard.member.nickname}
          serverName={serverName}
          voiceChannels={voiceChannels}
          viewer={viewer}
          anchor={openCard.anchor}
          onClose={() => setOpenCard(null)}
        />
      ) : null}

      {editing ? (
        <MemberRolesModal
          serverId={serverId}
          member={editing}
          roles={roles.filter((role) => canManageRole(viewer, role))}
          viewer={viewer}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

/** Uma linha do painel. `voiceState` presente => mostra o icone de estado de voz. */
function MemberRow({
  member,
  color,
  isOwner,
  editable,
  presence,
  voiceState,
  onOpenCard,
  onEditRoles,
}: {
  member: PublicMember;
  /** cor do cargo; `undefined` no grupo "Na chamada" (sem cargo no titulo) */
  color: string | undefined;
  isOwner: boolean;
  editable: boolean;
  presence: UserStatus;
  voiceState:
    | { speaking: boolean; selfMuted: boolean; serverMuted: boolean }
    | undefined;
  onOpenCard: (member: PublicMember, event: React.MouseEvent) => void;
  onEditRoles: () => void;
}) {
  const mudo = voiceState
    ? voiceState.selfMuted || voiceState.serverMuted
    : false;
  const falando = voiceState ? voiceState.speaking && !mudo : false;

  return (
    <li>
      <div className="group/member flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-base-850">
        <button
          type="button"
          onClick={(event) => onOpenCard(member, event)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Avatar
            userId={member.user.id}
            name={member.nickname ?? member.user.displayName}
            src={member.user.avatarUrl}
            moldura={member.user.moldura}
            status={presence}
            size="xs"
            speaking={falando}
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[12px] font-medium",
              !color && (falando ? "text-accent-300" : "text-ink-200"),
              mudo && "text-ink-500",
            )}
            style={color ? { color } : undefined}
          >
            {member.nickname ?? member.user.displayName}
          </span>
          <SeloPlano tier={member.user.plano} tamanho="sm" />
        </button>

        {voiceState ? (
          <span className="shrink-0 text-ink-500">
            {mudo ? (
              <AetherIcon
                name="mic-off"
                size="sm"
                className="h-3 w-3 text-signal-dnd"
                aria-label="Microfone mudo"
              />
            ) : falando ? (
              <AetherIcon
                name="volume"
                size="sm"
                className="h-3 w-3 text-accent-400"
                aria-label="Falando"
              />
            ) : null}
          </span>
        ) : null}

        {isOwner ? (
          <AetherIcon
            name="crown"
            size="sm"
            className="h-3 w-3 shrink-0 text-signal-idle"
            aria-label="Dono do servidor"
          />
        ) : null}

        {editable ? (
          <button
            type="button"
            onClick={onEditRoles}
            title="Gerenciar cargos"
            className="shrink-0 rounded-sm p-0.5 text-ink-500 opacity-0 transition-opacity hover:text-ink-100 focus:opacity-100 group-hover/member:opacity-100"
          >
            <AetherIcon name="shield" size="sm" className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </li>
  );
}
