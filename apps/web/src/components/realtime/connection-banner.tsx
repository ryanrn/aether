"use client";

import { useEffect, useState } from "react";
import { Loader2, MicOff, WifiOff } from "lucide-react";
import {
  useConnectionStatus,
  useRealtimeStore,
} from "@/lib/stores/realtime-store";
import { useSocket } from "@/components/realtime/realtime-provider";
import { cn } from "@/lib/utils";

/**
 * Faixa de estado da conexao.
 *
 * Existe porque o sintoma de "gateway fora do ar" era invisivel demais: o
 * campo de mensagem se desabilitava e a unica pista era um texto cinza no
 * placeholder. Quem tentava escrever nao descobria o motivo.
 *
 * Nao aparece de imediato. Toda carga de pagina passa por "connecting" por
 * algumas centenas de milissegundos, e piscar um aviso vermelho a cada
 * navegacao treinaria a pessoa a ignorar o aviso. So depois do periodo de
 * carencia e que a faixa entra.
 */
const GRACE_MS = 1500;

export function ConnectionBanner() {
  const status = useConnectionStatus();
  const error = useRealtimeStore((state) => state.error);
  const voiceError = useRealtimeStore((state) => state.voiceError);
  const socket = useSocket();
  const [showSlowState, setShowSlowState] = useState(false);

  useEffect(() => {
    if (status === "online") {
      setShowSlowState(false);
      return;
    }
    const timer = setTimeout(() => setShowSlowState(true), GRACE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // Erro de servidor ou de microfone vale aviso mesmo com a conexao de pe.
  const problem = error ?? voiceError;
  if (status === "online" && !problem) return null;
  if (status !== "online" && !showSlowState) return null;

  const offline = status === "offline";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-[12px]",
        // Microfone bloqueado e aviso, nao falha: a call continua funcionando.
        offline || error
          ? "border-signal-dnd/25 bg-signal-dnd/10 text-signal-dnd"
          : "border-signal-idle/25 bg-signal-idle/10 text-signal-idle",
      )}
    >
      {voiceError && !offline && !error ? (
        <MicOff className="h-3.5 w-3.5 shrink-0" />
      ) : offline || error ? (
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      )}

      <span className="min-w-0 flex-1 truncate">
        {problem
          ? problem
          : offline
            ? "Sem conexao com o tempo real. Mensagens e presenca estao parados enquanto isso — tentando reconectar."
            : "Conectando ao tempo real..."}
      </span>

      {offline ? (
        <button
          type="button"
          // Forca uma tentativa agora em vez de esperar o proximo passo do
          // backoff, que pode estar em 8 segundos.
          onClick={() => socket?.connect()}
          className="shrink-0 rounded-sm border border-signal-dnd/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors hover:bg-signal-dnd/15"
        >
          tentar agora
        </button>
      ) : null}
    </div>
  );
}
