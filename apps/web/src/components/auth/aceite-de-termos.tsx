"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { aceitarTermosAction } from "@/server/actions/legal";
import { logoutAction } from "@/server/actions/auth";

/**
 * Modal de (re)aceite dos Termos. Renderizado pelo layout de `/app` quando
 * `precisaAceitarTermos` — nulo ou versao antiga. Bloqueia: as unicas saidas
 * sao aceitar ou sair. Sem `<dialog>` nem `Esc`: nao ha "fechar".
 */
export function AceiteDeTermos({ atualizados }: { atualizados: boolean }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, start] = useTransition();

  function aceitar() {
    setErro(null);
    start(async () => {
      const r = await aceitarTermosAction();
      if (r.ok) router.refresh();
      else setErro(r.error);
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-[2px]">
      <div className="w-full max-w-[440px] rounded-lg border border-line-strong bg-base-850 p-6">
        <div className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-accent-500/12">
          <AetherIcon name="file-text" className="h-5 w-5 text-accent-300" />
        </div>

        <h1 className="text-lg font-semibold text-ink-100">
          {atualizados ? "Os Termos mudaram" : "Antes de continuar"}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-400">
          {atualizados
            ? "Atualizamos os Termos de Uso e a Política de Privacidade. Dê uma olhada e confirme para continuar usando o AETHER."
            : "Para usar o AETHER, você precisa aceitar os Termos de Uso e a Política de Privacidade."}
        </p>

        <div className="mt-4 flex flex-col gap-1.5 text-[13px]">
          <a
            href="/termos"
            target="_blank"
            className="flex items-center gap-2 text-accent-300 underline"
          >
            <AetherIcon name="link" className="h-3.5 w-3.5" />
            Termos de Uso
          </a>
          <a
            href="/privacidade"
            target="_blank"
            className="flex items-center gap-2 text-accent-300 underline"
          >
            <AetherIcon name="link" className="h-3.5 w-3.5" />
            Política de Privacidade
          </a>
        </div>

        {erro ? <p className="mt-3 text-[12px] text-signal-dnd">{erro}</p> : null}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={aceitar}
            disabled={enviando}
            className="rounded-sm bg-accent-500 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
          >
            {enviando ? "Registrando…" : "Li e aceito"}
          </button>
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full text-[12px] text-ink-500 transition-colors hover:text-ink-300"
            >
              Sair
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
