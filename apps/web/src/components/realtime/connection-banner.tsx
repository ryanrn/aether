"use client";

import { AetherIcon } from "@/components/ui/aether-icon";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { cn } from "@/lib/utils";

/**
 * Faixa de PROBLEMA REAL — nao de "a conexao caiu".
 *
 * Uma queda de socket e um NAO-EVENTO de proposito, como o Discord: o
 * `socket.io-client` reconecta sozinho, infinito, com backoff (ver
 * `realtime-provider.tsx`), e ao reconectar ja religa a voz, resincroniza
 * presenca e cobre o buraco de mensagens perdidas — tudo automatico, sem
 * clique. Uma faixa vermelha nesse meio tempo so alarmaria por uma falha que
 * ja esta sendo corrigida por conta propria; e por isso que este componente
 * NUNCA reagiu a `useConnectionStatus()`. Quem tenta escrever durante a queda
 * ainda ve o sinal certo, so discreto: o placeholder do composer avisa
 * ("Sem conexao com o tempo real") e o campo desabilita — nao precisa de
 * banner por cima disso.
 *
 * O que fica aqui e so PROBLEMA QUE NAO SE RESOLVE SOZINHO: a entrada no
 * servidor foi recusada (`error`, do ack de `server:join`) ou algo da voz
 * falhou de um jeito que exige atencao (`voiceError` — mic bloqueado, SFU
 * fora do ar). Nenhum dos dois e "espere e ja volta".
 */
export function ConnectionBanner() {
  const error = useRealtimeStore((state) => state.error);
  const voiceError = useRealtimeStore((state) => state.voiceError);

  const problem = error ?? voiceError;
  if (!problem) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-[12px]",
        // Microfone bloqueado e aviso, nao falha: a call continua funcionando.
        error
          ? "border-signal-dnd/25 bg-signal-dnd/10 text-signal-dnd"
          : "border-signal-idle/25 bg-signal-idle/10 text-signal-idle",
      )}
    >
      <AetherIcon
        name={error ? "alert" : "volume-off"}
        size="sm"
        className="shrink-0"
      />
      <span className="min-w-0 flex-1 truncate">{problem}</span>
    </div>
  );
}
