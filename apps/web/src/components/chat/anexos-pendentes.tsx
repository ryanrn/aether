"use client";

import { useMemo, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import type { PublicAttachment } from "@aether/shared";
import { cn } from "@/lib/utils";

/**
 * Um anexo enquanto ele ainda nao virou mensagem.
 *
 * O `estado` existe porque o envio tem tres momentos visiveis, e mostrar um so
 * deles seria mentir: `enviando` (subindo para o R2), `pronto` (chegou, da
 * para mandar) e `erro`. Sem isso, um arquivo grande ficaria parado na tela
 * sem sinal de vida, e a pessoa clicaria em enviar achando que ja foi.
 */
export interface AnexoPendente {
  /** id local enquanto sobe; vira o id do servidor quando confirma */
  chaveLocal: string;
  id: string | null;
  nome: string;
  tamanho: number;
  mime: string;
  estado: "enviando" | "pronto" | "erro";
  /** 0 a 1, so enquanto envia */
  progresso: number;
  erro?: string;
  /** `blob:` local, para ver a imagem antes de ela chegar ao servidor */
  previa?: string;
}

export function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function ehImagem(mime: string): boolean {
  return mime.startsWith("image/");
}

export function AnexosPendentes({
  anexos,
  onRemover,
}: {
  anexos: AnexoPendente[];
  onRemover: (chaveLocal: string) => void;
}) {
  if (anexos.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 border-b border-line px-3 pb-2.5 pt-1">
      {anexos.map((anexo) => (
        <div
          key={anexo.chaveLocal}
          className={cn(
            "group/anexo relative flex items-center gap-2 rounded-md border bg-base-950 py-1.5 pl-1.5 pr-2",
            anexo.estado === "erro" ? "border-signal-dnd/50" : "border-line",
          )}
        >
          {anexo.previa ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={anexo.previa}
              alt=""
              className="h-9 w-9 shrink-0 rounded object-cover"
            />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-base-850 text-ink-400">
              <AetherIcon name="file-text" className="h-4 w-4" />
            </span>
          )}

          <span className="min-w-0 max-w-[160px] leading-tight">
            <span className="block truncate text-[12px] text-ink-200">
              {anexo.nome}
            </span>
            <span className="block text-[10px] text-ink-500">
              {anexo.estado === "erro"
                ? (anexo.erro ?? "falhou")
                : anexo.estado === "enviando"
                  ? `${Math.round(anexo.progresso * 100)}%`
                  : formatarBytes(anexo.tamanho)}
            </span>
          </span>

          {anexo.estado === "enviando" ? (
            <AetherIcon
              name="loader"
              className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-500"
            />
          ) : null}

          <button
            type="button"
            onClick={() => onRemover(anexo.chaveLocal)}
            aria-label={`Remover ${anexo.nome}`}
            className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full border border-line bg-base-800 text-ink-400 opacity-0 transition-opacity hover:text-ink-100 group-hover/anexo:opacity-100 focus:opacity-100"
          >
            <AetherIcon name="x" className="h-2.5 w-2.5" strokeWidth={3} />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Os anexos JA ENVIADOS, dentro da mensagem.
 *
 * Imagem aparece; o resto vira cartao com nome e tamanho. A divisao segue o
 * `mime` COM QUE O OBJETO FOI GRAVADO, e nao o que o navegador declarou no
 * envio — o servidor regrava como `octet-stream` tudo o que nao for de um tipo
 * conhecido, justamente para nada alem de midia ser renderizado.
 */
export function AnexosDaMensagem({ anexos }: { anexos: PublicAttachment[] }) {
  /**
   * So as imagens, na ordem em que aparecem — e o que o visor navega com as
   * setas. `useMemo` para o array nao ser recriado a cada render (o
   * `ImageLightbox` guarda o indice contra ele).
   */
  const imagens = useMemo(
    () => anexos.filter((a) => ehImagem(a.mime)),
    [anexos],
  );
  const [visor, setVisor] = useState<number | null>(null);

  if (anexos.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {anexos.map((anexo) =>
        ehImagem(anexo.mime) ? (
          <button
            key={anexo.id}
            type="button"
            onClick={() =>
              setVisor(imagens.findIndex((i) => i.id === anexo.id))
            }
            className="block cursor-zoom-in overflow-hidden rounded-md border border-line transition-colors hover:border-line-strong"
            /**
             * O espaco e reservado ANTES de a imagem chegar, com as dimensoes
             * que o servidor guardou. Sem isso o chat pula a cada imagem que
             * carrega — o mesmo defeito de layout que ja custou uma
             * investigacao aqui.
             */
            style={
              anexo.largura && anexo.altura
                ? {
                    aspectRatio: `${anexo.largura} / ${anexo.altura}`,
                    width: "min(100%, 320px)",
                  }
                : undefined
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={anexo.url}
              alt={anexo.nome}
              loading="lazy"
              className="h-full w-full max-w-[320px] object-cover"
            />
          </button>
        ) : (
          <a
            key={anexo.id}
            href={anexo.url}
            target="_blank"
            rel="noreferrer noopener"
            /**
             * `download` com o nome original: o objeto no bucket tem nome
             * sorteado, e sem isto a pessoa baixaria `a3f9...bin`.
             */
            download={anexo.nome}
            className="flex max-w-[320px] items-center gap-2.5 rounded-md border border-line bg-base-900 px-3 py-2 transition-colors hover:border-line-strong"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-base-850 text-ink-400">
              <AetherIcon name="file-text" className="h-4 w-4" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[13px] text-accent-300">
                {anexo.nome}
              </span>
              <span className="block text-[11px] text-ink-500">
                {formatarBytes(anexo.tamanho)}
              </span>
            </span>
          </a>
        ),
      )}

      {imagens.length > 0 ? (
        <ImageLightbox
          images={imagens}
          open={visor !== null}
          startIndex={visor ?? 0}
          onClose={() => setVisor(null)}
        />
      ) : null}
    </div>
  );
}
