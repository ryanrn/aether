"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import type { PublicFriendship, UserStatus } from "@aether/shared";
import {
  blockUserAction,
  removeFriendAction,
  unblockUserAction,
  respondFriendRequestAction,
  sendFriendRequestAction,
} from "@/server/actions/friends";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { useAbrirConversa } from "@/lib/chat/use-abrir-conversa";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { SecaoAmigos } from "./friends-screen";
import { NavToggle } from "@/components/layout/nav-mobile";

/**
 * Painel central — a lista, com o formulario de adicionar INLINE.
 *
 * O formulario mora aqui, e nao numa tela propria, por um motivo de uso: quem
 * acaba de mandar um pedido ve a lista mudar no mesmo lugar em que ja estava
 * olhando, em vez de voltar de uma tela vazia para conferir se funcionou.
 */
export function FriendsList({
  secao,
  onSecao,
  pedidosRecebidos,
  amigos,
  recebidos,
  enviados,
  bloqueados,
}: {
  secao: SecaoAmigos;
  onSecao: (secao: SecaoAmigos) => void;
  pedidosRecebidos: number;
  amigos: PublicFriendship[];
  recebidos: PublicFriendship[];
  enviados: PublicFriendship[];
  bloqueados: PublicFriendship[];
}) {
  const [aba, setAba] = useState<"online" | "todos">("online");
  const [busca, setBusca] = useState("");
  const [formAberto, setFormAberto] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const presence = useRealtimeStore((estado) => estado.presence);

  const filtrar = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (lista: PublicFriendship[]) =>
      termo.length === 0
        ? lista
        : lista.filter(
            (item) =>
              item.user.displayName.toLowerCase().includes(termo) ||
              item.user.username.toLowerCase().includes(termo),
          );
  }, [busca]);

  const estaOnline = (item: PublicFriendship) =>
    (presence[item.user.id] ?? "OFFLINE") !== "OFFLINE";

  /**
   * Os dois grupos dependem da SECAO, e nao so de quem esta online.
   *
   * Em "Solicitacoes" a separacao e recebido/enviado, nunca online/offline —
   * e isso nao e preferencia estetica. A presenca de um amigo so viaja entre
   * AMIGOS; quem ainda e um pedido pendente aparece sempre como offline aqui,
   * porque nao temos (nem devemos ter) a presenca dele. Agrupar por isso
   * diria "fulano esta offline" quando a verdade e "ainda nao da para saber".
   */
  const grupos =
    secao === "bloqueados"
      ? [{ titulo: "Bloqueados", itens: filtrar(bloqueados) }]
      : secao === "solicitacoes"
        ? [
            { titulo: "Recebidos", itens: filtrar(recebidos) },
            { titulo: "Enviados", itens: filtrar(enviados) },
          ]
        : (() => {
            const base = filtrar(amigos);
            const online = base.filter(estaOnline);
            if (aba === "online") return [{ titulo: "Online", itens: online }];
            return [
              { titulo: "Online", itens: online },
              { titulo: "Offline", itens: base.filter((i) => !estaOnline(i)) },
            ];
          })();

  const total = grupos.reduce((soma, grupo) => soma + grupo.itens.length, 0);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-base-950">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-1.5">
        <NavToggle />
        <div className="flex shrink-0 items-center gap-2 pr-1">
          <AetherIcon name="users" className="h-[18px] w-[18px] text-ink-400" />
          <h1 className="text-[15px] font-bold text-ink-100">Amigos</h1>
        </div>

        <span className="h-5 w-px bg-line" />

        {/*
          As secoes que moravam no `friends-nav` (a coluna que virou o
          `HomeNavPanel`): agora sao abas do topo, como o desenho pediu.
        */}
        <div className="flex items-center gap-1">
          <Aba ativa={secao === "amigos"} onClick={() => onSecao("amigos")}>
            Amigos
          </Aba>
          <Aba
            ativa={secao === "solicitacoes"}
            onClick={() => onSecao("solicitacoes")}
          >
            Solicitações
            {pedidosRecebidos > 0 ? (
              <span className="ml-1.5 rounded-full bg-signal-dnd px-1.5 text-[10px] font-bold leading-[15px] text-white">
                {pedidosRecebidos > 9 ? "9+" : pedidosRecebidos}
              </span>
            ) : null}
          </Aba>
          <Aba
            ativa={secao === "bloqueados"}
            onClick={() => onSecao("bloqueados")}
          >
            Bloqueados
          </Aba>
        </div>

        {secao === "amigos" ? (
          <>
            <span className="hidden h-5 w-px bg-line sm:block" />
            <div className="flex items-center gap-1">
              <Aba ativa={aba === "online"} onClick={() => setAba("online")}>
                Online
              </Aba>
              <Aba ativa={aba === "todos"} onClick={() => setAba("todos")}>
                Todos
              </Aba>
            </div>
          </>
        ) : null}

        <div className="ml-auto" />

        <button
          type="button"
          onClick={() => {
            setFormAberto(true);
            inputRef.current?.focus();
          }}
          aria-label="Adicionar amigo"
          className="grid shrink-0 place-items-center rounded-[5px] bg-signal-online px-3.5 py-1.5 text-[13px] font-bold text-white transition-colors duration-150 hover:brightness-110 max-md:h-8 max-md:w-8 max-md:px-0"
        >
          <span className="max-md:hidden">Adicionar amigo</span>
          <AetherIcon
            name="user-plus"
            className="hidden h-4 w-4 max-md:block"
            strokeWidth={2.25}
          />
        </button>
      </header>

      {formAberto ? <AddFriend inputRef={inputRef} /> : null}

      <div className="shrink-0 border-b border-line px-5 pb-3">
        <div className="mx-auto flex w-full max-w-[960px] items-center gap-2.5 rounded-[6px] border border-line bg-base-850/60 px-3.5 py-2.5">
          <AetherIcon
            name="search"
            className="h-[18px] w-[18px] shrink-0 text-ink-600"
            strokeWidth={1.75}
          />
          <input
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Buscar"
            aria-label="Buscar na lista"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink-100 outline-none placeholder:text-ink-600"
          />
        </div>
      </div>

      {/*
        Teto de largura na COLUNA inteira — formulario, busca e lista na mesma
        medida. Sem ele, numa tela larga o campo de adicionar amigo esticava
        mais de mil pixels: nome de usuario tem 24 caracteres, e um campo
        daquele tamanho para digitar isso e o que faz a tela parecer vazia e
        distante, mesmo com o conteudo todo certo.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <div className="mx-auto w-full max-w-[960px]">
          {total === 0 ? (
            <Vazio secao={secao} aba={aba} temBusca={busca.trim().length > 0} />
          ) : (
            grupos.map((grupo) =>
              grupo.itens.length === 0 ? null : (
                <div key={grupo.titulo}>
                  <Categoria>{`${grupo.titulo} — ${grupo.itens.length}`}</Categoria>
                  {grupo.itens.map((item) => (
                    <Linha key={item.id} item={item} />
                  ))}
                </div>
              ),
            )
          )}
        </div>
      </div>
    </section>
  );
}

function Aba({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className={cn(
        "rounded-[5px] px-3 py-1.5 text-[13px] font-bold transition-colors duration-150",
        ativa
          ? "bg-base-850/60 text-ink-100"
          : "text-ink-300 hover:bg-base-850/60 hover:text-ink-100",
      )}
    >
      {children}
    </button>
  );
}

function Categoria({ children }: { children: React.ReactNode }) {
  return (
    /*
      `ink-400`, como os cabecalhos de categoria da arvore e de cargo no
      painel de membros. Estava em `ink-600` — quase invisivel sobre o fundo,
      e e ele que separa "online" de "todos" numa lista longa.
    */
    <h2 className="px-5 pb-2 pt-5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-400">
      {children}
    </h2>
  );
}

