"use client";

import { useEffect, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Plus, Users } from "lucide-react";
import type { PublicServer } from "@aether/shared";
import { cn, colorFromId, initials } from "@/lib/utils";
import { CreateServerModal } from "@/components/servers/create-server-modal";
import { useShellStore } from "@/lib/stores/shell-store";
import { reorderServersAction } from "@/server/actions/servers";
import { useUnreadByServer } from "@/lib/stores/realtime-store";

/**
 * Barra vertical de servidores. Estado ativo marcado por uma barra de acento
 * na borda esquerda (nao por preenchimento) para manter a interface calma.
 */
export function ServerRail({
  servers,
  pendingRequests = 0,
}: {
  servers: PublicServer[];
  /** pedidos de amizade esperando VOCE decidir — o ponto no botao de amigos */
  pendingRequests?: number;
}) {
  const params = useParams<{ serverId?: string }>();
  const activeId = params?.serverId;
  const pathname = usePathname();
  const emAmigos = pathname === "/app/amigos";
  const [modalOpen, setModalOpen] = useState(false);
  const naoLidas = useUnreadByServer();

  /**
   * A ordem local existe para o arrasto ser INSTANTANEO.
   *
   * Esperar o servidor responder para so entao mover o icone faria o item
   * voltar ao lugar antigo por uma fracao de segundo — o gesto pareceria ter
   * falhado. Aqui a lista reordena na hora e a action grava depois; se ela
   * falhar, o `useEffect` abaixo devolve a ordem que veio do servidor.
   */
  const [ordem, setOrdem] = useState(servers);
  useEffect(() => setOrdem(servers), [servers]);

  /**
   * `PointerSensor` com distancia minima: sem ela, QUALQUER clique vira o
   * comeco de um arrasto e o link nao navega mais. 6px separa "cliquei" de
   * "puxei" sem exigir precisao.
   */
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function aoSoltar(evento: DragEndEvent) {
    const { active, over } = evento;
    if (!over || active.id === over.id) return;

    const de = ordem.findIndex((s) => s.id === active.id);
    const para = ordem.findIndex((s) => s.id === over.id);
    if (de === -1 || para === -1) return;

    const nova = arrayMove(ordem, de, para);
    setOrdem(nova);
    void reorderServersAction(nova.map((s) => s.id));
  }

  /**
   * Publica a lista para a barra de TITULO, que vive no layout raiz e nao tem
   * como buscar isso sozinha. Daqui sai de graca: a lista ja chega pronta do
   * servidor e este componente ja e de cliente.
   */
  const setServers = useShellStore((estado) => estado.setServers);
  useEffect(() => setServers(servers), [servers, setServers]);

  return (
    <>
      <nav
        aria-label="Servidores"
        className="flex w-16 shrink-0 flex-col items-center gap-3 border-r border-base-800 bg-base-900 py-3"
      >
        {/**
         * Amigos primeiro, e separado dos servidores por uma linha: nao e um
         * servidor, e ficar no meio deles sugeriria que fosse.
         */}
        <Link
          href="/app/amigos"
          title="Amigos"
          draggable={false}
          className="group relative flex w-full justify-center"
        >
          <span
            className={cn(
              "absolute left-0 top-1/2 h-0 w-[3px] -translate-y-1/2 rounded-r-full bg-ink-100 transition-all duration-200",
              emAmigos ? "h-7" : "group-hover:h-3.5",
            )}
          />
          <span
            className={cn(
              "grid h-11 w-11 place-items-center rounded-xl transition-all duration-150",
              emAmigos
                ? "bg-base-800 text-ink-100"
                : "bg-base-800 text-ink-300 group-hover:scale-105 group-hover:text-ink-100",
            )}
          >
            <Users className="h-5 w-5" />
          </span>
          {pendingRequests > 0 ? (
            <span
              aria-label={`${pendingRequests} pedido(s) de amizade`}
              className="absolute -right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-signal-dnd px-1 text-[10px] font-semibold text-ink-100"
              style={{ right: "0.6rem" }}
            >
              {pendingRequests > 9 ? "9+" : pendingRequests}
            </span>
          ) : null}
        </Link>

        <span className="h-px w-8 bg-base-700" />

        <DndContext
          sensors={sensores}
          collisionDetection={closestCenter}
          onDragEnd={aoSoltar}
        >
          <SortableContext
            items={ordem.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            {ordem.map((server) => (
              <ItemDeServidor
                key={server.id}
                server={server}
                ativo={server.id === activeId}
                naoLidas={naoLidas[server.id] ?? 0}
              />
            ))}
          </SortableContext>
        </DndContext>

        {servers.length > 0 ? (
          <span className="h-px w-8 bg-base-700" />
        ) : null}

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          title="Adicionar servidor"
          className={cn(
            "grid h-11 w-11 place-items-center rounded-xl bg-base-800 text-ink-300",
            "transition-colors duration-150 hover:text-ink-100",
          )}
        >
          <Plus className="h-5 w-5" />
        </button>
      </nav>

      <CreateServerModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

/**
 * Um servidor no trilho — arrastavel.
 *
 * Componente proprio porque `useSortable` e um hook: chamado dentro do `map`
 * do pai, quebraria a regra de hooks assim que a lista mudasse de tamanho.
 *
 * O LINK CONTINUA SENDO LINK. Os `listeners` do dnd-kit vao no mesmo elemento,
 * e e o `activationConstraint` de 6px que separa os dois gestos: clique curto
 * navega, puxar arrasta. Sem essa distancia, arrastar e clicar viram a mesma
 * coisa e o trilho para de navegar.
 */
function ItemDeServidor({
  server,
  ativo,
  naoLidas,
}: {
  server: PublicServer;
  ativo: boolean;
  naoLidas: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: server.id });

  return (
    <Link
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // Enquanto arrasta, o item fica translucido e por cima dos outros.
        opacity: isDragging ? 0.4 : undefined,
        zIndex: isDragging ? 40 : undefined,
      }}
      {...attributes}
      {...listeners}
      href={`/app/s/${server.id}`}
      title={server.name}
      // Mesmo motivo do canal: arraste nativo de link mostra a URL.
      draggable={false}
      className="group relative flex w-full cursor-pointer justify-center"
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-0 w-[3px] -translate-y-1/2 rounded-r-full bg-ink-100 transition-all duration-200",
          ativo ? "h-7" : "group-hover:h-3.5",
        )}
      />

      <span className="relative">
        <span
          className={cn(
            "grid h-11 w-11 place-items-center overflow-hidden rounded-xl text-[13px] font-semibold text-ink-100",
            "transition-all duration-150",
            ativo ? "bg-base-800" : "group-hover:scale-105",
          )}
          style={
            server.iconUrl
              ? undefined
              : { backgroundColor: colorFromId(server.id) }
          }
        >
          {server.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={server.iconUrl}
              alt={server.name}
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            initials(server.name)
          )}
        </span>

        {naoLidas > 0 ? (
          <span
            aria-label={`${naoLidas} nao lidas em ${server.name}`}
            className={cn(
              "pointer-events-none absolute -right-0.5 -top-0.5",
              "grid h-[18px] min-w-[18px] place-items-center rounded-full px-1",
              "bg-signal-dnd text-[10px] font-bold leading-none text-white",
              "ring-2 ring-base-900",
            )}
          >
            {naoLidas > 99 ? "99+" : naoLidas}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
