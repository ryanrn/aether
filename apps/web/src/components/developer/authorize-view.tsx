"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AetherIcon } from "@/components/ui/aether-icon";
import { initials, colorFromId, cn } from "@/lib/utils";
import {
  desinstalarBotAction,
  instalarBotAction,
} from "@/server/actions/developer";

interface AppInfo {
  id: string;
  name: string;
  descricao: string | null;
  avatarUrl: string | null;
}
interface ServidorInfo {
  id: string;
  name: string;
  iconUrl: string | null;
  jaInstalado: boolean;
}

/**
 * A tela de "instalar bot no servidor".
 *
 * Cartao do app + lista dos servidores onde a pessoa tem "Gerenciar servidor".
 * Instalar/remover chama a action, que revalida a permissao no servidor. A
 * navegacao pos-sucesso e client-side (nao recarrega, nao derruba call).
 */
export function AuthorizeView({
  app,
  servidores,
}: {
  app: AppInfo;
  servidores: ServidorInfo[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [escolhido, setEscolhido] = useState<string | null>(
    servidores.find((s) => !s.jaInstalado)?.id ??
      servidores[0]?.id ??
      null,
  );
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ serverId: string } | null>(null);

  const alvo = servidores.find((s) => s.id === escolhido) ?? null;

  function instalar() {
    if (!alvo) return;
    setErro(null);
    start(async () => {
      const r = await instalarBotAction({
        applicationId: app.id,
        serverId: alvo.id,
      });
      if (r.ok) setFeito({ serverId: r.data.serverId });
      else setErro(r.error);
    });
  }

  function remover() {
    if (!alvo) return;
    setErro(null);
    start(async () => {
      const r = await desinstalarBotAction({
        applicationId: app.id,
        serverId: alvo.id,
      });
      if (r.ok) router.refresh();
      else setErro(r.error);
    });
  }

  return (
    <div className="flex min-h-full items-start justify-center p-6">
      <div className="w-full max-w-[440px] rounded-xl border border-line bg-base-850 p-6">
        {/* app */}
        <div className="flex items-center gap-3">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl text-[15px] font-semibold text-ink-100"
            style={
              app.avatarUrl
                ? undefined
                : { backgroundColor: colorFromId(app.id) }
            }
          >
            {app.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={app.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              initials(app.name)
            )}
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">
              Instalar aplicativo
            </p>
            <h1 className="truncate font-brand text-[17px] font-semibold text-ink-100">
              {app.name}
            </h1>
          </div>
        </div>
        {app.descricao ? (
          <p className="mt-3 text-[13px] leading-relaxed text-ink-400">
            {app.descricao}
          </p>
        ) : null}

        {feito ? (
          <div className="mt-6 text-center">
            <p className="text-[13px] text-ink-200">
              <strong className="text-ink-100">{app.name}</strong> foi instalado.
            </p>
            <button
              type="button"
              onClick={() => router.replace(`/app/s/${feito.serverId}`)}
              className="mt-3 inline-flex items-center gap-2 rounded-md bg-accent-500 px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-accent-400"
            >
              Abrir o servidor
            </button>
          </div>
        ) : servidores.length === 0 ? (
          <p className="mt-6 rounded-md border border-line bg-base-800 px-3 py-2.5 text-center text-[13px] text-ink-400">
            Você precisa da permissão <strong>Gerenciar servidor</strong> em
            algum servidor para instalar um bot.
          </p>
        ) : (
          <>
            <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">
              Adicionar a
            </p>
            <div className="mt-2 flex flex-col gap-1">
              {servidores.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setEscolhido(s.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors",
                    escolhido === s.id
                      ? "border-accent-500 bg-accent-500/[0.08]"
                      : "border-line hover:bg-base-800",
                  )}
                >
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg text-[11px] font-semibold text-ink-100"
                    style={
                      s.iconUrl
                        ? undefined
                        : { backgroundColor: colorFromId(s.id) }
                    }
                  >
                    {s.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.iconUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      initials(s.name)
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-200">
                    {s.name}
                  </span>
                  {s.jaInstalado ? (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.06em] text-signal-online">
                      Instalado
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-ink-500">
              O bot entra como membro com permissões de membro comum. Ajuste os
              cargos e canais dele depois, como faria com qualquer membro.
            </p>

            <div className="mt-4 flex flex-col gap-2">
              {alvo?.jaInstalado ? (
                <button
                  type="button"
                  onClick={remover}
                  disabled={pending}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-signal-dnd/40 px-4 py-2.5 text-[13px] font-bold text-signal-dnd transition-colors hover:bg-signal-dnd/10 disabled:opacity-60"
                >
                  {pending ? "Removendo…" : "Remover do servidor"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={instalar}
                  disabled={pending || !alvo}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-accent-500 px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-accent-400 disabled:opacity-60"
                >
                  {pending ? (
                    "Instalando…"
                  ) : (
                    <>
                      <AetherIcon name="check" className="h-4 w-4" />
                      Instalar
                    </>
                  )}
                </button>
              )}
              {erro ? (
                <p className="text-center text-[12px] text-signal-dnd">{erro}</p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
