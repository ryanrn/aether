"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, UserPlus, UserX, X } from "lucide-react";
import type { PublicFriendship, UserStatus } from "@aether/shared";
import {
  removeFriendAction,
  respondFriendRequestAction,
  sendFriendRequestAction,
} from "@/server/actions/friends";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Tela de amigos.
 *
 * A lista em si vem RENDERIZADA do servidor (`listFriendships`) — quem decide
 * o que e "pendente" e "aceito" e o banco. O que este componente acrescenta e
 * o estado VIVO: quem esta online agora e o que esta jogando, que chega pelo
 * socket na sala pessoal e nao existe no banco.
 *
 * Por isso o `status` de cada linha nao e o que veio na propriedade: aquele e
 * a preferencia guardada (alguem que escolheu "Nao perturbe" ha um mes segue
 * DND no banco mesmo desligado). Quem responde "esta online agora" e a store.
 */
export function FriendsScreen({
  friendships,
}: {
  friendships: PublicFriendship[];
}) {
  const amigos = friendships.filter((f) => f.kind === "friend");
  const recebidos = friendships.filter((f) => f.kind === "incoming");
  const enviados = friendships.filter((f) => f.kind === "outgoing");

  return (
    <div className="flex h-full min-h-0 flex-col bg-base-900">
      <header className="flex h-12 shrink-0 items-center border-b border-base-800 px-5">
        <h1 className="text-[13px] font-semibold text-ink-100">Amigos</h1>
        {amigos.length > 0 ? (
          <span className="ml-2 text-[12px] text-ink-300">{amigos.length}</span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-7">
          <AddFriend />

          {recebidos.length > 0 ? (
            <Secao titulo="Pedidos recebidos" contador={recebidos.length}>
              {recebidos.map((item) => (
                <LinhaPedido key={item.id} item={item} />
              ))}
            </Secao>
          ) : null}

          <Secao titulo="Seus amigos" contador={amigos.length}>
            {amigos.length === 0 ? (
              <Vazio texto="Ninguem por aqui ainda. Peca o nome de usuario de alguem e mande o convite acima." />
            ) : (
              amigos.map((item) => <LinhaAmigo key={item.id} item={item} />)
            )}
          </Secao>

          {enviados.length > 0 ? (
            <Secao titulo="Pedidos enviados" contador={enviados.length}>
              {enviados.map((item) => (
                <LinhaEnviado key={item.id} item={item} />
              ))}
            </Secao>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Secao({
  titulo,
  contador,
  children,
}: {
  titulo: string;
  contador: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-300">
        {titulo}
        {contador > 0 ? ` — ${contador}` : ""}
      </h2>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <p className="rounded-md border border-dashed border-base-800 px-4 py-6 text-center text-[12px] leading-relaxed text-ink-300">
      {texto}
    </p>
  );
}

/** Adicionar por nome de usuario EXATO — nao existe busca, e isso e proposital. */
function AddFriend() {
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
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-300">
        Adicionar amigo
      </h2>
      <form onSubmit={enviar} className="flex items-start gap-2">
        <div className="flex-1">
          <input
            value={nome}
            onChange={(evento) => {
              setNome(evento.target.value);
              setErro(null);
              setAviso(null);
            }}
            placeholder="nome de usuario exato"
            autoComplete="off"
            spellCheck={false}
            className={cn(
              // h-10 para casar com a altura do Button ao lado; h-9 deixava os
              // dois desalinhados por 4px.
              "h-10 w-full rounded-md border bg-base-950 px-3 text-[13px] text-ink-100",
              "placeholder:text-ink-500 focus:outline-none focus:ring-1",
              erro
                ? "border-signal-dnd focus:ring-signal-dnd"
                : "border-base-700 focus:border-accent-500 focus:ring-accent-500",
            )}
          />
          {erro ? (
            <p className="mt-1.5 text-[12px] text-signal-dnd">{erro}</p>
          ) : null}
          {aviso ? (
            <p className="mt-1.5 text-[12px] text-signal-online">{aviso}</p>
          ) : null}
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-300">
            Precisa ser o nome exato. Nao ha busca de pessoas aqui de proposito
            — uma lista de quem tem conta seria uma lista de alvos.
          </p>
        </div>
        <Button type="submit" variant="primary" disabled={pendente || !nome}>
          {pendente ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          Enviar
        </Button>
      </form>
    </section>
  );
}

/**
 * A linha de uma pessoa. O `status` vem da STORE, nao da propriedade — ver o
 * comentario do topo do arquivo.
 */
function Pessoa({
  item,
  children,
}: {
  item: PublicFriendship;
  children?: React.ReactNode;
}) {
  const status = useRealtimeStore(
    (estado) => estado.presence[item.user.id] ?? ("OFFLINE" as UserStatus),
  );
  const jogo = useRealtimeStore((estado) => estado.activity[item.user.id]);

  const legenda =
    jogo?.game ?? (status === "OFFLINE" ? "Offline" : LEGENDA_STATUS[status]);

  return (
    <div className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-base-850">
      <Avatar
        userId={item.user.id}
        name={item.user.displayName}
        src={item.user.avatarUrl}
        status={status}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink-100">
          {item.user.displayName}
        </p>
        <p
          className={cn(
            "truncate text-[12px]",
            jogo?.game ? "text-signal-online" : "text-ink-300",
          )}
        >
          {legenda}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

const LEGENDA_STATUS: Record<UserStatus, string> = {
  ONLINE: "Disponivel",
  IDLE: "Ausente",
  DND: "Nao perturbe",
  OFFLINE: "Offline",
};

function LinhaAmigo({ item }: { item: PublicFriendship }) {
  const [pendente, startTransition] = useTransition();
  return (
    <Pessoa item={item}>
      <IconeAcao
        titulo="Desfazer amizade"
        pendente={pendente}
        perigo
        onClick={() =>
          startTransition(async () => {
            await removeFriendAction(item.user.id);
          })
        }
      >
        <UserX className="h-4 w-4" />
      </IconeAcao>
    </Pessoa>
  );
}

function LinhaPedido({ item }: { item: PublicFriendship }) {
  const [pendente, startTransition] = useTransition();
  function responder(aceitar: boolean) {
    startTransition(async () => {
      await respondFriendRequestAction(item.id, aceitar);
    });
  }
  return (
    <Pessoa item={item}>
      <IconeAcao
        titulo="Aceitar"
        pendente={pendente}
        onClick={() => responder(true)}
      >
        <Check className="h-4 w-4" />
      </IconeAcao>
      <IconeAcao
        titulo="Recusar"
        pendente={pendente}
        perigo
        onClick={() => responder(false)}
      >
        <X className="h-4 w-4" />
      </IconeAcao>
    </Pessoa>
  );
}

function LinhaEnviado({ item }: { item: PublicFriendship }) {
  const [pendente, startTransition] = useTransition();
  return (
    <Pessoa item={item}>
      <span className="text-[12px] text-ink-300">aguardando</span>
      <IconeAcao
        titulo="Cancelar pedido"
        pendente={pendente}
        perigo
        onClick={() =>
          startTransition(async () => {
            await removeFriendAction(item.user.id);
          })
        }
      >
        <X className="h-4 w-4" />
      </IconeAcao>
    </Pessoa>
  );
}

function IconeAcao({
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
        "grid h-8 w-8 place-items-center rounded-full bg-base-800 text-ink-300",
        "transition-colors duration-150 disabled:opacity-50",
        perigo ? "hover:bg-signal-dnd hover:text-ink-100" : "hover:text-ink-100",
      )}
    >
      {pendente ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}
