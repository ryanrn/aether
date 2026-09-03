"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AetherIcon, type AetherIconName } from "@/components/ui/aether-icon";
import {
  carregarIndiceDeNavegacao,
  type ItemDeNavegacao,
} from "@/server/actions/navegacao";
import { cn, colorFromId, initials } from "@/lib/utils";

/**
 * Trocador rapido — Ctrl+K.
 *
 * O atalho que mais faz um app parecer PROGRAMA e nao pagina: pular para
 * qualquer canal, servidor ou conversa sem tirar a mao do teclado nem procurar
 * na arvore.
 *
 * O INDICE VEM DO SERVIDOR, e nao do que a tela conhece. O cliente so tem os
 * canais do servidor aberto — um trocador que so enxerga onde voce ja esta nao
 * serve para nada. Ver `server/actions/navegacao.ts`, que tambem e quem aplica
 * a permissao canal a canal.
 */

/** Quantos itens desenhar. Passar disso vira rolagem sem fim e nao ajuda. */
const MAXIMO = 12;

export function QuickSwitcher() {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [itens, setItens] = useState<ItemDeNavegacao[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [destaque, setDestaque] = useState(0);
  const router = useRouter();

  /**
   * Foco por ref de CALLBACK, e nao `requestAnimationFrame` depois de montar.
   *
   * O React chama isto no instante em que prende o campo no documento, entao
   * nao ha palpite de tempo: nao existe quadro em que o atalho ja abriu a
   * caixa mas o teclado ainda escreve na pagina atras. A versao com `rAF`
   * dependia do laco de quadros estar rodando — e ele PARA em aba escondida.
   */
  const focarCampo = useCallback((campo: HTMLInputElement | null) => {
    campo?.focus();
  }, []);

  /**
   * Carrega ao ABRIR, e nao uma vez so.
   *
   * Canal criado, servidor novo, amizade desfeita — tudo isso muda o indice, e
   * um cache eterno mostraria destino que nao existe mais (ou esconderia um
   * novo). A lista anterior fica na tela enquanto a nova chega, entao a
   * segunda abertura em diante nao tem espera visivel.
   */
  const carregar = useCallback(async () => {
    setCarregando(true);
    const resultado = await carregarIndiceDeNavegacao();
    if (resultado.ok) setItens(resultado.data.itens);
    setCarregando(false);
  }, []);

  /** O atalho global. */
  useEffect(() => {
    function naTecla(evento: KeyboardEvent) {
      const combo =
        (evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "k";
      if (!combo) return;
      /**
       * `preventDefault` porque Ctrl+K e a busca do navegador em algumas
       * versoes e o "abrir link" em outras. Sem isto o atalho abriria as duas
       * coisas ao mesmo tempo.
       */
      evento.preventDefault();
      setAberto((atual) => !atual);
    }
    document.addEventListener("keydown", naTecla);
    return () => document.removeEventListener("keydown", naTecla);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    setBusca("");
    setDestaque(0);
    void carregar();
  }, [aberto, carregar]);

  if (!aberto) return null;
  if (typeof document === "undefined") return null;

  const termo = busca.trim().toLowerCase();
  const filtrados = (itens ?? [])
    .filter((item) => {
      if (!termo) return true;
      return (
        item.titulo.toLowerCase().includes(termo) ||
        (item.subtitulo ?? "").toLowerCase().includes(termo)
      );
    })
    .slice(0, MAXIMO);

  function escolher(item: ItemDeNavegacao) {
    setAberto(false);
    router.push(item.href);
  }

  function navegarComTeclado(evento: React.KeyboardEvent) {
    if (evento.key === "Escape") {
      setAberto(false);
      return;
    }
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setDestaque((d) => (filtrados.length ? (d + 1) % filtrados.length : 0));
      return;
    }
    if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setDestaque((d) =>
        filtrados.length ? (d - 1 + filtrados.length) % filtrados.length : 0,
      );
      return;
    }
    if (evento.key === "Enter") {
      evento.preventDefault();
      const alvo = filtrados[destaque];
      if (alvo) escolher(alvo);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 pt-[12vh]"
      onMouseDown={(evento) => {
        // So fecha quando o clique comeca no FUNDO — arrastar de dentro para
        // fora nao pode fechar no meio de uma selecao.
        if (evento.target === evento.currentTarget) setAberto(false);
      }}
    >
      <div className="w-full max-w-[540px] overflow-hidden rounded-lg border border-line bg-base-900 shadow-pop">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          {carregando && !itens ? (
            <AetherIcon
              name="loader"
              className="h-4 w-4 shrink-0 animate-spin text-ink-500"
            />
          ) : (
            <AetherIcon
              name="search"
              className="h-4 w-4 shrink-0 text-ink-500"
            />
          )}
          <input
            ref={focarCampo}
            value={busca}
            onChange={(evento) => {
              setBusca(evento.target.value);
              // Volta ao topo a cada tecla: o destaque na quinta linha nao faz
              // sentido depois que a lista inteira mudou.
              setDestaque(0);
            }}
            onKeyDown={navegarComTeclado}
            placeholder="Ir para canal, servidor ou conversa..."
            aria-label="Ir para"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink-100 outline-none placeholder:text-ink-500"
          />
          <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
            esc
          </kbd>
        </div>

        <ul className="max-h-[52vh] overflow-y-auto p-1.5">
          {filtrados.map((item, indice) => (
            <li key={`${item.tipo}:${item.id}`}>
              <button
                type="button"
                onMouseEnter={() => setDestaque(indice)}
                onClick={() => escolher(item)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left",
                  indice === destaque ? "bg-base-800" : "hover:bg-base-850",
                )}
              >
                <Marca item={item} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] text-ink-100">
                    {item.titulo}
                  </span>
                  {item.subtitulo ? (
                    <span className="block truncate text-[11px] text-ink-500">
                      {item.subtitulo}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}

          {filtrados.length === 0 ? (
            <li className="px-3 py-6 text-center text-[13px] text-ink-500">
              {carregando ? "Carregando..." : "Nada com esse nome."}
            </li>
          ) : null}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/** O simbolo a esquerda: diz o TIPO do destino antes de ler o nome. */
function Marca({ item }: { item: ItemDeNavegacao }) {
  if (item.tipo === "canal") {
    const nome: AetherIconName = item.variante === "VOICE" ? "voice" : "hash";
    return <AetherIcon name={nome} className="h-4 w-4 shrink-0 text-ink-500" />;
  }

  if (item.tipo === "conversa") {
    return item.iconUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.iconUrl}
        alt=""
        className="h-5 w-5 shrink-0 rounded-full object-cover"
      />
    ) : (
      <AetherIcon name="message" className="h-4 w-4 shrink-0 text-ink-500" />
    );
  }

  return item.iconUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={item.iconUrl}
      alt=""
      className="h-5 w-5 shrink-0 rounded-[5px] object-cover"
    />
  ) : (
    <span
      className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] text-[9px] font-bold text-ink-100"
      style={{ backgroundColor: colorFromId(item.id) }}
    >
      {initials(item.titulo)}
    </span>
  );
}
