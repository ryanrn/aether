"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { BRAND } from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { reenviarVerificacaoAction } from "@/server/actions/verificacao";
import { logoutAction } from "@/server/actions/auth";

/**
 * A parede que a conta nao confirmada ve no lugar do app.
 *
 * Renderizada pelo layout de `/app` quando `precisaVerificarEmail`. Nao ha
 * nada do app aqui — trilha, servidores, socket, nada. Duas saidas: confirmar
 * pelo link do e-mail (e voltar aqui e clicar "ja confirmei"), ou sair.
 */
export function ParedeDeVerificacao({ email }: { email: string }) {
  const router = useRouter();
  const [reenviando, startReenvio] = useTransition();
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(
    null,
  );

  function reenviar() {
    setMsg(null);
    startReenvio(async () => {
      const r = await reenviarVerificacaoAction();
      setMsg(
        r.ok
          ? { tipo: "ok", texto: "E-mail reenviado. Confira a caixa de entrada e o spam." }
          : { tipo: "erro", texto: r.error },
      );
    });
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-base-950 px-4 py-10">
      <div className="w-full max-w-[420px]">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-md border border-accent-600/40 bg-accent-500/10">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-accent-500 shadow-[0_0_12px_var(--color-accent-500)]" />
          </span>
          <span className="font-brand text-[17px] font-bold tracking-[0.2em] text-ink-100">
            {BRAND.name}
          </span>
        </Link>

        <div className="rounded-lg border border-line bg-base-850 p-6">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-accent-500/12">
            <AetherIcon name="mail" className="h-5 w-5 text-accent-300" />
          </div>

          <h1 className="text-lg font-semibold text-ink-100">Confirme seu e-mail</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-400">
            Mandamos um link para <strong className="text-ink-200">{email}</strong>.
            Abra ele para liberar sua conta — o link vale por 24 horas.
          </p>

          {msg ? (
            <p
              className={`mt-4 text-[12px] ${
                msg.tipo === "ok" ? "text-signal-online" : "text-signal-dnd"
              }`}
            >
              {msg.texto}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => router.refresh()}
              className="flex items-center justify-center gap-2 rounded-sm bg-accent-500 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-600"
            >
              <AetherIcon name="refresh" className="h-4 w-4" />
              Já confirmei — atualizar
            </button>
            <button
              type="button"
              onClick={reenviar}
              disabled={reenviando}
              className="flex items-center justify-center gap-2 rounded-sm border border-line-strong px-4 py-2.5 text-[13px] font-medium text-ink-200 transition-colors hover:bg-base-800 disabled:opacity-50"
            >
              {reenviando ? (
                <>
                  <AetherIcon name="loader" className="h-4 w-4 animate-spin" />
                  Enviando…
                </>
              ) : (
                "Reenviar o e-mail"
              )}
            </button>
          </div>

          <form action={logoutAction} className="mt-4 border-t border-line-soft pt-4">
            <button
              type="submit"
              className="text-[12px] text-ink-500 transition-colors hover:text-ink-300"
            >
              Sair desta conta
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
