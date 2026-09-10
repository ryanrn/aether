"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AetherIcon } from "@/components/ui/aether-icon";
import { acceptInviteAction } from "@/server/actions/servers";

/**
 * "Aceitar convite" — o clique que cria a associacao.
 *
 * O servidor ja foi validado na previa; aqui o cliente so dispara a action
 * (que revalida TUDO de novo — convite, ban, duplicidade, limite) e navega
 * para o servidor. `router.push` em vez de `redirect` na action para a
 * navegacao ser client-side: no desktop, isso nao recarrega a janela nem
 * derruba uma call em andamento.
 */
export function AcceptInviteButton({ code }: { code: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function aceitar() {
    setErro(null);
    start(async () => {
      const r = await acceptInviteAction(code);
      if (r.ok) {
        router.replace(`/app/s/${r.data.serverId}`);
        return;
      }
      setErro(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={aceitar}
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-accent-500 px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-accent-400 disabled:opacity-60"
      >
        {pending ? (
          "Entrando..."
        ) : (
          <>
            <AetherIcon name="check" className="h-4 w-4" />
            Aceitar convite
          </>
        )}
      </button>
      {erro ? (
        <p className="text-center text-[12px] text-signal-dnd">{erro}</p>
      ) : null}
    </div>
  );
}
