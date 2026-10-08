"use client";

import { usePathname } from "next/navigation";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { VoiceSession } from "@/components/realtime/voice-session";
import { VoiceChimes } from "@/components/realtime/voice-chimes";
import { ChamadaDmSession } from "@/components/realtime/chamada-dm-session";
import { ChamadaDmOverlay } from "@/components/realtime/chamada-dm-overlay";

/**
 * Monta a conexao em tempo real e a sessao de midia no LAYOUT RAIZ — o unico
 * ponto da arvore que o App Router nunca remonta enquanto a aba vive.
 *
 * POR QUE NAO NO `/app/layout`: era la, e deveria bastar (o layout de `/app` e
 * compartilhado por `/app/s/[serverId]` e `/app/amigos`). Mas o App Router
 * remonta esse layout na troca entre um e outro — o socket fechava, o gateway
 * tirava a pessoa da voz, e o provedor reconectava e re-entrava na hora. O
 * sintoma era "a chamada pisca e volta, com barulho" ao clicar no icone da
 * home. Aqui em cima isso nao acontece: so monta ao ENTRAR em `/app` e so
 * desmonta ao SAIR (login, marketing, convite).
 *
 * Fora de `/app` nao ha socket nem `<VoiceSession>` — as telas de entrar,
 * legais e de convite nao precisam e nao devem abrir conexao.
 */
export function RealtimeRoot({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const dentroDoApp = pathname === "/app" || pathname.startsWith("/app/");

  if (!dentroDoApp) return <>{children}</>;

  return (
    <RealtimeProvider>
      <VoiceSession />
      <VoiceChimes />
      {/* chamada direta: mesmo motivo da VoiceSession — sobrevive a navegacao */}
      <ChamadaDmSession />
      <ChamadaDmOverlay />
      {children}
    </RealtimeProvider>
  );
}
