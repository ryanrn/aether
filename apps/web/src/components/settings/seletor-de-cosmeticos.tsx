"use client";

import { useEffect, useState, useTransition } from "react";
import {
  ROTULO_COSMETIC_TYPE,
  raridadePorId,
  type CosmeticoDeLoja,
  type CosmeticType,
} from "@aether/shared";
import { AvatarDecorado } from "@/components/profile/avatar-decorado";
import {
  equiparCosmeticoAction,
  listarCatalogoDeCosmeticosAction,
} from "@/server/actions/profile";
import { cn } from "@/lib/utils";

/**
 * O seletor de DECORACAO ou BANNER na tela "Minha conta".
 *
 * So aparece com a flag `loja_de_cosmeticos` ligada — a action devolve lista
 * vazia quando ela esta desligada, e ai este componente nao renderiza nada.
 *
 * Como o seletor de molduras logo ao lado: mostra o catalogo INTEIRO. O que o
 * plano nao alcanca vem apagado e nao clica; a autorizacao de verdade e a
 * action. `equipar` e otimista e volta atras se o servidor recusar.
 */
export function SeletorDeCosmeticos({
  tipo,
  avatarUrl,
  nome,
  userId,
  onEquipar,
}: {
  tipo: CosmeticType;
  /** para compor a decoracao sobre a foto real no thumbnail */
  avatarUrl: string | null;
  nome: string;
  userId: string;
  /** avisa o preview do avatar la em cima qual peca ficou (ou `null`) */
  onEquipar?: (item: CosmeticoDeLoja | null) => void;
}) {
  const [itens, setItens] = useState<CosmeticoDeLoja[] | null>(null);
  const [equipadoId, setEquipadoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void listarCatalogoDeCosmeticosAction(tipo).then((r) => {
      if (!r.ok) return;
      setItens(r.data);
      const eq = r.data.find((c) => c.equipado) ?? null;
      setEquipadoId(eq?.id ?? null);
      onEquipar?.(eq);
    });
    // onEquipar e estavel o suficiente na pratica; nao entra nas deps para nao
    // recarregar em loop se o pai recriar a funcao.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  if (itens === null || itens.length === 0) return null;

  function equipar(id: string | null) {
    const anterior = equipadoId;
    setEquipadoId(id);
    setErro(null);
    onEquipar?.(id ? (itens!.find((c) => c.id === id) ?? null) : null);
    startTransition(async () => {
      const r = await equiparCosmeticoAction(tipo, id);
      if (!r.ok) {
        setEquipadoId(anterior);
        onEquipar?.(anterior ? (itens!.find((c) => c.id === anterior) ?? null) : null);
        setErro(r.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">
        {ROTULO_COSMETIC_TYPE[tipo]}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => equipar(null)}
          disabled={pending}
          aria-pressed={equipadoId === null}
          title={`Sem ${tipo === "DECORATION" ? "decoração" : "banner"}`}
          className={cn(
            "grid h-11 w-11 place-items-center rounded-md border text-[10px] text-ink-500 transition-colors",
            equipadoId === null
              ? "border-accent-400 bg-base-800"
              : "border-line hover:bg-base-850",
          )}
        >
          —
        </button>

        {itens.map((c) => {
          const usavel = c.possui && !c.bloqueado;
          const ativa = equipadoId === c.id;
          const rar = raridadePorId(c.raridade);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => usavel && equipar(c.id)}
              disabled={pending || !usavel}
              aria-pressed={ativa}
              title={
                c.bloqueado
                  ? `${c.nome} — pede um plano superior`
                  : !c.possui
                    ? `${c.nome} — na loja`
                    : c.nome
              }
              className={cn(
                "relative grid h-11 w-11 place-items-center overflow-hidden rounded-md border transition-transform",
                ativa
                  ? "border-accent-400 ring-1 ring-accent-400"
                  : "border-line hover:bg-base-850",
                usavel ? "hover:scale-105" : "cursor-not-allowed opacity-40",
              )}
              style={rar ? { boxShadow: `inset 0 -2px 0 0 ${rar.cor}` } : undefined}
            >
              {tipo === "BANNER" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.thumbUrl ?? c.assetUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <AvatarDecorado
                  userId={userId}
                  name={nome}
                  src={avatarUrl}
                  px={26}
                  decoracao={{ frenteUrl: c.assetUrl, trasUrl: c.assetTrasUrl }}
                />
              )}
              {!usavel ? (
                <span className="absolute inset-0 grid place-items-center bg-base-950/40 text-[11px]">
                  &#128274;
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {erro ? <p className="text-[12px] text-signal-dnd">{erro}</p> : null}
    </div>
  );
}
