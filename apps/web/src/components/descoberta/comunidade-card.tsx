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
    <article className="flex flex-col overflow-hidden rounded-lg border border-line bg-base-900 transition-colors hover:border-line">
      {/* Banner. `aria-hidden` porque nao carrega informacao — e cor. */}
      <div
        aria-hidden
        className="relative h-20 shrink-0"
        style={{
          backgroundImage: `linear-gradient(135deg, ${cor}, ${cor}22)`,
        }}
      >
        {comunidade.oficial ? (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-base-950/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-amber-300 backdrop-blur">
            <AetherIcon
              name="badge-check"
              className="h-3 w-3"
              strokeWidth={2.5}
            />
            Oficial
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2">
          {/*
            O mesmo Avatar do resto do app, e nao uma <img> propria: ele ja
            resolve iniciais quando nao ha icone, e o servidor sem icone e o
            caso comum de quem acabou de criar.
          */}
          <Avatar
            userId={comunidade.id}
            name={comunidade.nome}
            src={comunidade.iconUrl}
            size="sm"
          />
          <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink-100">
            {comunidade.nome}
          </h3>
        </div>

        <p
          className={cn(
            "line-clamp-2 min-h-[2.5rem] text-[12px] leading-relaxed",
            comunidade.descricao ? "text-ink-400" : "text-ink-600 italic",
          )}
        >
          {comunidade.descricao ?? "Sem descricao."}
        </p>

        <div className="flex items-center gap-2 text-[11px] text-ink-500">
          {/*
            `online` NULO some, e nao vira zero: a presenca vive na memoria do
            gateway, e se ele nao respondeu, dizer "0 online" seria afirmar
            algo falso sobre uma comunidade cheia.
          */}
          {comunidade.online !== null ? (
            <>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-signal-online" />
                <span className="text-ink-300">{comunidade.online}</span> online
              </span>
              <span className="text-ink-700">·</span>
            </>
          ) : null}
          <span>
            <span className="text-ink-300">{comunidade.membros}</span>{" "}
            {comunidade.membros === 1 ? "membro" : "membros"}
          </span>
          {categoria ? (
            <>
              <span className="text-ink-700">·</span>
              <span>{categoria.nome}</span>
            </>
          ) : null}
        </div>

        {erro ? <p className="text-[11px] text-signal-dnd">{erro}</p> : null}

        <Button
          type="button"
          size="sm"
          variant={comunidade.souMembro ? "outline" : "primary"}
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
