"use client";

import { useState } from "react";
import {
  Hash,
  Volume2,
  Bell,
  Pin,
  Users,
  Search,
  PlusCircle,
  Smile,
  Send,
  Crown,
  Paperclip,
  Gift,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  id: string;
  author: {
    id: string;
    displayName: string;
    avatarUrl?: string | null;
    roleColor?: string;
    isOwner?: boolean;
    isAdmin?: boolean;
  };
  content: string;
  timestamp: string;
  reactions?: { emoji: string; count: number; users: string[] }[];
  attachments?: { name: string; url: string; type: string }[];
}

export interface ChatPanelV2Props {
  channelName?: string;
  channelType?: "text" | "voice";
  channelTopic?: string;
  messages?: ChatMessage[];
  membersPanelOpen?: boolean;
  onToggleMembersPanel?: () => void;
  onSendMessage?: (content: string) => void;
  className?: string;
}

export function ChatPanelV2({
  channelName = "CHAT GERAL",
  channelType = "text",
  channelTopic = "Canal principal de conversas e discussões da comunidade",
  messages = [
    {
      id: "m1",
      author: {
        id: "u1",
        displayName: "Ryan",
        roleColor: "#3daa7a",
        isOwner: true,
      },
      content: "Olá pessoal, bem-vindos ao novo design do Aether!",
      timestamp: "Hoje às 10:45",
    },
    {
      id: "m2",
      author: {
        id: "u2",
        displayName: "zombie",
        roleColor: "#f23f43",
        isAdmin: true,
      },
      content: "Ficou muito top o visual novo! 🔥",
      timestamp: "Hoje às 10:48",
    },
    {
      id: "m3",
      author: {
        id: "u1",
        displayName: "Ryan",
        roleColor: "#3daa7a",
        isOwner: true,
      },
      content: "Totalmente inspirado no Discord e Fluxer com performance máxima.",
      timestamp: "Hoje às 10:50",
    },
  ],
  membersPanelOpen = true,
  onToggleMembersPanel,
  onSendMessage,
  className,
}: ChatPanelV2Props) {
  const [inputText, setInputText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage?.(inputText);
    setInputText("");
  };

  return (
    <div className={cn("flex flex-1 flex-col h-full min-h-0 bg-base-950 text-ink-100 overflow-hidden", className)}>
      {/* Top Header do Canal (Print 5) */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-base-850 px-4 bg-base-950 shadow-sm">
        {/* Lado Esquerdo: Ícone + Nome do Canal + Tópico */}
        <div className="flex items-center gap-2.5 min-w-0">
          {channelType === "voice" ? (
            <Volume2 className="h-5 w-5 text-ink-400 shrink-0" />
          ) : (
            <Hash className="h-5 w-5 text-ink-400 shrink-0" />
          )}

          <h2 className="text-sm font-bold text-ink-100 truncate uppercase tracking-wide">
            {channelName}
          </h2>

          {channelTopic ? (
            <>
              <div className="hidden sm:block h-4 w-px bg-base-800" />
              <p className="hidden sm:block text-xs text-ink-400 truncate max-w-sm">
                {channelTopic}
              </p>
            </>
          ) : null}
        </div>

        {/* Lado Direito: Ações (Notificações, Pins, Membros, Busca) */}
        <div className="flex items-center gap-2 text-ink-400">
          <button
            type="button"
            title="Notificações"
            className="p-1.5 rounded hover:bg-base-850 hover:text-ink-100 transition-colors"
          >
            <Bell className="h-4 w-4" />
          </button>

          <button
            type="button"
            title="Mensagens fixadas"
            className="p-1.5 rounded hover:bg-base-850 hover:text-ink-100 transition-colors"
          >
            <Pin className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onToggleMembersPanel}
            title={membersPanelOpen ? "Ocultar lista de membros" : "Mostrar lista de membros"}
            className={cn(
              "p-1.5 rounded transition-colors",
              membersPanelOpen
                ? "bg-base-800 text-ink-100"
                : "hover:bg-base-850 hover:text-ink-100",
            )}
          >
            <Users className="h-4 w-4" />
          </button>

          {/* Campo de Busca Rápida no Header */}
          <div className="relative hidden md:block">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar"
              className="h-7 w-36 rounded bg-base-900 px-2 pr-6 text-xs text-ink-100 placeholder:text-ink-500 border border-base-800 focus:w-48 focus:border-base-700 focus:outline-none transition-all"
            />
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-500 pointer-events-none" />
          </div>
        </div>
      </header>

      {/* Lista de Mensagens Rolável */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {/* Banner de Boas-Vindas do Início do Canal */}
        <div className="flex flex-col gap-1.5 pt-6 pb-4 border-b border-base-900">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-base-850 text-white">
            <Hash className="h-8 w-8 text-accent-400" />
          </div>
          <h1 className="text-2xl font-black text-white uppercase tracking-wide mt-2">
            Bem-vindo ao #{channelName}!
          </h1>
          <p className="text-xs text-ink-400">
            Este é o início do canal #{channelName}. Envie uma mensagem para começar a conversa!
          </p>
        </div>

        {/* Mensagens */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className="group relative flex gap-3.5 rounded-lg -mx-2 px-2 py-1.5 hover:bg-base-900/50 transition-colors"
          >
            {/* Avatar do Autor */}
            <div className="relative h-10 w-10 shrink-0 rounded-full bg-base-800 flex items-center justify-center font-bold text-white text-sm overflow-hidden mt-0.5">
              {msg.author.avatarUrl ? (
                <img
                  src={msg.author.avatarUrl}
                  alt={msg.author.displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span>{msg.author.displayName.slice(0, 2).toUpperCase()}</span>
              )}
            </div>

            {/* Conteúdo da Mensagem */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-bold"
                  style={{ color: msg.author.roleColor || "var(--color-ink-100)" }}
                >
                  {msg.author.displayName}
                </span>

                {msg.author.isOwner && (
                  <span title="Dono do Servidor" className="inline-flex items-center">
                    <Crown className="h-3 w-3 text-amber-400 shrink-0" />
                  </span>
                )}

                <span className="text-[10.5px] text-ink-500 font-mono">
                  {msg.timestamp}
                </span>
              </div>

              <p className="text-[13.5px] text-ink-200 mt-0.5 leading-relaxed break-words whitespace-pre-wrap selection:bg-accent-500/30">
                {msg.content}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Message Composer no Rodapé (Print 5) */}
      <div className="p-4 pt-1">
        <form
          onSubmit={handleSend}
          className="relative flex items-center rounded-lg bg-base-900 border border-base-750 px-4 py-2.5 focus-within:border-base-600 transition-colors"
        >
          {/* Botão de Anexo */}
          <button
            type="button"
            title="Enviar anexo"
            className="mr-3 text-ink-400 hover:text-ink-100 transition-colors"
          >
            <PlusCircle className="h-5 w-5" />
          </button>

          {/* Campo de Texto */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Conversar em #${channelName}`}
            className="flex-1 bg-transparent text-[13.5px] text-ink-100 placeholder:text-ink-500 focus:outline-none"
          />

          {/* Ações Direitas: Emojis, Presentes e Enviar */}
          <div className="flex items-center gap-2.5 ml-2 text-ink-400">
            <button
              type="button"
              title="Emojis e Figurinhas"
              className="hover:text-ink-100 transition-colors"
            >
              <Smile className="h-5 w-5" />
            </button>

            <button
              type="submit"
              disabled={!inputText.trim()}
              title="Enviar mensagem"
              className={cn(
                "p-1 rounded transition-all",
                inputText.trim()
                  ? "text-accent-400 hover:text-accent-300 hover:bg-base-800"
                  : "text-ink-600 cursor-not-allowed",
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
