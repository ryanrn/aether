"use client";

import { useMemo, useState, useTransition } from "react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  FolderPlus,
  Hash,
  Link2,
  Lock,
  Pencil,
  Plus,
  Settings,
  Trash2,
  Volume2,
} from "lucide-react";
import type {
  ChannelPermissionMap,
  PublicCategory,
  PublicChannel,
  PublicRole,
  ViewerContext,
} from "@aether/shared";
import {
  deleteCategoryAction,
  deleteChannelAction,
  moveChannelAction,
} from "@/server/actions/channels";
import { channelAllows, viewerCan } from "@/lib/permissions";
import {
  ContextMenu,
  ItemDoMenu,
  SeparadorDoMenu,
  useMenuDeContexto,
} from "@/components/ui/context-menu";
import { useEntrarNaVoz } from "@/lib/voice/use-entrar-na-voz";
import {
  useUnreadCounts,
  useVoiceParticipants,
} from "@/lib/stores/realtime-store";
import { cn } from "@/lib/utils";
import { ChannelMembers } from "./channel-members";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { reorderChannelAction } from "@/server/actions/channels";
import { ChannelFormModal } from "@/components/channels/channel-form-modal";
import { CategoryFormModal } from "@/components/channels/category-form-modal";
import { InviteButton } from "@/components/servers/invite-button";

/**
 * Arvore de canais no estilo TeamSpeak: categorias colapsaveis e, abaixo de
 * cada canal de voz, quem esta conectado.
 *
 * Os canais que chegam aqui JA passaram pelo filtro de visibilidade do
 * servidor — a sidebar nunca recebe um canal privado que o usuario nao pode
 * ver. Os controles de edicao aparecem conforme a permissao, mas quem decide
 * de fato e a action.
 */
