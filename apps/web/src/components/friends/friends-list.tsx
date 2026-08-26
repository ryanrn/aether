"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Loader2,
  MessageSquare,
  Monitor,
  Search,
  UserPlus,
  UserX,
  X,
} from "lucide-react";
import type { PublicFriendship, UserStatus } from "@aether/shared";
import {
  removeFriendAction,
  respondFriendRequestAction,
  sendFriendRequestAction,
} from "@/server/actions/friends";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { useSocket } from "@/components/realtime/realtime-provider";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { SecaoAmigos } from "./friends-nav";

/**
 * Painel central — a lista, com o formulario de adicionar INLINE.
 *
 * O formulario mora aqui, e nao numa tela propria, por um motivo de uso: quem
 * acaba de mandar um pedido ve a lista mudar no mesmo lugar em que ja estava
 * olhando, em vez de voltar de uma tela vazia para conferir se funcionou.
 */
export function FriendsList({
  secao,
  amigos,
  recebidos,
  enviados,
}: {
  secao: SecaoAmigos;
  amigos: PublicFriendship[];
  recebidos: PublicFriendship[];
  enviados: PublicFriendship[];
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
    secao === "solicitacoes"
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
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-white/[0.06] px-5">
        <h1 className="shrink-0 text-[16px] font-bold text-ink-100">
          {secao === "solicitacoes" ? "Solicitacoes" : "Amigos"}
        </h1>

        {secao === "amigos" ? (
          <div className="flex items-center gap-1">
            <Aba ativa={aba === "online"} onClick={() => setAba("online")}>
              Online
            </Aba>
            <Aba ativa={aba === "todos"} onClick={() => setAba("todos")}>
              Todos
            </Aba>
          </div>
        ) : null}

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => {
            setFormAberto(true);
            inputRef.current?.focus();
          }}
          className="shrink-0 rounded-[5px] bg-accent-500 px-3.5 py-1.5 text-[13px] font-bold text-white transition-colors duration-150 hover:bg-accent-400"
        >
          Adicionar amigo
        </button>
      </header>

      {formAberto ? <AddFriend inputRef={inputRef} /> : null}

      <div className="shrink-0 border-b border-white/[0.06] px-5 pb-3">
        <div className="mx-auto flex w-full max-w-[960px] items-center gap-2.5 rounded-[6px] border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5">
          <Search className="h-[18px] w-[18px] shrink-0 text-ink-600" strokeWidth={1.75} />
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
          ? "bg-white/[0.03] text-ink-100"
          : "text-ink-300 hover:bg-white/[0.03] hover:text-ink-100",
      )}
    >
      {children}
    </button>
  );
}

function Categoria({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-5 pb-2 pt-5 text-[12px] font-bold uppercase tracking-[0.04em] text-ink-600">
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
    : secao === "solicitacoes"
      ? "Nenhum pedido esperando. Os que voce enviar tambem aparecem aqui."
      : aba === "online"
        ? "Ninguem online agora. A aba Todos mostra a lista inteira."
        : "Sua lista esta vazia. Peca o nome de usuario de alguem e mande o convite acima.";

  return (
    <p className="mx-auto mt-8 max-w-[560px] rounded-[10px] border border-dashed border-white/[0.06] px-6 py-10 text-center text-[13px] leading-relaxed text-ink-500">
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
    <div className="mx-auto my-4 w-full max-w-[960px] shrink-0 rounded-[10px] border border-white/[0.06] bg-base-850 px-5 py-4">
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
            erro ? "border-signal-dnd" : "border-white/[0.06] focus:border-accent-500",
          )}
        />
        <button
          type="submit"
          disabled={pendente || nome.trim().length === 0}
          className="flex shrink-0 items-center gap-2 rounded-[6px] bg-accent-500 px-5 py-2.5 text-[13px] font-bold text-white transition-colors duration-150 hover:bg-accent-400 disabled:opacity-40"
        >
          {pendente ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <UserPlus className="h-4 w-4" strokeWidth={1.75} />
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
  const [pendente, startTransition] = useTransition();

  const router = useRouter();
  const socket = useSocket();
  const [abrindoConversa, setAbrindoConversa] = useState(false);

  function agir(acao: () => Promise<unknown>) {
    startTransition(async () => {
      await acao();
    });
  }

  /**
   * Abrir conversa e um ida-e-volta pelo socket, e nao um `<Link>` direto:
   * so o servidor sabe o id da conversa, e ele pode nem existir ainda. Pedir
   * primeiro e navegar depois evita inventar rota para uma conversa que
   * ainda nao foi criada.
   *
   * O `dm:open` e idempotente — clicar dez vezes cai sempre na mesma conversa,
   * garantido pelo indice unico sobre o par ordenado no banco.
   */
  function abrirConversa() {
    if (!socket || abrindoConversa) return;
    setAbrindoConversa(true);
    socket.emit("dm:open", { userId: item.user.id }, (resultado) => {
      setAbrindoConversa(false);
      if (!resultado.ok) return;
      router.push(`/app/dm/${resultado.dm.id}`);
    });
  }

  return (
    <div className="group mx-2 flex items-center gap-3.5 rounded-lg px-3 py-3 transition-colors duration-150 hover:bg-white/[0.03]">
      <Avatar
        userId={item.user.id}
        name={item.user.displayName}
        src={item.user.avatarUrl}
        status={status}
        size="md"
        round
        // A linha fica sobre `base-950`; o anel do ponto acompanha o fundo.
        ring="border-base-950"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold text-ink-100">
          {item.user.displayName}
        </p>
        {jogo?.game ? (
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-ink-300">
            <Monitor className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{jogo.game}</span>
          </p>
        ) : (
          <p className="mt-0.5 truncate text-[13px] text-ink-300">{LEGENDA[status]}</p>
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
        {item.kind === "incoming" ? (
          <>
            <BotaoAcao
              titulo="Aceitar"
              pendente={pendente}
              onClick={() => agir(() => respondFriendRequestAction(item.id, true))}
            >
              <Check className="h-4 w-4" strokeWidth={2} />
            </BotaoAcao>
            <BotaoAcao
              titulo="Recusar"
              perigo
              pendente={pendente}
              onClick={() => agir(() => respondFriendRequestAction(item.id, false))}
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </BotaoAcao>
          </>
        ) : item.kind === "outgoing" ? (
          <BotaoAcao
            titulo="Cancelar pedido"
            perigo
            pendente={pendente}
            onClick={() => agir(() => removeFriendAction(item.user.id))}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </BotaoAcao>
        ) : (
          <>
            <BotaoAcao
              titulo="Conversar"
              pendente={abrindoConversa}
              onClick={abrirConversa}
            >
              <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
            </BotaoAcao>
            <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <BotaoAcao
                titulo="Desfazer amizade"
                perigo
                pendente={pendente}
                onClick={() => agir(() => removeFriendAction(item.user.id))}
              >
                <UserX className="h-4 w-4" strokeWidth={1.75} />
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
        "grid h-9 w-9 place-items-center rounded-full border border-white/[0.06] bg-base-850 text-ink-300",
        "transition-colors duration-150 disabled:opacity-40",
        perigo
          ? "hover:bg-signal-dnd hover:text-white"
          : "hover:bg-base-900 hover:text-ink-100",
      )}
    >
      {pendente ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
      ) : (
        children
      )}
    </button>
  );
}
