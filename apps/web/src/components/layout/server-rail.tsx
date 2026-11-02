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
import { useParams } from "next/navigation";
import { AetherIcon } from "@/components/ui/aether-icon";
import type { PublicServer, PublicUser } from "@aether/shared";
import { cn, colorFromId, initials } from "@/lib/utils";
import { CreateServerModal } from "@/components/servers/create-server-modal";
import { MarcaHome } from "@/components/layout/marca-home";
import { UserRailMenu } from "@/components/layout/user-rail-menu";
import { useShellStore } from "@/lib/stores/shell-store";
import {
  NAV_ESCONDIDA,
  NAV_GAVETA,
  NAV_VISIVEL,
} from "@/components/layout/nav-mobile";
import { reorderServersAction } from "@/server/actions/servers";
import {
  useMencoesByServer,
  useUnreadByServer,
} from "@/lib/stores/realtime-store";

/**
 * Barra vertical de servidores. Estado ativo marcado por uma barra de acento
 * na borda esquerda (nao por preenchimento) para manter a interface calma.
 */
/**
 * O ARREDONDAMENTO DOS ICONES DA TRILHA.
 *
 * Circulo quando em repouso, quadrado-arredondado quando ativo ou sob o
 * cursor. Nao e enfeite: e o que torna o item ativo reconhecivel SEM cor —
 * quem nao distingue o azul do acento ainda percebe a forma mudando. A barra
 * branca a esquerda diz a mesma coisa por um terceiro caminho.
 *
 * `transition-all` na mesma classe faz a forma MORFAR em vez de saltar. Sem a
 * transicao o efeito parece defeito de renderizacao.
 *
 * Os valores sao absolutos (`24px` e `16px`) e nao `rounded-full`: num
 * elemento de 44px, `full` daria 22px e o repouso ficaria indistinguivel do
 * ativo. A diferenca entre os dois estados e o ponto.
 */
/**
 * As duas constantes carregam a variante `group-hover:` DENTRO da string, e
 * nao montada por interpolacao.
 *
 * O Tailwind varre o TEXTO dos arquivos procurando classes completas. Escrito
 * como `group-hover:${ICONE_ATIVO}`, ele nunca veria `group-hover:rounded-[16px]`
 * e a regra simplesmente nao existiria no CSS — o hover nao faria nada, sem
 * erro em lugar nenhum. Foi o que eu escrevi primeiro.
 */
const ICONE_REPOUSO = "rounded-[24px] group-hover:rounded-[18px]";
const ICONE_ATIVO = "rounded-[18px]";

export function ServerRail({
  servers,
  user,
  pendingRequests = 0,
}: {
  servers: PublicServer[];
  /** o proprio usuario — para o menu de conta/config/sair no rodape */
  user: PublicUser & {
    allowServerDms: boolean;
    allowServerFriendRequests: boolean;
  };
  /** pedidos de amizade esperando VOCE decidir — o ponto de aviso na marca */
  pendingRequests?: number;
}) {
  const params = useParams<{ serverId?: string }>();
  const activeId = params?.serverId;
  const [modalOpen, setModalOpen] = useState(false);
  const naoLidas = useUnreadByServer();
  const mencoes = useMencoesByServer();

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
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
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

  const navAberta = useShellStore((estado) => estado.navAberta);

  return (
    <>
      <nav
        aria-label="Servidores"
        className={cn(
          "flex w-[68px] shrink-0 flex-col items-center gap-3 border-r border-line bg-base-900 py-3",
          /*
            No CELULAR esta trilha nao e uma coluna, e a metade de tras de uma
            gaveta: `fixed` a tira do fluxo, e ai o conteudo ocupa a tela
            inteira em vez de sobrar com 91px. No desktop nada disto vale.
          */
          NAV_GAVETA,
          "max-md:left-0",
          navAberta ? NAV_VISIVEL : NAV_ESCONDIDA,
        )}
      >
        {/*
          A marca — atalho para a home. Os cinco itens que viviam soltos aqui
          (Amigos, Loja, Grupos, Olimpo, Explorar, painel da equipe) agora estao
          no painel esquerdo (`HomeNavPanel`), que aparece fora de um servidor.
        */}
        <MarcaHome pendingRequests={pendingRequests} />

        <span className="h-px w-8 bg-line" />

        {/*
          `id` explicito: sem ele, o dnd-kit numera `aria-describedby` com um
          contador global (`DndDescribedBy-0`, `-1`...) que diverge entre
          servidor e cliente sempre que ha MAIS de um `DndContext` na pagina
          (este e o da arvore de canais) — hidratacao quebrada, sem UI visivel
          quebrando, mas com o erro no console a cada carga.
        */}
        <DndContext
          id="dnd-trilho-servidores"
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
                mencoes={mencoes[server.id] ?? 0}
              />
            ))}
          </SortableContext>
        </DndContext>

        {servers.length > 0 ? <span className="h-px w-8 bg-line" /> : null}

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          title="Adicionar servidor"
          className={cn(
            `grid h-12 w-12 place-items-center ${ICONE_REPOUSO} bg-base-800 text-ink-300 transition-all duration-150`,
            "transition-colors duration-150 hover:text-ink-100",
          )}
        >
          <AetherIcon name="plus" size="lg" className="h-[22px] w-[22px]" />
        </button>

        {/*
          O proprio usuario, colado no rodape (`mt-auto` no botao). E o unico
          caminho para Configuracoes e "Sair da conta" quando nao se esta
          dentro de um servidor — a HUD de voz, que tem os dois, so monta la.
        */}
        <UserRailMenu user={user} />
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
  mencoes,
}: {
  server: PublicServer;
  ativo: boolean;
  naoLidas: number;
  /** Com mencao, o selo mostra "@N" no lugar do total de nao lidas. */
  mencoes: number;
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
            "grid h-12 w-12 place-items-center overflow-hidden text-[15px] font-semibold text-ink-100",
            "transition-all duration-150",
            ativo ? `${ICONE_ATIVO} bg-base-800` : ICONE_REPOUSO,
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

        {mencoes > 0 ? (
          <span
            aria-label={`${mencoes} mencoes a voce em ${server.name}`}
            className={cn(
              "pointer-events-none absolute -right-0.5 -top-0.5",
              "grid h-[18px] min-w-[18px] place-items-center rounded-full px-1",
              "bg-signal-dnd text-[10px] font-bold leading-none text-white",
              "ring-2 ring-base-900",
            )}
          >
            @{mencoes > 99 ? "99+" : mencoes}
          </span>
        ) : naoLidas > 0 ? (
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