function Vazio({
  secao,
  aba,
  temBusca,
}: {
  secao: SecaoAmigos;
  aba: "online" | "todos";
  temBusca: boolean;
}) {
  const texto = temBusca
    ? "Ninguem com esse nome na sua lista."
    : secao === "bloqueados"
      ? "Voce nao bloqueou ninguem. Quem for bloqueado deixa de conseguir te mandar mensagem, mesmo dividindo um servidor com voce."
      : secao === "solicitacoes"
        ? "Nenhum pedido esperando. Os que voce enviar tambem aparecem aqui."
        : aba === "online"
          ? "Ninguem online agora. A aba Todos mostra a lista inteira."
          : "Sua lista esta vazia. Peca o nome de usuario de alguem e mande o convite acima.";

  return (
    <p className="mx-auto mt-8 max-w-[560px] rounded-[10px] border border-dashed border-line px-6 py-10 text-center text-[13px] leading-relaxed text-ink-500">
      {texto}
    </p>
  );
}

/** Adicionar por nome de usuario EXATO — nao existe busca de pessoas, e isso e proposital. */
function AddFriend({
  inputRef,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      const resultado = await sendFriendRequestAction(nome);
      if (!resultado.ok) {
        setErro(resultado.error);
        return;
      }
      setNome("");
      setAviso(
        resultado.data.enviado === "aceito"
          ? "Voces ja se pediram — agora sao amigos."
          : "Pedido enviado.",
      );
    });
  }

  return (
    <div className="mx-auto my-4 w-full max-w-[960px] shrink-0 rounded-[10px] border border-line bg-base-850 px-5 py-4">
      <h2 className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink-100">
        Adicionar amigo
      </h2>

      <form onSubmit={enviar} className="mt-2.5 flex items-center gap-2">
        <input
          ref={inputRef}
          value={nome}
          onChange={(evento) => {
            setNome(evento.target.value);
            setErro(null);
            setAviso(null);
          }}
          placeholder="nome de usuario exato"
          autoComplete="off"
          spellCheck={false}
          aria-label="Nome de usuario"
          className={cn(
            "min-w-0 flex-1 rounded-[6px] border bg-base-950 px-3.5 py-2.5 text-[14px] text-ink-100",
            "outline-none transition-colors duration-150 placeholder:text-ink-600",
            erro ? "border-signal-dnd" : "border-line focus:border-accent-500",
          )}
        />
        <button
          type="submit"
          disabled={pendente || nome.trim().length === 0}
          className="flex shrink-0 items-center gap-2 rounded-[6px] bg-accent-500 px-5 py-2.5 text-[13px] font-bold text-white transition-colors duration-150 hover:bg-accent-400 disabled:opacity-40"
        >
          {pendente ? (
            <AetherIcon
              name="loader"
              className="h-4 w-4 animate-spin"
              strokeWidth={1.75}
            />
          ) : (
            <AetherIcon
              name="user-plus"
              className="h-4 w-4"
              strokeWidth={1.75}
            />
          )}
          Enviar
        </button>
      </form>

      {erro ? <p className="mt-2 text-[12px] text-signal-dnd">{erro}</p> : null}
      {aviso ? (
        <p className="mt-2 text-[12px] text-signal-online">{aviso}</p>
      ) : null}

      <p className="mt-2.5 text-[12px] leading-[1.5] text-ink-500">
        Precisa ser o nome exato. Nao ha busca de pessoas aqui de proposito —
        uma lista de quem tem conta seria uma lista de alvos.
      </p>
    </div>
  );
}

