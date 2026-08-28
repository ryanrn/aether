"use client";

import { useState, useEffect } from "react";
import { ServerRailV2, type ServerItem } from "./server-rail-v2";
import { FriendsSidebarV2, type FriendsTabSection } from "./friends-sidebar-v2";
import { FriendsViewV2 } from "./friends-view-v2";
import { ChannelSidebarV2, type ChannelCategory } from "./channel-sidebar-v2";
import { ChatPanelV2, type ChatMessage } from "./chat-panel-v2";
import { MemberPanelV2 } from "./member-panel-v2";
import { AppSettingsModalV2 } from "./app-settings-modal-v2";
import { ModalDeAssinatura } from "@/components/premium/assinatura-modal";
import { PremiumShowcaseScreen } from "@/components/premium/premium-showcase-screen";
import { cn } from "@/lib/utils";

export function AetherShellV2() {
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [friendsSection, setFriendsSection] = useState<FriendsTabSection>("amigos");
  const [activeChannelId, setActiveChannelId] = useState<string>("c1");
  const [membersPanelOpen, setMembersPanelOpen] = useState<boolean>(true);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [modalDeAssinaturaAberto, setModalDeAssinaturaOpen] = useState<boolean>(false);

  // Escuta atalho CTRL + K para busca rápida
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const mockServers: ServerItem[] = [
    { id: "s1", name: "Aether Oficial", iconUrl: null, unreadCount: 0 },
    { id: "s2", name: "Gaming Hub", iconUrl: null, unreadCount: 2, hasMention: true },
  ];

  const mockCategories: ChannelCategory[] = [
    {
      id: "cat-1",
      name: "Geral",
      channels: [
        { id: "c1", name: "chat-geral", type: "text" },
        { id: "c2", name: "teste", type: "text" },
      ],
    },
    {
      id: "cat-2",
      name: "Gaming",
      channels: [
        { id: "c3", name: "Sala 1", type: "voice" },
        { id: "c4", name: "Sala 2", type: "voice" },
      ],
    },
    {
      id: "cat-3",
      name: "Privado",
      channels: [
        { id: "c5", name: "staff-only", type: "text", isPrivate: true },
      ],
    },
  ];

  const isHome = activeServerId === null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base-950 text-ink-100 font-sans antialiased select-none">
      {/* 1. Trilho de Servidores (Extrema Esquerda) */}
      <ServerRailV2
        servers={mockServers}
        activeServerId={activeServerId}
        onSelectServer={(serverId) => setActiveServerId(serverId)}
        onExplore={() => setModalDeAssinaturaOpen(true)}
        onAddServer={() => alert("Criar servidor em breve")}
        onHelp={() => setSettingsOpen(true)}
      />

      {/* 2. Conteúdo Central Dividido por Modo (Home vs Servidor) */}
      {isHome ? (
        /* MODO HOME / AMIGOS / DMs (Prints 1 e 3) */
        <>
          <FriendsSidebarV2
            activeSection={friendsSection}
            onSelectSection={(sec) => setFriendsSection(sec)}
            onOpenQuickSwitcher={() => setSettingsOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onEditProfile={() => setSettingsOpen(true)}
          />

          {/* Área Principal de Amigos ou Showcase do Olimpo */}
          {friendsSection === "olimpo" ? (
            <PremiumShowcaseScreen />
          ) : (
            <FriendsViewV2
              onStartDM={(id) => setFriendsSection(`dm-${id}` as FriendsTabSection)}
              onAddFriend={(name) => alert(`Pedido de amizade enviado para: ${name}`)}
            />
          )}
        </>
      ) : (
        /* MODO SERVIDOR / CHAT / MEMBROS (Prints 2 e 5) */
        <>
          <ChannelSidebarV2
            serverName={
              mockServers.find((s) => s.id === activeServerId)?.name || "Aether Oficial"
            }
            categories={mockCategories}
            activeChannelId={activeChannelId}
            onSelectChannel={(chId) => setActiveChannelId(chId)}
            onOpenServerSettings={() => setSettingsOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onEditProfile={() => setSettingsOpen(true)}
          />

          <ChatPanelV2
            channelName={
              mockCategories
                .flatMap((c) => c.channels)
                .find((ch) => ch.id === activeChannelId)?.name || "chat-geral"
            }
            channelType="text"
            membersPanelOpen={membersPanelOpen}
            onToggleMembersPanel={() => setMembersPanelOpen(!membersPanelOpen)}
            onSendMessage={(msg) => console.log("Mensagem enviada:", msg)}
          />

          {/* Painel Direito de Membros */}
          {membersPanelOpen && (
            <MemberPanelV2 />
          )}
        </>
      )}

      {/* Modal de Configurações Estilo Discord (Print 4) */}
      <AppSettingsModalV2
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Modal de Assinatura (Prints 1 e 2) */}
      <ModalDeAssinatura
        open={modalDeAssinaturaAberto}
        onClose={() => setModalDeAssinaturaOpen(false)}
      />
    </div>
  );
}
