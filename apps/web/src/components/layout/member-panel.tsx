"use client";

import { useState } from "react";
import { Crown, Shield } from "lucide-react";
import type {
  PublicChannel,
  PublicMember,
  PublicRole,
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

/**
 * Painel de membros agrupado por cargo (estilo TeamSpeak/Discord).
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

  return (
    <>
      <aside className="hidden w-[200px] shrink-0 flex-col border-l border-base-800 bg-base-900 lg:flex">
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {[...groups.entries()].map(([name, group]) => (
            <section key={name} className="mb-4">
              <h3
                /*
                  Mesma escala que os cabecalhos de categoria da arvore
                  passaram a usar. Os dois paineis ficam lado a lado, e
                  titulos de tamanhos diferentes nas duas colunas fazem a tela
                  parecer montada por duas pessoas.

                  A COR continua vindo do cargo (`style`), e nao de uma classe:
                  e ela que diz de qual cargo e o grupo, e essa informacao nao
                  pode ser trocada por uma decisao de estilo.
                */
                className="px-1.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.1em]"
                style={{ color: group.color }}
              >
                {name} — {group.members.length}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {group.members.map((member) => {
                  const isOwnerMember = member.user.id === ownerId;
                  const editable =
                    canManageMembers &&
                    !isOwnerMember &&
                    member.id !== viewer.memberId;

                  return (
                    <li key={member.id}>
                      {/*
                        `rounded-md` e mais respiro, como a linha de canal.
                        Este painel e a mesma lista vertical de nomes que a
                        arvore, do outro lado da tela — se um dos dois tem
                        cantos redondos e o outro nao, a diferenca salta.
                      */}
                      <div className="group/member flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-base-850">
                        {/*
                          O nome inteiro abre o cartao de atividade. O cartao
                          sai para a ESQUERDA: este painel encosta na borda
                          direita da janela, e ancorar nela jogaria o cartao
                          para fora da tela — o proprio cartao corrige, mas
                          corrigido ele cobriria o nome que foi clicado.
                        */}
                        <button
                          type="button"
                          onClick={(event) => {
                            const rect =
                              event.currentTarget.getBoundingClientRect();
                            setOpenCard((current) =>
                              current?.member.id === member.id
                                ? null
                                : {
                                    member,
                                    anchor: { x: rect.left - 280, y: rect.top },
                                  },
                            );
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <Avatar
                            userId={member.user.id}
                            name={member.nickname ?? member.user.displayName}
                            src={member.user.avatarUrl}
                            status={presence[member.user.id] ?? "OFFLINE"}
                            size="xs"
                          />
                          {/*
                            A cor do cargo vai no NOME, nunca no fundo do
                            avatar: fundo colorido inteiro compete com tudo na
                            coluna e vira adesivo.
                          */}
                          <span
                            className="min-w-0 flex-1 truncate text-[12px] font-medium"
                            style={{ color: group.color }}
                          >
                            {member.nickname ?? member.user.displayName}
                          </span>
                          {/*
                            O selo vem ANTES da coroa de dono, e como pilula
                            com borda: o simbolo do plano PRO tambem e uma
                            coroa, e dois icones iguais lado a lado nao se
                            distinguem. A pilula separa os dois papeis.
                          */}
                          <SeloPlano
                            tier={member.user.plano}
                            tamanho="sm"
                          />
                        </button>

                        {isOwnerMember ? (
                          <Crown
                            className="h-3 w-3 shrink-0 text-signal-idle"
                            aria-label="Dono do servidor"
                          />
                        ) : null}

                        {editable ? (
                          <button
                            type="button"
                            onClick={() => setEditing(member)}
                            title="Gerenciar cargos"
                            className="shrink-0 rounded-sm p-0.5 text-ink-500 opacity-0 transition-opacity hover:text-ink-100 focus:opacity-100 group-hover/member:opacity-100"
                          >
                            <Shield className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
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
