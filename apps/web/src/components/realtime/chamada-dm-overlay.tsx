"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Avatar } from "@/components/ui/avatar";
import { BotaoRedondo } from "@/components/chat/chamada-dm";
import { useChamadaDmStore } from "@/lib/stores/chamada-dm-store";
import { useChamadaDm } from "@/lib/voice/use-chamada-dm";

/**
 * A chamada direta vista de FORA da conversa.
 *
 *  - Tocando: cartao flutuante com Atender/Recusar, em qualquer tela de
 *    `/app` — quem esta num servidor tambem precisa ver que estao ligando.
 *  - Em chamada (ou chamando) e olhando outra tela: uma pilula com o nome,
 *    atalho de volta para a conversa e o botao de desligar.
 *
 * Dentro da propria conversa nada disso aparece: o `PainelChamadaDm` ja
 * mostra tudo, e dois controles da mesma chamada na mesma tela confundem.
 */
export function ChamadaDmOverlay() {
  const pathname = usePathname();
  const { chamada, atender, encerrar } = useChamadaDm();
  const conectado = useChamadaDmStore((estado) => estado.conectado);

  if (!chamada) return null;
  const naConversa = pathname === `/app/dm/${chamada.dmId}`;
  if (naConversa) return null;

  const { outro } = chamada;

  if (chamada.fase === "recebendo" || chamada.fase === "atendendo") {
    return (
      <div
        role="alertdialog"
        aria-label={`Chamada de ${outro.displayName}`}
        className="fixed left-1/2 top-4 z-[70] flex w-[min(320px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-base-850 p-3 shadow-2xl"
      >
        <div className="animate-pulse rounded-full">
          <Avatar
            userId={outro.id}
            name={outro.displayName}
            src={outro.avatarUrl}
            moldura={outro.moldura}
            size="md"
            round
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink-100">
            {outro.displayName}
          </p>
          <p className="text-[12px] text-ink-400">
            {chamada.fase === "atendendo" ? "Conectando..." : "Chamada de voz"}
          </p>
        </div>
        <BotaoRedondo onClick={encerrar} label="Recusar" tom="perigo">
          <AetherIcon name="disconnect" />
        </BotaoRedondo>
        <BotaoRedondo onClick={atender} label="Atender" tom="positivo">
          <AetherIcon name="phone" />
        </BotaoRedondo>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[70] flex max-w-[calc(100vw-32px)] items-center gap-2 rounded-full border border-line bg-base-850 py-1.5 pl-1.5 pr-2 shadow-2xl">
      <Link
        href={`/app/dm/${chamada.dmId}`}
        className="flex min-w-0 items-center gap-2 rounded-full pr-1 hover:opacity-90"
        title="Voltar para a conversa"
      >
        <Avatar
          userId={outro.id}
          name={outro.displayName}
          src={outro.avatarUrl}
          moldura={outro.moldura}
          size="sm"
          round
        />
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-medium text-ink-100">
            {outro.displayName}
          </span>
          <span className="block text-[11px] text-signal-online">
            {chamada.fase === "chamando"
              ? "Chamando..."
              : conectado
                ? "Em chamada"
                : "Conectando..."}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={encerrar}
        title={chamada.fase === "chamando" ? "Cancelar chamada" : "Desligar"}
        aria-label={chamada.fase === "chamando" ? "Cancelar chamada" : "Desligar"}
        className="grid h-8 w-8 place-items-center rounded-full bg-signal-dnd text-white hover:brightness-110"
      >
        <AetherIcon name="disconnect" size="sm" />
      </button>
    </div>
  );
}
