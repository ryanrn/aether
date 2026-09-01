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
import { Compass, Crown, Plus, Shield, Users } from "lucide-react";
import { rotuloDeRevisoes, totalDeRevisoes, type PublicServer, type RevisoesPendentes } from "@aether/shared";
import { cn, colorFromId, initials } from "@/lib/utils";
import { CreateServerModal } from "@/components/servers/create-server-modal";
import { useShellStore } from "@/lib/stores/shell-store";
import {
  NAV_ESCONDIDA,
  NAV_GAVETA,
  NAV_VISIVEL,
} from "@/components/layout/nav-mobile";
import { reorderServersAction } from "@/server/actions/servers";
import { contarRevisoesAction } from "@/server/actions/revisao";
import { useUnreadByServer } from "@/lib/stores/realtime-store";

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
const ICONE_REPOUSO = "rounded-[22px] group-hover:rounded-[16px]";
const ICONE_ATIVO = "rounded-[16px]";

export function ServerRail({
  servers,
  pendingRequests = 0,
  equipe = false,
}: {
  servers: PublicServer[];
  /** pedidos de amizade esperando VOCE decidir — o ponto no botao de amigos */
  pendingRequests?: number;
  /**
   * Administracao global. So decide se o icone do painel da equipe APARECE —
   * quem barra de verdade e a propria pagina, que recheca no servidor e
   * responde 404 para quem nao e.
   */
  equipe?: boolean;
}) {
  const params = useParams<{ serverId?: string }>();
  const activeId = params?.serverId;
  const pathname = usePathname();
  const emAmigos = pathname === "/app/amigos";
  const emOlimpo = pathname === "/app/olimpo";
  const emExplorar = pathname === "/app/explorar";
  const emEquipe = pathname === "/app/equipe";
  const [modalOpen, setModalOpen] = useState(false);
  const naoLidas = useUnreadByServer();
  const [revisoes, setRevisoes] = useState<RevisoesPendentes | null>(null);
  const esperandoRevisao = totalDeRevisoes(revisoes);

  /**
   * Busca a contagem das filas de revisao — o numerinho no icone do painel.
   *
   * SO PARA A EQUIPE: para o resto, a chamada nem sai — a action responderia
   * "Nao encontrado" de qualquer forma, e uma consulta por sessao de todo
   * mundo para receber recusa seria carga sem contrapartida.
   *
   * AO MONTAR E AO VOLTAR PARA A ABA, com um minuto de intervalo minimo. Nao e
   * tempo real de proposito: nada aqui e urgente, e um `setInterval` batendo
   * no banco o dia inteiro para mostrar um numero quase sempre zero custaria
   * caro por nada. Voltar para a janela e o momento em que a pessoa esta
   * olhando — e alt-tab de jogo dispara `focus` varias vezes por minuto, dai
   * a janela.
   */
  useEffect(() => {
    if (!equipe) return;
    let vivo = true;
    let ultima = 0;

    const buscar = () => {
      const agora = Date.now();
      if (agora - ultima < 60_000) return;
      ultima = agora;
      contarRevisoesAction()
        .then((r) => {
          if (vivo && r.ok) setRevisoes(r.data);
        })
        // Falha em silencio: o marcador e conveniencia, rede caida nao pode
        // virar erro na trilha de servidores.
        .catch(() => {});
    };

    buscar();
    window.addEventListener("focus", buscar);
    return () => {
      vivo = false;
      window.removeEventListener("focus", buscar);
    };
  }, [equipe]);

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

  const navAberta = useShellStore((estado) => estado.navAberta);

  return (
    <>
      <nav
        aria-label="Servidores"
        className={cn(
          "flex w-16 shrink-0 flex-col items-center gap-3 border-r border-base-800 bg-base-900 py-3",
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
              "grid h-11 w-11 place-items-center transition-all duration-150",
              emAmigos
                ? `${ICONE_ATIVO} bg-base-800 text-ink-100`
                : `${ICONE_REPOUSO} bg-base-800 text-ink-300 group-hover:text-ink-100`,
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

        {/**
         * O Olimpo logo abaixo de amigos, e ANTES da linha que separa os
         * servidores. As duas coisas acima da linha sao "do app"; abaixo dela
         * sao "seus servidores" — e assinatura nao e servidor.
         *
         * A coroa fica dourada mesmo desligada, de proposito: e o unico item
         * da trilha que nao e um lugar onde voce ja esta, e sim um convite. Um
         * icone cinza ali seria lido como mais um botao de navegacao.
         */}
        <Link
          href="/app/olimpo"
          title="Olimpo"
          draggable={false}
          className="group relative flex w-full justify-center"
        >
          <span
            className={cn(
              "absolute left-0 top-1/2 h-0 w-[3px] -translate-y-1/2 rounded-r-full bg-ink-100 transition-all duration-200",
              emOlimpo ? "h-7" : "group-hover:h-3.5",
            )}
          />
          <span
            className={cn(
              "grid h-11 w-11 place-items-center transition-all duration-150",
              emOlimpo
                ? `${ICONE_ATIVO} bg-amber-400/15 text-amber-300`
                : `${ICONE_REPOUSO} bg-base-800 text-amber-400/80 group-hover:bg-amber-400/10 group-hover:text-amber-300`,
            )}
          >
            <Crown className="h-5 w-5" />
          </span>
        </Link>

        {/*
          Explorar comunidades.
          
          Depois do Olimpo e ANTES da linha que separa os servidores, porque e
          o mesmo tipo de item que os dois acima: um lugar do app, e nao um
          servidor do qual voce e membro. Abaixo da linha ficam so os seus.
          
          Cor neutra, ao contrario da coroa: a coroa e dourada por ser um
          convite a assinar; explorar e navegacao, e navegacao dourada
          competiria com ela por atencao sem ter o que vender.
        */}
        <Link
          href="/app/explorar"
          title="Explorar comunidades"
          draggable={false}
          className="group relative flex w-full justify-center"
        >
          <span
            className={cn(
              "absolute left-0 top-1/2 h-0 w-[3px] -translate-y-1/2 rounded-r-full bg-ink-100 transition-all duration-200",
              emExplorar ? "h-7" : "group-hover:h-3.5",
            )}
          />
          <span
            className={cn(
              "grid h-11 w-11 place-items-center transition-all duration-150",
              emExplorar
                ? ICONE_ATIVO + " bg-accent-500 text-white"
                : ICONE_REPOUSO + " bg-base-800 text-ink-300 group-hover:bg-accent-500 group-hover:text-white",
            )}
          >
            <Compass className="h-5 w-5" />
          </span>
        </Link>

        {/*
          Painel da equipe. So aparece para quem e equipe — para o resto,
          esconder o icone e cortesia de interface; quem barra de verdade e a
          propria pagina, respondendo 404 pra quem chutar a URL.

          Vermelho, e nao neutro como o compass: e o UNICO item da trilha que
          pode carregar um numero dizendo "tem coisa esperando voce", e a cor
          de aviso e o que faz o marcador ser notado sem precisar ler o
          numero.
        */}
        {equipe ? (
          <Link
            href="/app/equipe"
            title="Painel da equipe"
            draggable={false}
            className="group relative flex w-full justify-center"
          >
            <span
              className={cn(
                "absolute left-0 top-1/2 h-0 w-[3px] -translate-y-1/2 rounded-r-full bg-ink-100 transition-all duration-200",
                emEquipe ? "h-7" : "group-hover:h-3.5",
              )}
            />
            <span
              className={cn(
                "relative grid h-11 w-11 place-items-center transition-all duration-150",
                emEquipe
                  ? ICONE_ATIVO + " bg-signal-dnd/15 text-signal-dnd"
                  : ICONE_REPOUSO + " bg-base-800 text-ink-300 group-hover:bg-signal-dnd/10 group-hover:text-signal-dnd",
              )}
            >
              <Shield className="h-5 w-5" />
              {esperandoRevisao > 0 ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-amber-400 px-1 text-[9px] font-bold leading-none text-base-950 ring-2 ring-base-900"
                >
                  {rotuloDeRevisoes(esperandoRevisao)}
                </span>
              ) : null}
            </span>
          </Link>
        ) : null}

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
            `grid h-11 w-11 place-items-center ${ICONE_REPOUSO} bg-base-800 text-ink-300 transition-all duration-150`,
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
            "grid h-11 w-11 place-items-center overflow-hidden text-[13px] font-semibold text-ink-100",
            "transition-all duration-150",
            ativo
              ? `${ICONE_ATIVO} bg-base-800`
              : ICONE_REPOUSO,
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
