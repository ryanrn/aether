"use client";

import { useEffect, useState } from "react";
import { preCarregarPerfil } from "@/lib/perfil-cache";
import { AetherIcon } from "@/components/ui/aether-icon";
import {
  corDoCargoPrincipal,
  type PublicChannel,
  type PublicMember,
  type PublicRole,
  type UserStatus,
  type ViewerContext,
} from "@aether/shared";
import { FundoDePlaca } from "@/components/profile/cosmeticos-de-perfil";
import { Avatar } from "@/components/ui/avatar";
import { SeloPlano } from "@/components/ui/selo-plano";
import { SeloBot } from "@/components/ui/selo-bot";
import { MemberRolesModal } from "@/components/members/member-roles-modal";
import {
  UserActivityCard,
  type CardAnchor,
} from "@/components/profile/user-activity-card";
import { normalizarNome } from "@aether/shared";
import { canManageRole, viewerCan } from "@/lib/permissions";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { cn } from "@/lib/utils";
import { SalasDeGrupoDoJogo } from "./salas-de-grupo-do-jogo";

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
  salasDeGrupo,
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
  /** salas de grupo (LFG) ligadas no servidor — fase 2, estagio 3 */
  salasDeGrupo: boolean;
}) {
  const [editing, setEditing] = useState<PublicMember | null>(null);
  const [openCard, setOpenCard] = useState<{
    member: PublicMember;
    anchor: CardAnchor;
  } | null>(null);
  // O registro inteiro em vez de um seletor por membro: hook dentro do map
  // quebraria as regras dos hooks, e a referencia so muda quando a presenca muda.
  const presence = useRealtimeStore((state) => state.presence);
  const definirCoresDeMembro = useRealtimeStore(
    (state) => state.definirCoresDeMembro,
  );
  /**
   * O chat mostra o nome do autor na cor do cargo dele — antes so aparecia
   * aqui, na lateral. Este painel e quem ja recebe `members`+`roles` do
   * servidor ABERTO (o SSR ja fez essa consulta para desenhar a lista abaixo);
   * em vez do chat pedir a MESMA coisa de novo, ele so LE o mapa que este
   * efeito guarda no store. Roda de novo sempre que o servidor muda de
   * membro/cargo (troca de servidor, cargo editado, etc. re-renderizam a
   * pagina com `members` novo).
   */
  useEffect(() => {
    const cores: Record<string, string> = {};
    for (const member of members) {
      cores[member.user.id] = corDoCargoPrincipal(member.roles);
    }
    definirCoresDeMembro(cores);
  }, [members, definirCoresDeMembro]);
  /**
   * Todos os participantes de voz do servidor ABERTO — o mapa `voice` ja e so
   * deste servidor (troca de servidor troca o mapa). Chave = userId.
   */
  const voice = useRealtimeStore((state) => state.voice);
  /** Jogo por usuario (fase 2): `activity[userId] = { game, since, icon, cover }`. */
  const activity = useRealtimeStore((state) => state.activity);
  const canManageMembers = viewerCan(viewer, "MANAGE_ROLES");

  /**
   * "Jogando agora" — corte transversal: agrupa quem esta ONLINE e num jogo
   * pelo nome do jogo. A pessoa continua aparecendo no grupo do cargo dela
   * embaixo; isto e o atalho para "quem topa jogar X junto".
   *
   * A ordem dentro de cada grupo segue `members` (ja ordenado), e os grupos
   * saem do maior para o menor — o jogo com mais gente primeiro.
   */
  const porJogo = new Map<
    string,
    { icon: string | null; cover: string | null; members: PublicMember[] }
  >();
  for (const member of members) {
    if ((presence[member.user.id] ?? "OFFLINE") === "OFFLINE") continue;
    const act = activity[member.user.id];
    if (!act?.game) continue;
    const grupo = porJogo.get(act.game) ?? {
      icon: act.icon,
      cover: act.cover,
      members: [],
    };
    // capa/icone: a primeira nao-nula que aparecer serve para o grupo todo
    grupo.cover ??= act.cover;
    grupo.icon ??= act.icon;
    grupo.members.push(member);
    porJogo.set(act.game, grupo);
  }
  /**
   * Uma sala de grupo aberta tambem faz o jogo aparecer aqui, mesmo que
   * ninguem no painel esteja com o status "jogando" — a sala foi criada com o
   * nome exato do jogo, entao a chave casa.
   */
  for (const canal of voiceChannels) {
    if (!canal.isTemporary || !canal.jogo) continue;
    if (!porJogo.has(canal.jogo)) {
      porJogo.set(canal.jogo, { icon: null, cover: null, members: [] });
    }
  }
  const jogos = [...porJogo.entries()].sort(
    (a, b) => b[1].members.length - a[1].members.length,
  );

  /** Meu userId e o jogo que EU estou jogando — para "Criar sala". */
  const meuUserId =
    members.find((m) => m.id === viewer.memberId)?.user.id ?? null;
  const meuJogo = meuUserId ? (activity[meuUserId]?.game ?? null) : null;
  const jaTenhoSala = voiceChannels.some(
    (c) => c.isTemporary && c.criadaPor != null && c.criadaPor === meuUserId,
  );

  const groups = new Map<string, { color: string; members: PublicMember[] }>();
  for (const member of members) {
    // roles ja vem ordenado por position desc
    const top = member.roles.find((role) => !role.isDefault) ?? member.roles[0];
    const key = top?.name ?? "Membros";
    const group = groups.get(key) ?? {
      color: corDoCargoPrincipal(member.roles),
      members: [],
    };
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
      <aside className="hidden w-[224px] shrink-0 flex-col border-l border-line bg-base-900 lg:flex">
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {jogos.length > 0 ? (
            <section className="mb-4">
              <h3 className="flex items-center gap-1.5 px-1.5 pb-1.5 font-mono text-[12px] font-bold uppercase tracking-[0.08em] text-ink-400">
                <AetherIcon name="gamepad" size="sm" className="h-3.5 w-3.5" />
                Jogando agora
              </h3>
              {/*
                Tira COMPACTA, de proposito: nao repete a lista de membros (que
                ja aparece nos grupos por cargo abaixo). Capa + nome + contagem +
                os avatares, so pra bater o olho em "quem topa jogar X". Clicar
                num avatar abre o cartao da pessoa.
              */}
              <div className="flex flex-col gap-1">
                {jogos.map(([game, grupo]) => (
                  <div
                    key={game}
                    className="rounded-md px-1.5 py-1.5 transition-colors hover:bg-base-850/40"
                  >
                    <div className="flex items-center gap-2">
                      {grupo.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={grupo.cover}
                          alt=""
                          className="h-6 w-[18px] shrink-0 rounded-[3px] object-cover"
                        />
                      ) : grupo.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={grupo.icon}
                          alt=""
                          className="h-4 w-4 shrink-0 rounded-[3px] object-cover"
                        />
                      ) : (
                        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] bg-base-750 text-ink-500">
                          <AetherIcon
                            name="gamepad"
                            size="sm"
                            className="h-2.5 w-2.5"
                          />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-200">
                        {game}
                      </span>
                      {grupo.members.length > 0 ? (
                        <span className="font-mono text-[11px] tabular-nums text-ink-500">
                          {grupo.members.length}
                        </span>
                      ) : null}
                    </div>

                    {grupo.members.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1 pl-0.5">
                        {grupo.members.slice(0, 8).map((member) => (
                          <button
                            key={member.id}
                            type="button"
                            title={member.nickname ?? member.user.displayName}
                            onClick={(event) => abrirCartao(member, event)}
                            onPointerEnter={() => preCarregarPerfil(member.user.id)}
                            className="rounded-full transition-transform hover:scale-110"
                          >
                            <Avatar
                              userId={member.user.id}
                              name={member.user.displayName}
                              src={member.user.avatarUrl}
                              status={presence[member.user.id] ?? "OFFLINE"}
                              size="xs"
                              round
                              speaking={
                                Boolean(voice[member.user.id]?.speaking) &&
                                !voice[member.user.id]?.selfMuted
                              }
                            />
                          </button>
                        ))}
                        {grupo.members.length > 8 ? (
                          <span className="self-center text-[10px] text-ink-500">
                            +{grupo.members.length - 8}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    <SalasDeGrupoDoJogo
                      serverId={serverId}
                      jogo={game}
                      canaisDeVoz={voiceChannels}
                      podeCriar={
                        salasDeGrupo &&
                        meuJogo != null &&
                        normalizarNome(meuJogo) === normalizarNome(game)
                      }
                      jaTenhoSala={jaTenhoSala}
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {naChamada.length > 0 ? (
            <section className="mb-4">
              <h3 className="flex items-center gap-1.5 px-1.5 pb-1.5 font-mono text-[12px] font-bold uppercase tracking-[0.08em] text-accent-300">
                <AetherIcon name="voice" size="sm" className="h-3.5 w-3.5" />
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
                className="px-1.5 pb-1.5 text-[12px] font-bold uppercase tracking-[0.08em]"
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
    | {
        speaking: boolean;
        selfMuted: boolean;
        serverMuted: boolean;
        streaming: boolean;
      }
    | undefined;
  onOpenCard: (member: PublicMember, event: React.MouseEvent) => void;
  onEditRoles: () => void;
}) {
  const mudo = voiceState
    ? voiceState.selfMuted || voiceState.serverMuted
    : false;
  const falando = voiceState ? voiceState.speaking && !mudo : false;
  const transmitindo = voiceState?.streaming ?? false;

  return (
    <li>
      <div
        className={cn(
          "group/member flex items-center gap-2.5 rounded-md px-2 py-[7px] transition-colors hover:bg-base-850",
          member.user.placa && "relative isolate overflow-hidden",
        )}
      >
        {member.user.placa ? <FundoDePlaca url={member.user.placa} /> : null}
        <button
          type="button"
          onClick={(event) => onOpenCard(member, event)}
          onPointerEnter={() => preCarregarPerfil(member.user.id)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <Avatar
            userId={member.user.id}
            name={member.nickname ?? member.user.displayName}
            src={member.user.avatarUrl}
            moldura={member.user.moldura}
            status={presence}
            size="sm"
            speaking={falando}
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] font-medium",
              !color && (falando ? "text-accent-300" : "text-ink-200"),
              mudo && "text-ink-500",
            )}
            style={color ? { color } : undefined}
          >
            {member.nickname ?? member.user.displayName}
          </span>
          <SeloBot kind={member.user.kind} />
          <SeloPlano tier={member.user.plano} tamanho="sm" />
        </button>

        {voiceState ? (
          <span className="flex shrink-0 items-center gap-1 text-ink-500">
            {transmitindo ? (
              <AetherIcon
                name="screen-share"
                size="sm"
                className="h-3 w-3 text-signal-live"
                aria-label="Compartilhando tela"
              />
            ) : null}
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
