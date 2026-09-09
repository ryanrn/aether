"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Emoji } from "@/components/ui/emoji";
import { cn } from "@/lib/utils";

/**
 * Painel de emoji do AETHER — proprio, nao o `<Picker>` do emoji-mart.
 *
 * POR QUE PROPRIO. O grid do emoji-mart so desenha por SPRITESHEET, e as
 * coordenadas de recorte sumiram do `@emoji-mart/data` (v1.2.1: cada skin so
 * traz `unified` e `native`). Resultado: com set de imagem, TODO emoji caia no
 * recorte 0,0 — a tela inteira virava `#️⃣`. Aqui cada celula e o proprio
 * `<Emoji>` (o mesmo Twemoji da mensagem), entao o que se ve no seletor e
 * exatamente o que vai pro chat.
 *
 * So os DADOS continuam do `@emoji-mart/data` (catalogo + palavras-chave), e
 * carregados sob demanda — quem nunca abre nao paga os ~40 KB.
 *
 * Sem portal / posicao / fechar-fora: isso e do chamador (`EmojiPicker` para
 * reacao, `MediaPicker` para o composer).
 */

interface DadosEmoji {
  categorias: { id: string; emojis: string[] }[];
  porId: Record<
    string,
    { name: string; keywords: string[]; skins: { native: string }[] }
  >;
  i18nCategorias: Record<string, string>;
  rotuloBusca: string;
}

const RECENTES_KEY = "aether:emoji-recentes";
const MAX_RECENTES = 30;

/** Emoji que representa cada aba na barra de navegacao. */
const REPRESENTANTE: Record<string, string> = {
  recentes: "\u{1F551}",
  people: "\u{1F600}",
  nature: "\u{1F43B}",
  foods: "\u{1F354}",
  activity: "⚽",
  places: "✈️",
  objects: "\u{1F4A1}",
  symbols: "❤️",
  flags: "\u{1F3F3}️",
};

function lerRecentes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const cru = window.localStorage.getItem(RECENTES_KEY);
    const lista = cru ? (JSON.parse(cru) as unknown) : [];
    return Array.isArray(lista)
      ? lista.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function registrarRecente(native: string) {
  if (typeof window === "undefined") return;
  try {
    const atual = lerRecentes().filter((e) => e !== native);
    atual.unshift(native);
    window.localStorage.setItem(
      RECENTES_KEY,
      JSON.stringify(atual.slice(0, MAX_RECENTES)),
    );
  } catch {
    /* modo privado */
  }
}

export function PainelDeEmoji({
  onEscolher,
}: {
  onEscolher: (native: string) => void;
}) {
  const [dados, setDados] = useState<DadosEmoji | null>(null);
  const [aba, setAba] = useState("recentes");
  const [busca, setBusca] = useState("");
  const [recentes, setRecentes] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRecentes(lerRecentes());
    let vivo = true;
    void Promise.all([
      import("@emoji-mart/data"),
      import("@emoji-mart/data/i18n/pt.json"),
    ]).then(([mod, i18n]) => {
      if (!vivo) return;
      const d = mod.default as {
        categories: { id: string; emojis: string[] }[];
        emojis: DadosEmoji["porId"];
      };
      setDados({
        categorias: d.categories,
        porId: d.emojis,
        i18nCategorias: i18n.default.categories as Record<string, string>,
        rotuloBusca: (i18n.default as { search: string }).search,
      });
    });
    return () => {
      vivo = false;
    };
  }, []);

  /** indice simples de busca — nome/palavras-chave em ingles (limitacao v1). */
  const indice = useMemo(() => {
    if (!dados) return [];
    return Object.entries(dados.porId).map(([id, e]) => ({
      native: e.skins[0]?.native ?? "",
      tokens: `${id} ${e.name} ${e.keywords.join(" ")}`.toLowerCase(),
    }));
  }, [dados]);

  function escolher(native: string) {
    if (!native) return;
    registrarRecente(native);
    setRecentes(lerRecentes());
    onEscolher(native);
  }

  const termo = busca.trim().toLowerCase();
  const resultados = termo
    ? indice
        .filter((x) => x.native && x.tokens.includes(termo))
        .slice(0, 120)
        .map((x) => x.native)
    : null;

  const abas = dados
    ? ["recentes", ...dados.categorias.map((c) => c.id)]
    : ["recentes"];

  const emojisDaAba =
    aba === "recentes"
      ? recentes
      : (dados?.categorias
          .find((c) => c.id === aba)
          ?.emojis.map((id) => dados.porId[id]?.skins[0]?.native ?? "")
          .filter(Boolean) ?? []);

  return (
    <div className="flex h-full flex-col">
      {/* busca */}
      <div className="shrink-0 p-2">
        <div className="flex items-center gap-2 rounded-md border border-line bg-base-950 px-2.5">
          <AetherIcon name="search" className="h-3.5 w-3.5 text-ink-500" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={dados?.rotuloBusca ?? "Procurar"}
            className="h-8 flex-1 bg-transparent text-[13px] text-ink-100 outline-none placeholder:text-ink-600"
          />
          {busca ? (
            <button
              type="button"
              aria-label="Limpar"
              onClick={() => setBusca("")}
              className="text-ink-500 hover:text-ink-200"
            >
              <AetherIcon name="x" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* navegacao por categoria — some durante a busca */}
      {!termo ? (
        <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-2 pb-1.5">
          {abas.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setAba(id);
                scrollRef.current?.scrollTo({ top: 0 });
              }}
              title={
                id === "recentes"
                  ? "Usados recentemente"
                  : (dados?.i18nCategorias[id] ?? id)
              }
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors",
                aba === id ? "bg-base-750" : "hover:bg-base-850",
              )}
            >
              <Emoji char={REPRESENTANTE[id] ?? "⭐"} className="!h-[18px] !w-[18px]" />
            </button>
          ))}
        </div>
      ) : null}

      {/* grade */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {termo ? (
          <Grade emojis={resultados ?? []} onEscolher={escolher} vazio="Nenhum emoji." />
        ) : (
          <>
            <p className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-500">
              {aba === "recentes"
                ? "Usados recentemente"
                : (dados?.i18nCategorias[aba] ?? aba)}
            </p>
            <Grade
              emojis={emojisDaAba}
              onEscolher={escolher}
              vazio={
                aba === "recentes"
                  ? "Os emojis que voce usar aparecem aqui."
                  : "..."
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

function Grade({
  emojis,
  onEscolher,
  vazio,
}: {
  emojis: string[];
  onEscolher: (native: string) => void;
  vazio: string;
}) {
  if (emojis.length === 0) {
    return (
      <p className="px-2 py-8 text-center text-[12px] text-ink-500">{vazio}</p>
    );
  }
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((native, i) => (
        <button
          key={`${native}-${i}`}
          type="button"
          onClick={() => onEscolher(native)}
          className="grid aspect-square place-items-center rounded-md text-[20px] leading-none transition-colors hover:bg-base-750"
        >
          <Emoji char={native} className="!h-[22px] !w-[22px]" />
        </button>
      ))}
    </div>
  );
}