const LEGENDA: Record<UserStatus, string> = {
  ONLINE: "Disponivel",
  IDLE: "Ausente",
  DND: "Nao perturbe",
  OFFLINE: "Offline",
};

/**
 * Uma pessoa na lista.
 *
 * O `status` vem da STORE, e nao da propriedade que veio do servidor: aquele e
 * a preferencia guardada no banco (quem escolheu "Nao perturbe" ha um mes
 * segue DND ali, mesmo desligado). Quem responde "esta online AGORA" e o
 * socket.
 */
function Linha({ item }: { item: PublicFriendship }) {
  const status = useRealtimeStore(
    (estado) => estado.presence[item.user.id] ?? ("OFFLINE" as UserStatus),
  );
  const jogo = useRealtimeStore((estado) => estado.activity[item.user.id]);
  const musica = useRealtimeStore((estado) => estado.listening[item.user.id]);
  const [pendente, startTransition] = useTransition();

  const { abrir, abrindo: abrindoConversa } = useAbrirConversa();

  function agir(acao: () => Promise<unknown>) {
    startTransition(async () => {
      await acao();
    });
  }

  function abrirConversa() {
    abrir(item.user.id);
  }

  return (
    <div className="group mx-2 flex items-center gap-3.5 border-t border-line-soft px-3 py-3 transition-colors duration-150 first:border-t-0 hover:rounded-md hover:bg-base-750">
      <Avatar
        userId={item.user.id}
        name={item.user.displayName}
        src={item.user.avatarUrl}
        moldura={item.user.moldura}
        status={status}
        size="md"
        round
        // A linha fica sobre `base-950`; o anel do ponto acompanha o fundo.
        ring="border-base-950"
      />

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[15px] font-bold text-ink-100">
          {item.user.displayName}
          <span className="font-normal text-[13px] text-ink-500 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            @{item.user.username}
          </span>
        </p>
        {jogo?.game ? (
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-ink-200">
            <AetherIcon name="gamepad" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{jogo.game}</span>
          </p>
        ) : musica ? (
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-signal-spotify">
            <AetherIcon name="music" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              Ouvindo <span className="font-mono">{musica.title}</span>
              {musica.artists ? ` — ${musica.artists}` : ""}
            </span>
          </p>
        ) : (
          <p className="mt-0.5 truncate text-[13px] text-ink-300">
            {LEGENDA[status]}
          </p>
        )}
      </div>

      {/*
        "Conversar" fica SEMPRE VISIVEL; o resto so no hover.
        
        A primeira versao escondia tudo atras do hover, e o resultado foi
        exatamente o previsivel: a tela de amigos nao mostrava nenhum caminho
        para mandar mensagem, e quem olhava nao achava. Acao principal nao pode
        depender de a pessoa descobrir que passar o mouse revela algo — ainda
        mais quando ela e o motivo de a tela existir.
        
        Desfazer amizade continua no hover, e ai o escondido AJUDA: e destrutivo
        e nao e o que se vem fazer aqui.
        
        O grupo mantem `focus-within` porque, sem ele, os botoes de hover
        continuariam alcancaveis pelo teclado enquanto invisiveis — quem navega
        por Tab cairia num botao que nao consegue ver.
      */}
      <div className="flex shrink-0 items-center gap-1.5">
        {item.kind === "blocked" ? (
          /*
            Desbloquear fica SEMPRE visivel, e nao no hover: e a unica acao
            desta aba, e uma aba cuja unica acao esta escondida nao serve para
            nada. Foi o mesmo erro que deixou "Conversar" invisivel.
          */
          <BotaoAcao
            titulo="Desbloquear"
            pendente={pendente}
            onClick={() => agir(() => unblockUserAction(item.user.id))}
          >
            <AetherIcon name="ban" className="h-4 w-4" strokeWidth={1.75} />
          </BotaoAcao>
        ) : item.kind === "incoming" ? (
          <>
            <BotaoAcao
              titulo="Aceitar"
              pendente={pendente}
              onClick={() =>
                agir(() => respondFriendRequestAction(item.id, true))
              }
            >
              <AetherIcon name="check" className="h-4 w-4" strokeWidth={2} />
            </BotaoAcao>
            <BotaoAcao
              titulo="Recusar"
              perigo
              pendente={pendente}
              onClick={() =>
                agir(() => respondFriendRequestAction(item.id, false))
              }
            >
              <AetherIcon name="x" className="h-4 w-4" strokeWidth={2} />
            </BotaoAcao>
          </>
        ) : item.kind === "outgoing" ? (
          <BotaoAcao
            titulo="Cancelar pedido"
            perigo
            pendente={pendente}
            onClick={() => agir(() => removeFriendAction(item.user.id))}
          >
            <AetherIcon name="x" className="h-4 w-4" strokeWidth={2} />
          </BotaoAcao>
        ) : (
          <>
            <BotaoAcao
              titulo="Conversar"
              pendente={abrindoConversa}
              onClick={abrirConversa}
            >
              <AetherIcon
                name="message"
                className="h-4 w-4"
                strokeWidth={1.75}
              />
            </BotaoAcao>
            <span className="flex items-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <BotaoAcao
                titulo="Desfazer amizade"
                perigo
                pendente={pendente}
                onClick={() => agir(() => removeFriendAction(item.user.id))}
              >
                <AetherIcon
                  name="user-x"
                  className="h-4 w-4"
                  strokeWidth={1.75}
                />
              </BotaoAcao>
              {/*
                Bloquear tambem desfaz a amizade — os dois botoes ficam juntos
                de proposito, porque sao o mesmo tipo de decisao com alcances
                diferentes: um encerra a relacao, o outro encerra e fecha a
                porta.
              */}
              <BotaoAcao
                titulo="Bloquear"
                perigo
                pendente={pendente}
                onClick={() => agir(() => blockUserAction(item.user.id))}
              >
                <AetherIcon name="ban" className="h-4 w-4" strokeWidth={1.75} />
              </BotaoAcao>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function BotaoAcao({
  titulo,
  pendente,
  perigo = false,
  onClick,
  children,
}: {
  titulo: string;
  pendente: boolean;
  perigo?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      disabled={pendente}
      onClick={onClick}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-full border border-line bg-base-850 text-ink-300",
        "transition-colors duration-150 disabled:opacity-40",
        perigo
          ? "hover:bg-signal-dnd hover:text-white"
          : "hover:bg-base-900 hover:text-ink-100",
      )}
    >
      {pendente ? (
        <AetherIcon
          name="loader"
          className="h-4 w-4 animate-spin"
          strokeWidth={1.75}
        />
      ) : (
        children
      )}
    </button>
  );
}