export function ChannelSidebar({
  serverId,
  serverName,
  categories,
  looseChannels,
  roles,
  viewer,
  channelPermissions,
}: {
  serverId: string;
  /** nome do servidor — o cartao de atividade diz onde a pessoa esta */
  serverName: string;
  categories: PublicCategory[];
  looseChannels: PublicChannel[];
  roles: PublicRole[];
  viewer: ViewerContext;
  channelPermissions: ChannelPermissionMap;
}) {
  const params = useParams<{ channelId?: string }>();
  const activeChannelId = params?.channelId;
  /**
   * "Soltos" tambem e um container, e precisa de um id proprio: `null` nao
   * serve como chave de `Map` nem como id de area soltavel.
   */
  const SOLTOS = "__soltos__";

  /** De qual container e cada canal — para saber o destino ao soltar. */
  const containerDoCanal = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const canal of looseChannels) mapa.set(canal.id, SOLTOS);
    for (const categoria of categories) {
      for (const canal of categoria.channels) mapa.set(canal.id, categoria.id);
    }
    return mapa;
  }, [looseChannels, categories]);

  const sensores = useSensors(
    // 6px separa "cliquei no canal" de "puxei o canal". Sem isso o clique
    // deixa de navegar.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function aoSoltarCanal(evento: DragEndEvent) {
    const { active, over } = evento;
    if (!over) return;

    const canalId = String(active.id);
    const alvoId = String(over.id);
    if (canalId === alvoId) return;

    /**
     * Soltar SOBRE outro canal usa o container dele; soltar sobre a area vazia
     * de uma categoria usa o id `cat:<id>`. O segundo caso e o unico jeito de
     * mover para uma categoria que ainda nao tem nada.
     */
    const destino = alvoId.startsWith("cat:")
      ? alvoId.slice(4)
      : (containerDoCanal.get(alvoId) ?? SOLTOS);

    const irmaos = destino === SOLTOS
      ? looseChannels
      : (categories.find((c) => c.id === destino)?.channels ?? []);

    const indiceAlvo = irmaos.findIndex((c) => c.id === alvoId);
    // Sobre a area vazia: vai para o fim.
    const indice = indiceAlvo === -1 ? irmaos.length : indiceAlvo;

    void reorderChannelAction(
      serverId,
      canalId,
      destino === SOLTOS ? null : destino,
      indice,
    );
  }

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [channelModal, setChannelModal] = useState<
    { mode: "create"; categoryId: string | null } | { mode: "edit"; channelId: string } | null
  >(null);
  const [categoryModal, setCategoryModal] = useState<
    { mode: "create" } | { mode: "edit"; categoryId: string; name: string } | null
  >(null);

  const canCreate = viewerCan(viewer, "CREATE_CHANNEL");
  const canInvite = viewerCan(viewer, "CREATE_INVITE");
  /** Mesma regra que a barra de topo usava antes de ser dissolvida. */
  const canManageServer =
    viewerCan(viewer, "MANAGE_SERVER") ||
    viewerCan(viewer, "MANAGE_ROLES") ||
    viewer.isOwner;

  /**
   * Destinos do "mover para": todos os canais de voz que ESTE visitante
   * enxerga. Quem move nao pode mandar alguem para um canal que ele proprio
   * nao conhece, e o gateway ainda revalida o acesso de quem e movido.
   */
  const voiceChannels = [
    ...looseChannels,
    ...categories.flatMap((category) => category.channels),
  ].filter((channel) => channel.type === "VOICE");

  function toggle(categoryId: string) {
    setCollapsed((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));
  }

  return (
    <>
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-base-800 bg-base-900">
        {/*
          Cabecalho proprio, de 48px. Antes o nome do servidor vivia numa barra
          que atravessava a tela inteira por cima das quatro colunas; agora cada
          coluna comeca no topo e tem o seu. E o que permite a HUD flutuar
          dentro do centro, em vez de existir um rodape global.
        */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-base-800 px-4">
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-bold uppercase tracking-[0.04em] text-ink-100">
            {serverName}
          </h2>
          {/*
            "Convidar" mora AQUI, e nao no cabecalho do palco como no desenho.
            Motivo: o cabecalho do palco so existe com um canal aberto, e
            convidar e acao de SERVIDOR — na tela "selecione um canal" o botao
            simplesmente sumiria. Coluna do servidor, acao do servidor.
          */}
          {canInvite ? <InviteButton serverId={serverId} compact /> : null}
          {canManageServer ? (
            <Link
              href={`/app/s/${serverId}/settings`}
              title="Configuracoes do servidor"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-base-800 hover:text-ink-100"
            >
              <Settings className="h-4 w-4" />
            </Link>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {/*
            UM contexto para a arvore inteira, e nao um por categoria: arrastar
            ENTRE categorias so funciona se as duas pontas viverem no mesmo
            `DndContext`.
          */}
          <DndContext
            sensors={sensores}
            collisionDetection={closestCenter}
            onDragEnd={aoSoltarCanal}
          >
          {looseChannels.length > 0 ? (
            <ListaSoltavel id={SOLTOS} itens={looseChannels.map((c) => c.id)} className="mb-3 flex flex-col gap-0.5">
              {looseChannels.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  serverId={serverId}
                  serverName={serverName}
                  channel={channel}
                  active={channel.id === activeChannelId}
                  channelPermissions={channelPermissions}
                  viewer={viewer}
                  voiceChannels={voiceChannels}
                  onEdit={() => setChannelModal({ mode: "edit", channelId: channel.id })}
                />
              ))}
            </ListaSoltavel>
          ) : null}

          {categories.map((category) => {
            const isCollapsed = collapsed[category.id] ?? false;
            return (
              <section key={category.id} className="mb-3">
                <div className="group flex items-center gap-0.5 px-1.5">
                  <button
                    type="button"
                    onClick={() => toggle(category.id)}
                    className="flex flex-1 items-center gap-1 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500 transition-colors hover:text-ink-300"
                  >
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 transition-transform duration-200",
                        isCollapsed && "-rotate-90",
                      )}
                    />
                    <span className="truncate">{category.name}</span>
                  </button>

                  {canCreate ? (
                    <div className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <IconAction
                        label="Renomear categoria"
                        onClick={() =>
                          setCategoryModal({
                            mode: "edit",
                            categoryId: category.id,
                            name: category.name,
                          })
                        }
                      >
                        <Pencil className="h-3 w-3" />
                      </IconAction>
                      <DeleteCategoryButton
                        serverId={serverId}
                        categoryId={category.id}
                        name={category.name}
                      />
                      <IconAction
                        label="Criar canal nesta categoria"
                        onClick={() =>
                          setChannelModal({ mode: "create", categoryId: category.id })
                        }
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </IconAction>
                    </div>
                  ) : null}
                </div>

                {!isCollapsed ? (
                  <ListaSoltavel
                    id={`cat:${category.id}`}
                    itens={category.channels.map((c) => c.id)}
                    className="mt-0.5 flex flex-col gap-0.5"
                  >
                    {category.channels.map((channel) => (
                      <ChannelRow
                        key={channel.id}
                        serverId={serverId}
                        serverName={serverName}
                        channel={channel}
                        active={channel.id === activeChannelId}
                        channelPermissions={channelPermissions}
                  viewer={viewer}
                  voiceChannels={voiceChannels}
                        onEdit={() =>
                          setChannelModal({ mode: "edit", channelId: channel.id })
                        }
                      />
                    ))}
                    {category.channels.length === 0 ? (
                      <li className="px-2 py-1 text-[12px] text-ink-500">
                        Sem canais visiveis
                      </li>
                    ) : null}
                  </ListaSoltavel>
                ) : null}
              </section>
            );
          })}
          </DndContext>

          {canCreate ? (
            <div className="mt-1 flex flex-col gap-1 px-1">
              <button
                type="button"
                onClick={() => setChannelModal({ mode: "create", categoryId: null })}
                className="flex items-center gap-2 rounded-sm px-1.5 py-1.5 text-[12px] text-ink-500 transition-colors hover:bg-base-850 hover:text-ink-200"
              >
                <Plus className="h-3.5 w-3.5" />
                Novo canal
              </button>
              <button
                type="button"
                onClick={() => setCategoryModal({ mode: "create" })}
                className="flex items-center gap-2 rounded-sm px-1.5 py-1.5 text-[12px] text-ink-500 transition-colors hover:bg-base-850 hover:text-ink-200"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                Nova categoria
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      {channelModal ? (
        <ChannelFormModal
          serverId={serverId}
          categories={categories}
          roles={roles}
          state={channelModal}
          onClose={() => setChannelModal(null)}
        />
      ) : null}

      {categoryModal ? (
        <CategoryFormModal
          serverId={serverId}
          state={categoryModal}
          onClose={() => setCategoryModal(null)}
        />
      ) : null}
    </>
  );
}

