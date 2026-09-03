"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AetherIcon } from "@/components/ui/aether-icon";
import { categoriaPorId, type ComunidadeNaVitrine } from "@aether/shared";
import { entrarNaComunidadeAction } from "@/server/actions/descoberta";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn, colorFromId } from "@/lib/utils";

/**
 * Um servidor na vitrine.
 *
 * A ESTRUTURA veio da maquete: banner, selo no canto, icone e nome, descricao,
 * e o rodape com online e total. As CORES nao — a maquete usa a paleta padrao
 * do Tailwind (`bg-gray-900`, `text-green-400`), e o app tem tokens proprios.
 * Portar cor de maquete e como o app ganha duas paletas.
 *
 * O BANNER E UM GRADIENTE derivado do id, e nao uma imagem enviada. Assim todo
 * servidor tem um banner desde o primeiro dia — sem upload, sem bucket novo, e
 * sem a vitrine ficar cheia de retangulos cinzas esperando alguem mandar arte.
 * Determinístico: o mesmo servidor tem sempre o mesmo banner.
 */
export function ComunidadeCard({
  comunidade,
}: {
  comunidade: ComunidadeNaVitrine;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const categoria = categoriaPorId(comunidade.categoria);
  const cor = colorFromId(comunidade.id);

  function entrar() {
    setErro(null);
    startTransition(async () => {
      const r = await entrarNaComunidadeAction(comunidade.id);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      router.push(`/app/s/${comunidade.id}`);
    });
  }

  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-line bg-base-750 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-[3px] hover:border-line-strong hover:shadow-[var(--shadow-pop)]">
      {/* Banner. `aria-hidden` porque nao carrega informacao — e cor. */}
      <div
        aria-hidden
        className="relative h-24 shrink-0"
        style={{
          backgroundImage: `linear-gradient(135deg, ${cor}, ${cor}18)`,
        }}
      >
        {comunidade.oficial ? (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-xs border border-amber-400/40 bg-base-950/70 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.03em] text-amber-300 shadow-[var(--shadow-sm)] backdrop-blur">
            <AetherIcon
              name="badge-check"
              className="h-3 w-3"
              strokeWidth={2.5}
            />
            Oficial
          </span>
        ) : null}
      </div>

      {/* icone que "pisa" no banner — mesma linguagem do editor de perfil */}
      <Avatar
        userId={comunidade.id}
        name={comunidade.nome}
        src={comunidade.iconUrl}
        size="lg"
        className="-mt-7 ml-5 rounded-md border-[3px] border-base-750 [&>div]:rounded-[9px]"
      />

      <div className="flex min-w-0 flex-1 flex-col px-5 pb-5 pt-2">
        <h3 className="mt-3 flex min-w-0 items-center gap-2 truncate font-brand text-[17px] font-semibold text-ink-100">
          {comunidade.nome}
        </h3>

        <p
          className={cn(
            "mt-1.5 line-clamp-2 min-h-[2.6rem] text-[13px] leading-snug",
            comunidade.descricao ? "text-ink-300" : "text-ink-500 italic",
          )}
        >
          {comunidade.descricao ?? "Sem descricao."}
        </p>

        <div className="my-4 flex items-center gap-4 text-[12px] text-ink-300">
          {comunidade.online !== null ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-signal-online" />
              <span className="font-mono font-semibold text-ink-200 tabular-nums">
                {comunidade.online.toLocaleString("pt-BR")}
              </span>{" "}
              online
            </span>
          ) : null}
          <span>
            <span className="font-mono font-semibold text-ink-200 tabular-nums">
              {comunidade.membros.toLocaleString("pt-BR")}
            </span>{" "}
            {comunidade.membros === 1 ? "membro" : "membros"}
          </span>
          {categoria ? (
            <span className="text-ink-400">{categoria.nome}</span>
          ) : null}
        </div>

        {erro ? (
          <p className="mb-2 text-[12px] text-signal-dnd">{erro}</p>
        ) : null}

        <Button
          type="button"
          size="sm"
          variant={comunidade.souMembro ? "primary" : "outline"}
          onClick={
            comunidade.souMembro
              ? () => router.push(`/app/s/${comunidade.id}`)
              : entrar
          }
          disabled={pending}
          className="mt-auto w-full"
        >
          {comunidade.souMembro ? "Abrir" : pending ? "Entrando..." : "Entrar"}
        </Button>
      </div>
    </article>
  );
}
