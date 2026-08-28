"use client";

import { useState } from "react";
import {
  Users,
  Search,
  MessageSquare,
  MoreVertical,
  Phone,
  Moon,
  Inbox,
  HelpCircle,
  Check,
  X,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FriendFilter = "online" | "todos" | "pendente" | "adicionar";

export interface FriendData {
  id: string;
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  status: "online" | "idle" | "dnd" | "offline";
  activity?: string;
  game?: {
    name: string;
    details?: string;
    duration?: string;
  };
}

export interface FriendsViewV2Props {
  friends?: FriendData[];
  onStartDM?: (friendId: string) => void;
  onStartCall?: (friendId: string) => void;
  onAddFriend?: (username: string) => void;
  className?: string;
}

export function FriendsViewV2({
  friends = [],
  onStartDM,
  onStartCall,
  onAddFriend,
  className,
}: FriendsViewV2Props) {
  const [filter, setFilter] = useState<FriendFilter>("online");
  const [searchQuery, setSearchQuery] = useState("");
  const [addFriendInput, setAddFriendInput] = useState("");

  const statusColors = {
    online: "bg-signal-online",
    idle: "bg-signal-idle",
    dnd: "bg-signal-dnd",
    offline: "bg-signal-offline",
  };

  const filteredFriends = friends.filter((friend) => {
    if (filter === "online") return friend.status !== "offline";
    return true;
  }).filter((friend) =>
    friend.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeFriends = friends.filter((f) => f.game || f.status === "online");

  return (
    <div className={cn("flex flex-1 h-full min-h-0 bg-base-950 text-ink-100 overflow-hidden", className)}>
      {/* Coluna Central: Lista de Amigos */}
      <div className="flex flex-1 flex-col min-w-0 border-r border-base-900">
        {/* Top Header Bar (Print 1) */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-base-850 px-4 bg-base-950 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-ink-100 font-bold text-sm">
              <Users className="h-5 w-5 text-ink-400" />
              <span>Meus amigos</span>
            </div>

            <div className="h-4 w-px bg-base-800" />

            {/* Filter Tabs in Pill */}
            <div className="flex items-center gap-1">
              {(
                [
                  { id: "online", label: "Online" },
                  { id: "todos", label: "Todos" },
                  { id: "pendente", label: "Pendente" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-semibold transition-colors",
                    filter === tab.id
                      ? "bg-base-800 text-ink-100"
                      : "text-ink-300 hover:bg-base-850 hover:text-ink-100",
                  )}
                >
                  {tab.label}
                </button>
              ))}

              {/* Botão Destacado: Adicionar Amigo */}
              <button
                type="button"
                onClick={() => setFilter("adicionar")}
                className={cn(
                  "ml-1 rounded px-3 py-1 text-xs font-bold transition-all duration-150",
                  filter === "adicionar"
                    ? "bg-accent-600 text-white"
                    : "bg-accent-500 text-white hover:bg-accent-400 active:bg-accent-600 shadow-[0_0_12px_-4px_var(--color-accent-500)]",
                )}
              >
                Adicionar amigo
              </button>
            </div>
          </div>

          {/* Ações do Header Direito */}
          <div className="flex items-center gap-2 text-ink-400">
            <button
              type="button"
              title="Caixa de entrada"
              className="p-1.5 rounded hover:bg-base-850 hover:text-ink-100 transition-colors"
            >
              <Inbox className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Ajuda"
              className="p-1.5 rounded hover:bg-base-850 hover:text-ink-100 transition-colors"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Conteúdo da Aba */}
        <div className="flex-1 flex flex-col p-6 overflow-y-auto">
          {filter === "adicionar" ? (
            /* Formulário Adicionar Amigo */
            <div className="flex flex-col gap-4 max-w-xl">
              <div>
                <h3 className="text-base font-bold uppercase tracking-wide text-ink-100">
                  Adicionar amigo
                </h3>
                <p className="text-xs text-ink-400 mt-1">
                  Você pode adicionar amigos com o nome de usuário do Aether.
                </p>
              </div>

              <div className="relative flex items-center">
                <input
                  type="text"
                  value={addFriendInput}
                  onChange={(e) => setAddFriendInput(e.target.value)}
                  placeholder="Você pode adicionar amigos com o nome de usuário"
                  className="h-12 w-full rounded-lg border border-base-750 bg-base-900 px-4 text-sm text-ink-100 placeholder:text-ink-500 focus:border-accent-500 focus:outline-none"
                />
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!addFriendInput.trim()}
                  onClick={() => {
                    onAddFriend?.(addFriendInput);
                    setAddFriendInput("");
                  }}
                  className="absolute right-2 font-bold"
                >
                  Enviar pedido de amizade
                </Button>
              </div>
            </div>
          ) : (
            /* Lista Normal com Busca */
            <div className="flex flex-col gap-5 flex-1">
              {/* Barra de Busca de Amigos (Print 1) */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Procurar amigos online"
                  className="h-9 w-full rounded-md border border-base-800 bg-base-900 pl-9 pr-3 text-xs text-ink-100 placeholder:text-ink-500 focus:border-base-700 focus:outline-none"
                />
              </div>

              {/* Lista ou Empty State */}
              {filteredFriends.length === 0 ? (
                /* Empty State do Print 1 */
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-16">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-base-900 text-ink-400 shadow-inner">
                    <Users className="h-8 w-8" />
                  </div>
                  <h4 className="text-base font-bold text-ink-100">
                    Esta lista de amigos precisa de mais gente
                  </h4>
                  <p className="text-xs text-ink-400 max-w-xs">
                    Para onde vamos, precisamos de mais amigos. Adicione alguém pelo botão acima!
                  </p>
                </div>
              ) : (
                /* Lista Renderizada */
                <div className="flex flex-col gap-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 pb-1">
                    {filter === "online" ? `Online — ${filteredFriends.length}` : `Todos — ${filteredFriends.length}`}
                  </p>
                  {filteredFriends.map((friend) => (
                    <div
                      key={friend.id}
                      className="group flex items-center justify-between rounded-lg p-2 hover:bg-base-900 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Avatar */}
                        <div className="relative h-10 w-10 shrink-0 rounded-full bg-base-800 flex items-center justify-center font-bold text-white text-sm overflow-hidden">
                          {friend.avatarUrl ? (
                            <img
                              src={friend.avatarUrl}
                              alt={friend.displayName}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="uppercase">{friend.displayName.slice(0, 2)}</span>
                          )}
                          <span
                            className={cn(
                              "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-base-950",
                              statusColors[friend.status],
                            )}
                          />
                        </div>

                        <div className="min-w-0">
                          <p className="font-bold text-xs text-ink-100 truncate">
                            {friend.displayName}
                          </p>
                          <p className="text-[11px] text-ink-400 truncate">
                            {friend.activity || (friend.status === "online" ? "Online" : "Ausente")}
                          </p>
                        </div>
                      </div>

                      {/* Botões de Ação */}
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => onStartDM?.(friend.id)}
                          title="Enviar mensagem"
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-base-800 text-ink-200 hover:text-white hover:bg-base-750 transition-colors"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onStartCall?.(friend.id)}
                          title="Iniciar chamada"
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-base-800 text-ink-200 hover:text-white hover:bg-base-750 transition-colors"
                        >
                          <Phone className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Mais opções"
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-base-800 text-ink-200 hover:text-white hover:bg-base-750 transition-colors"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Coluna Direita: Ativos Agora (Print 1) */}
      <aside className="hidden lg:flex w-80 shrink-0 flex-col p-4 bg-base-950">
        <h3 className="text-lg font-black uppercase tracking-tight text-ink-100 mb-4">
          Ativos agora
        </h3>

        {activeFriends.length === 0 ? (
          /* Empty State "zzz" do Print 1 */
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2.5 p-6 border border-base-900 rounded-xl bg-base-900/30">
            <span className="text-3xl font-mono font-bold text-ink-500">z<span className="text-xl">z</span><span className="text-sm">z</span></span>
            <h4 className="text-sm font-bold text-ink-200">
              Está tudo tranquilo por enquanto...
            </h4>
            <p className="text-xs text-ink-500 leading-relaxed max-w-xs">
              Quando seus amigos estiverem ativos em canais de voz ou jogando, a atividade deles aparecerá aqui.
            </p>
          </div>
        ) : (
          /* Cards de Atividade */
          <div className="flex flex-col gap-3">
            {activeFriends.map((f) => (
              <div
                key={f.id}
                className="flex flex-col gap-2.5 rounded-xl border border-base-800 bg-base-900 p-3.5"
              >
                <div className="flex items-center gap-2.5">
                  <div className="relative h-8 w-8 shrink-0 rounded-full bg-base-800 flex items-center justify-center font-bold text-white text-xs overflow-hidden">
                    {f.avatarUrl ? (
                      <img src={f.avatarUrl} alt={f.displayName} className="h-full w-full object-cover" />
                    ) : (
                      <span>{f.displayName.slice(0, 2)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 truncate">
                    <p className="text-xs font-bold text-ink-100 truncate">{f.displayName}</p>
                    <p className="text-[11px] text-accent-400 font-medium truncate">
                      {f.game?.name || "Em chamada de voz"}
                    </p>
                  </div>
                </div>
                {f.game?.details ? (
                  <p className="text-[11px] text-ink-400 pl-1">{f.game.details}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