function IconAction({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "rounded-sm p-1 text-ink-500 transition-colors hover:bg-base-750",
        danger ? "hover:text-signal-dnd" : "hover:text-ink-100",
      )}
    >
      {children}
    </button>
  );
}

function DeleteCategoryButton({
  serverId,
  categoryId,
  name,
}: {
  serverId: string;
  categoryId: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();

  const [confirmando, setConfirmando] = useState(false);

  return (
    <>
      <IconAction
        danger
        label={`Excluir categoria ${name}`}
        onClick={() => {
          if (pending) return;
          setConfirmando(true);
        }}
      >
        <Trash2 className="h-3 w-3" />
      </IconAction>

      <ConfirmDialog
        open={confirmando}
        onClose={() => setConfirmando(false)}
        title="Excluir categoria"
        confirmLabel="Excluir categoria"
        pending={pending}
        onConfirm={() => {
          startTransition(async () => {
            await deleteCategoryAction(serverId, categoryId);
            setConfirmando(false);
          });
        }}
      >
        Tem certeza de que deseja excluir <strong className="text-ink-100">{name}</strong>?
        Os canais dentro dela viram canais soltos — eles NAO sao apagados.
      </ConfirmDialog>
    </>
  );
}

function ChannelRow({
  serverId,
  serverName,
  channel,
  active,
  channelPermissions,
  viewer,
  voiceChannels,
  onEdit,
}: {
  serverId: string;
  serverName: string;
  channel: PublicChannel;
  active: boolean;
  channelPermissions: ChannelPermissionMap;
  viewer: ViewerContext;
  /** destinos possiveis do "mover para" */
  voiceChannels: PublicChannel[];
  onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  // Quem esta na call vem do gateway: e ele que sabe, nao o banco.
  const connected = useVoiceParticipants(channel.id);
  const unread = useUnreadCounts()[channel.id] ?? 0;
  const Icon = channel.isPrivate ? Lock : channel.type === "VOICE" ? Volume2 : Hash;

  const canEdit = channelAllows(channelPermissions, channel.id, "EDIT_CHANNEL");
  const canDelete = channelAllows(channelPermissions, channel.id, "DELETE_CHANNEL");

  /**
   * Menu de clique direito do canal.
   *
   * Ele NAO tem acoes proprias: chama exatamente o que os botoes de passar o
   * mouse ja chamam, e obedece as mesmas `canEdit` / `canDelete`. Uma segunda
   * lista de acoes aqui seria uma segunda regra de permissao — e a que
   * ficasse para tras viraria falha de autorizacao, nao defeito de tela.
   *
   * O ganho e de alcance: os icones so aparecem no hover e sao pequenos, e
   * este e o mesmo motivo pelo qual os tres pontinhos do card de voz sairam.
   */
  const menu = useMenuDeContexto();

  const { entrar } = useEntrarNaVoz();

  /**
   * SO quem pode editar arrasta.
   *
   * `disabled` em vez de nao chamar o hook: hook condicional quebraria a regra
   * assim que a permissao mudasse no meio da sessao — e ela muda, porque cargo
   * editado ja recalcula a arvore de quem esta conectado.
   *
   * Sem isto, um membro comum arrastaria o canal, veria ele se mover, e a
   * action seria recusada no servidor — a tela voltaria atras sozinha, o que
   * parece defeito e nao "voce nao pode".
   */
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: channel.id, disabled: !canEdit });
  const podeConectar = channelAllows(channelPermissions, channel.id, "CONNECT");

  /**
   * Clicar no canal de voz JA CONECTA — nao ha mais o passo de abrir e clicar
   * em "Conectar". E o que se espera de um app de voz.
   *
   * A navegacao continua acontecendo: o link nao e cancelado. Entrar e abrir
   * sao coisas diferentes, e quem clica quer as duas — ver quem esta la e
   * estar la.
   *
   * NAO conecta quando o cargo nao permite: o gateway recusaria de qualquer
   * jeito, e a tela do canal explica o motivo. Tentar e falhar em silencio
   * seria pior do que so abrir.
   *
   * E nao desconecta ao clicar de novo no canal em que voce ja esta — disso
   * cuida o proprio `entrar`. Sair e uma acao deliberada; clique repetido
   * costuma ser engano ou navegacao.
   */
  function aoClicarNoCanal() {
    if (channel.type !== "VOICE" || !podeConectar) return;
    entrar(channel.id);
  }

  return (
    <li
      /**
       * `setNodeRef` E O TRANSFORM NO MESMO ELEMENTO.
       *
       * A primeira versao registrava o `<Link>` como no medido e movia o
       * `<li>`. Isso cria um laco: mover o pai desloca o filho medido, a
       * medicao muda, o dnd-kit recalcula o transform, e move de novo — na
       * tela, o canal TREME enquanto se arrasta.
       *
       * Quem mede e quem se move tem de ser o mesmo no. A alca de arrasto e
       * outra coisa, e para ela existe `setActivatorNodeRef`.
       */
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined,
      }}
      className="group/channel"
    >
      <div
        onContextMenu={menu.abrir}
        className={cn(
          "flex items-center rounded-sm transition-colors duration-100",
          active ? "bg-base-750" : "hover:bg-base-850",
        )}
      >
        <Link
          /**
           * Alca de arrasto: e daqui que o gesto comeca, e nao dos botoes de
           * mover/editar/excluir ao lado — que continuam clicaveis.
           */
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          href={`/app/s/${serverId}/c/${channel.id}`}
          onClick={aoClicarNoCanal}
          /**
           * NAO ARRASTA.
           *
           * Todo `<a href>` tem arraste NATIVO do navegador: segurar e puxar
           * cria um fantasma com a URL inteira e um cursor de "proibido". Quem
           * tenta reordenar o canal — reflexo de quem usa Discord — ve o
           * endereco do site aparecer atravessado na tela, o que parece defeito
           * e nao "esse recurso nao existe".
           *
           * Isto SO tira o fantasma; nao adiciona reordenar por arrasto. A
           * ordem se muda pelas setas ao lado do canal.
           */
          draggable={false}

          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[13px]",
            active ? "text-ink-100" : "text-ink-300 hover:text-ink-100",
          )}
        >
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              channel.isPrivate ? "text-signal-idle" : "text-ink-500",
              active && !channel.isPrivate && "text-accent-500",
            )}
          />
          <span className={cn("truncate", unread > 0 && "font-semibold text-ink-100")}>
            {channel.name}
          </span>
          {channel.isTemporary ? (
            <span
              className="ml-1 shrink-0 rounded-[3px] border border-base-600 px-1 font-mono text-[9px] uppercase text-ink-500"
              title="Canal temporario: some quando esvazia (fase 3)"
            >
              tmp
            </span>
          ) : null}
          {unread > 0 ? (
            <span
              title={`${unread} mensagem${unread > 1 ? "ns" : ""} nao lida${unread > 1 ? "s" : ""}`}
              className="ml-auto shrink-0 rounded-full bg-accent-600 px-1.5 py-px font-mono text-[10px] font-semibold leading-4 text-base-950"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}

          {channel.type === "VOICE" && connected.length > 0 ? (
            <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-500">
              {connected.length}
              {channel.userLimit ? `/${channel.userLimit}` : ""}
            </span>
          ) : null}
        </Link>

        {canEdit || canDelete ? (
          <div className="flex shrink-0 pr-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/channel:opacity-100">
            {canEdit ? (
              <>
                <IconAction
                  label="Mover para cima"
                  onClick={() =>
                    !pending &&
                    startTransition(async () => {
                      await moveChannelAction(serverId, channel.id, "up");
                    })
                  }
                >
                  <ChevronUp className="h-3 w-3" />
                </IconAction>
                <IconAction
                  label="Mover para baixo"
                  onClick={() =>
                    !pending &&
                    startTransition(async () => {
                      await moveChannelAction(serverId, channel.id, "down");
                    })
                  }
                >
                  <ChevronDown className="h-3 w-3" />
                </IconAction>
                <IconAction label="Editar canal" onClick={onEdit}>
                  <Pencil className="h-3 w-3" />
                </IconAction>
              </>
            ) : null}
            {canDelete ? (
              <IconAction
                danger
                label="Excluir canal"
                onClick={() => {
                  if (pending) return;
                  setConfirmandoExclusao(true);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </IconAction>
            ) : null}
          </div>
        ) : null}
      </div>

      {channel.type === "VOICE" && connected.length > 0 ? (
        <ChannelMembers
          states={connected}
          viewer={viewer}
          serverName={serverName}
          voiceChannels={voiceChannels}
        />
      ) : null}

      <ContextMenu ponto={menu.ponto} onClose={menu.fechar} titulo={channel.name}>
        {/*
          Copiar o link vem primeiro e aparece para todo mundo: e a unica coisa
          do menu que nao depende de cargo, e a mais pedida.
        */}
        <ItemDoMenu
          icone={<Link2 className="h-3.5 w-3.5" />}
          onClick={() => {
            void navigator.clipboard.writeText(
              `${window.location.origin}/app/s/${serverId}/c/${channel.id}`,
            );
            menu.fechar();
          }}
        >
          Copiar link
        </ItemDoMenu>

        {canEdit ? (
          <>
            <SeparadorDoMenu />
            <ItemDoMenu
              icone={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => {
                menu.fechar();
                onEdit();
              }}
            >
              Editar canal
            </ItemDoMenu>
            <ItemDoMenu
              icone={<ChevronUp className="h-3.5 w-3.5" />}
              disabled={pending}
              onClick={() => {
                menu.fechar();
                startTransition(async () => {
                  await moveChannelAction(serverId, channel.id, "up");
                });
              }}
            >
              Mover para cima
            </ItemDoMenu>
            <ItemDoMenu
              icone={<ChevronDown className="h-3.5 w-3.5" />}
              disabled={pending}
              onClick={() => {
                menu.fechar();
                startTransition(async () => {
                  await moveChannelAction(serverId, channel.id, "down");
                });
              }}
            >
              Mover para baixo
            </ItemDoMenu>
          </>
        ) : null}

        {canDelete ? (
          <>
            <SeparadorDoMenu />
            <ItemDoMenu
              danger
              icone={<Trash2 className="h-3.5 w-3.5" />}
              disabled={pending}
              onClick={() => {
                menu.fechar();
                setConfirmandoExclusao(true);
              }}
            >
              Excluir canal
            </ItemDoMenu>
          </>
        ) : null}
      </ContextMenu>

      <ConfirmDialog
        open={confirmandoExclusao}
        onClose={() => setConfirmandoExclusao(false)}
        title="Excluir canal"
        confirmLabel="Excluir canal"
        pending={pending}
        onConfirm={() => {
          startTransition(async () => {
            await deleteChannelAction(serverId, channel.id);
            setConfirmandoExclusao(false);
          });
        }}
      >
        Tem certeza de que deseja excluir{" "}
        <strong className="text-ink-100">{channel.name}</strong>? Esta acao nao
        podera ser desfeita — as mensagens do canal vao junto.
      </ConfirmDialog>
    </li>
  );
}

/**
 * Uma lista de canais que aceita soltar dentro.
 *
 * O `useDroppable` existe para a categoria VAZIA: sem uma area soltavel
 * propria, nao haveria sobre o que soltar ali, e mover um canal para uma
 * categoria sem canais seria impossivel — justamente o caso em que arrastar e
 * mais util que as setas.
 */
function ListaSoltavel({
  id,
  itens,
  className,
  children,
}: {
  id: string;
  itens: string[];
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <SortableContext items={itens} strategy={verticalListSortingStrategy}>
      <ul
        ref={setNodeRef}
        className={cn(
          className,
          // Realce so quando ha algo pairando: um contorno permanente viraria
          // ruido em cada categoria da arvore.
          isOver && "rounded-md bg-accent-500/[0.06] ring-1 ring-accent-600/30",
        )}
      >
        {children}
      </ul>
    </SortableContext>
  );
}
