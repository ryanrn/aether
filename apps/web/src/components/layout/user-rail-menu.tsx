"use client";

import { useRef, useState, useTransition } from "react";
import { preCarregarPerfil } from "@/lib/perfil-cache";
import type { PublicUser } from "@aether/shared";
import { logoutAction } from "@/server/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import {
  AppSettingsModal,
  type Tab as ConfigTab,
} from "@/components/settings/app-settings-modal";
import {
  SelfUserCard,
  type SelfCardAnchor,
} from "@/components/profile/self-user-card";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { useShellStore } from "@/lib/stores/shell-store";
import { cn } from "@/lib/utils";

/**
 * O proprio usuario no rodape da trilha de servidores.
 *
 * Existe porque o cartao do usuario, as Configuracoes e o "Sair da conta"
 * moravam SO na HUD de voz (`control-bar.tsx`), que so monta dentro de um
 * servidor. Quem nao esta em servidor nenhum — recem-chegado, tela de amigos —
 * ficava sem como abrir Configuracoes ou deslogar.
 *
 * Fica na casca do `/app`, entao acompanha toda navegacao. Reaproveita o
 * mesmo `SelfUserCard` e `AppSettingsModal` da HUD; a diferenca e o
 * `server={null}` (sem "apelido neste servidor") e o `onLogout` (que a HUD nao
 * passa porque la o "Sair" ja vive no dock).
 */
export function UserRailMenu({
  user,
}: {
  user: PublicUser & {
    allowServerDms: boolean;
    allowServerFriendRequests: boolean;
  };
}) {
  const botaoRef = useRef<HTMLButtonElement | null>(null);
  const [card, setCard] = useState<SelfCardAnchor | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [, startTransition] = useTransition();

  // A tela de Perfil (e qualquer outro lugar) abre este MESMO modal pela store.
  const configAberta = useShellStore((s) => s.configAberta);
  const abaDeConfig = useShellStore((s) => s.abaDeConfig);
  const fecharConfig = useShellStore((s) => s.fecharConfig);

  const status =
    useRealtimeStore((state) => state.presence[user.id]) ?? "ONLINE";

  function abrir() {
    const rect = botaoRef.current?.getBoundingClientRect();
    if (!rect) return;
    // A trilha e estreita e cola na esquerda: o cartao abre a DIREITA do
    // botao. O `SelfUserCard` ainda se ajusta para nao sair da janela.
    setCard({ x: rect.right + 8, y: rect.top });
  }

  function sair() {
    startTransition(() => {
      void logoutAction();
    });
  }

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        onClick={abrir}
        onPointerEnter={() => preCarregarPerfil(user.id)}
        title={`${user.displayName} — conta e configuracoes`}
        aria-label="Sua conta e configuracoes"
        className={cn(
          "mt-auto grid h-12 w-12 place-items-center rounded-[18px] transition-colors",
          card ? "bg-base-800" : "hover:bg-base-800",
        )}
      >
        <Avatar
          userId={user.id}
          name={user.displayName}
          src={user.avatarUrl}
          moldura={user.moldura}
          status={status}
          size="md"
        />
      </button>

      {card ? (
        <SelfUserCard
          user={user}
          voiceChannels={[]}
          anchor={card}
          onClose={() => setCard(null)}
          onOpenSettings={() => setSettingsOpen(true)}
          onLogout={sair}
        />
      ) : null}

      <AppSettingsModal
        open={settingsOpen || configAberta}
        onClose={() => {
          setSettingsOpen(false);
          if (configAberta) fecharConfig();
        }}
        user={user}
        server={null}
        abaInicial={
          configAberta && abaDeConfig
            ? (abaDeConfig as ConfigTab)
            : undefined
        }
      />
    </>
  );
}
