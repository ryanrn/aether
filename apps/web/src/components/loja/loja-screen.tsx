"use client";

import { useMemo, useState, useTransition } from "react";
import {
  raridadePorId,
  type CosmeticoDeLoja,
  type CosmeticType,
  type PlanTier,
} from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { AvatarDecorado } from "@/components/profile/avatar-decorado";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import { equiparCosmeticoAction } from "@/server/actions/profile";
import { cn } from "@/lib/utils";

/**
 * A Loja de cosmeticos — Estagio 1.
 *
 * Reproduz a vitrine do redesign (OpenDesign) com o que o backend ja entrega:
 * decoracoes de avatar e banners, gratis ou plano-gated. SEM economia de
 * moedas — item pago que a pessoa nao possui mostra o preco e "em breve", e
 * nao equipa (so a equipe concede peca paga por enquanto).
 *
 * O trilho "Loja / Perfil" do mock NAO e reconstruido: o `HomeNavPanel` ja e
 * a navegacao do AETHER. Aqui e so o conteudo.
 *
 * `equiparCosmeticoAction` revalida TUDO no servidor (plano, posse, ativo) —
 * a tela so esconde o que seria recusado.
 */

type Aba = "destaques" | "DECORATION" | "BANNER" | "meus";

const ABAS: { id: Aba; label: string }[] = [
  { id: "destaques", label: "Destaques" },
  { id: "DECORATION", label: "Decorações" },
  { id: "BANNER", label: "Banners" },
  { id: "meus", label: "Meus cosméticos" },
];

const TIPO_LABEL: Record<CosmeticType, string> = {
  DECORATION: "Decoração",
  BANNER: "Banner",
};

const TIER_LABEL: Record<PlanTier, string> = {
  FREE: "",
  PLUS: "Requer AETHER Plus",
  PRO: "Requer AETHER Pro",
};

interface UserInfo {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  moldura: string | null;
}

/** peso da raridade, para ordenar "maior primeiro" */
function pesoRaridade(id: string): number {
  return raridadePorId(id)?.peso ?? 0;
}

export function LojaScreen({
  itens,
  plano: _plano,
  user,
}: {
  itens: CosmeticoDeLoja[];
  plano: PlanTier;
  user: UserInfo;
}) {
  const [aba, setAba] = useState<Aba>("destaques");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<{
    possui: boolean;
    naoPossui: boolean;
    equipado: boolean;
  }>({ possui: false, naoPossui: false, equipado: false });

  // Estado local do equipado, por tipo — otimista, volta atras se o servidor recusa.
  const [equipado, setEquipado] = useState<Record<CosmeticType, string | null>>(
    () => ({
      DECORATION: itens.find((c) => c.tipo === "DECORATION" && c.equipado)?.id ?? null,
      BANNER: itens.find((c) => c.tipo === "BANNER" && c.equipado)?.id ?? null,
    }),
  );
  const [previa, setPrevia] = useState<CosmeticoDeLoja | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const estaEquipado = (c: CosmeticoDeLoja) => equipado[c.tipo] === c.id;

  function equipar(c: CosmeticoDeLoja | null, tipo: CosmeticType) {
    const anterior = equipado[tipo];
    const novo = c ? c.id : null;
    setEquipado((e) => ({ ...e, [tipo]: novo }));
    setErro(null);
    startTransition(async () => {
      const r = await equiparCosmeticoAction(tipo, novo);
      if (!r.ok) {
        setEquipado((e) => ({ ...e, [tipo]: anterior }));
        setErro(r.error);
      }
    });
  }

  const filtrado = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return itens.filter((c) => {
      if (q && !c.nome.toLowerCase().includes(q)) return false;
      if (filtro.possui && !c.possui) return false;
      if (filtro.naoPossui && c.possui) return false;
      if (filtro.equipado && !estaEquipado(c)) return false;
      return true;
    });
    // `equipado` entra pela dependencia de `estaEquipado`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, busca, filtro, equipado]);

  /** o item de maior raridade — o herói da aba Destaques */
  const heroi = useMemo(() => {
    return [...itens]
      .filter((c) => !c.bloqueado)
      .sort(
        (a, b) =>
          pesoRaridade(b.raridade) - pesoRaridade(a.raridade) ||
          a.nome.localeCompare(b.nome),
      )[0];
  }, [itens]);

  function ordenar(lista: CosmeticoDeLoja[]) {
    return [...lista].sort(
      (a, b) =>
        pesoRaridade(b.raridade) - pesoRaridade(a.raridade) ||
        a.nome.localeCompare(b.nome),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-6 pb-20 pt-7 sm:px-8">
          {/* header */}
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-brand text-[clamp(24px,3.4vw,32px)] font-semibold tracking-[0.02em] text-ink-100">
                Loja
              </h1>
              <p className="mt-1 text-[13px] text-ink-300">
                Personalize seu perfil no AETHER.
              </p>
            </div>
          </header>

          {/* abas */}
          <div className="mt-5 flex gap-1 overflow-x-auto border-b border-line">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAba(a.id)}
                aria-selected={aba === a.id}
                className={cn(
                  "-mb-px shrink-0 border-b-2 px-3.5 pb-3 pt-3 text-[13px] font-medium transition-colors",
                  aba === a.id
                    ? "border-accent-500 text-ink-100"
                    : "border-transparent text-ink-400 hover:text-ink-100",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* toolbar */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <label className="relative min-w-[200px] flex-1">
              <span className="sr-only">Buscar cosméticos</span>
              <AetherIcon
                name="search"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500"
              />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar cosméticos…"
                autoComplete="off"
                className="h-10 w-full rounded-md border border-line bg-base-900 pl-9 pr-3 text-[13px] text-ink-100 outline-none transition-colors placeholder:text-ink-500 focus:border-accent-500 focus:bg-base-850"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["possui", "Adquiridos"],
                  ["naoPossui", "Não adquiridos"],
                  ["equipado", "Equipados"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filtro[k]}
                  onClick={() =>
                    setFiltro((f) => {
                      const next = { ...f, [k]: !f[k] };
                      if (k === "possui" && next.possui) next.naoPossui = false;
                      if (k === "naoPossui" && next.naoPossui) next.possui = false;
                      return next;
                    })
                  }
                  className={cn(
                    "h-10 rounded-full border px-3.5 text-[12px] font-medium transition-colors",
                    filtro[k]
                      ? "border-accent-500/45 bg-accent-500/15 text-ink-100"
                      : "border-line bg-base-900 text-ink-300 hover:border-line-strong hover:text-ink-100",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {erro ? (
            <p className="mt-3 text-[13px] text-signal-dnd">{erro}</p>
          ) : null}

          {/* conteúdo */}
          {aba === "meus" ? (
            <Inventario
              itens={ordenar(filtrado.filter((c) => c.possui))}
              user={user}
              estaEquipado={estaEquipado}
              onAbrir={setPrevia}
            />
          ) : aba === "destaques" ? (
            <>
              {heroi ? (
                <Hero cosmetico={heroi} user={user} onVisualizar={setPrevia} />
              ) : null}
              <Secao
                titulo="Novidades"
                itens={ordenar(filtrado).slice(0, 8)}
                user={user}
                estaEquipado={estaEquipado}
                heroiId={heroi?.id}
                onAbrir={setPrevia}
              />
            </>
          ) : (
            <Secao
              titulo={aba === "DECORATION" ? "Decorações" : "Banners"}
              itens={ordenar(filtrado.filter((c) => c.tipo === aba))}
              user={user}
              estaEquipado={estaEquipado}
              heroiId={heroi?.id}
              onAbrir={setPrevia}
            />
          )}
        </div>
      </div>

      {previa ? (
        <PreviaDialog
          cosmetico={previa}
          user={user}
          equipado={estaEquipado(previa)}
          pending={pending}
          onFechar={() => setPrevia(null)}
          onEquipar={() => {
            equipar(previa, previa.tipo);
            setPrevia(null);
          }}
          onRemover={() => {
            equipar(null, previa.tipo);
            setPrevia(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ seção */

function Secao({
  titulo,
  itens,
  user,
  estaEquipado,
  heroiId,
  onAbrir,
}: {
  titulo: string;
  itens: CosmeticoDeLoja[];
  user: UserInfo;
  estaEquipado: (c: CosmeticoDeLoja) => boolean;
  heroiId?: string;
  onAbrir: (c: CosmeticoDeLoja) => void;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-3.5 font-brand text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-300">
        {titulo}
      </h2>
      {itens.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-5 py-11 text-center text-[13px] text-ink-400">
          <b className="mb-1 block text-ink-200">Nada por aqui</b>
          Ajuste a busca ou os filtros para ver mais cosméticos.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
          {itens.map((c) => (
            <Card
              key={c.id}
              cosmetico={c}
              user={user}
              equipado={estaEquipado(c)}
              destaque={c.id === heroiId}
              onAbrir={() => onAbrir(c)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Inventario({
  itens,
  user,
  estaEquipado,
  onAbrir,
}: {
  itens: CosmeticoDeLoja[];
  user: UserInfo;
  estaEquipado: (c: CosmeticoDeLoja) => boolean;
  onAbrir: (c: CosmeticoDeLoja) => void;
}) {
  const grupos: { tipo: CosmeticType; label: string }[] = [
    { tipo: "DECORATION", label: "Decorações" },
    { tipo: "BANNER", label: "Banners" },
  ];
  const temAlgum = itens.length > 0;

  return (
    <section className="mt-8">
      <h2 className="mb-3.5 font-brand text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-300">
        Meus cosméticos
      </h2>
      {!temAlgum ? (
        <div className="rounded-md border border-dashed border-line px-5 py-11 text-center text-[13px] text-ink-400">
          <b className="mb-1 block text-ink-200">Sua coleção está vazia</b>
          Peças grátis já contam — equipe uma nas outras abas.
        </div>
      ) : (
        grupos.map(({ tipo, label }) => {
          const doTipo = itens.filter((c) => c.tipo === tipo);
          if (doTipo.length === 0) return null;
          return (
            <div key={tipo} className="mt-6 first:mt-0">
              <span className="mb-2.5 block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-400">
                {label}
              </span>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
                {doTipo.map((c) => (
                  <Card
                    key={c.id}
                    cosmetico={c}
                    user={user}
                    equipado={estaEquipado(c)}
                    onAbrir={() => onAbrir(c)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ hero */

function Hero({
  cosmetico,
  user,
  onVisualizar,
}: {
  cosmetico: CosmeticoDeLoja;
  user: UserInfo;
  onVisualizar: (c: CosmeticoDeLoja) => void;
}) {
  const rar = raridadePorId(cosmetico.raridade);
  return (
    <div
      className="mt-5 grid gap-2 overflow-hidden rounded-2xl border border-line bg-base-850 shadow-[var(--shadow-pop)] md:grid-cols-[1.1fr_0.9fr]"
      style={{
        backgroundImage:
          "radial-gradient(80% 130% at 88% 0, color-mix(in oklch, var(--color-accent-700) 26%, transparent), transparent 60%)",
      }}
    >
      <div className="flex flex-col justify-center gap-3 p-8">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent-300">
          Novo{rar ? ` · ${rar.nome}` : ""}
        </span>
        <h2 className="font-brand text-[clamp(22px,3vw,30px)] font-semibold tracking-[0.02em] text-ink-100">
          {cosmetico.nome}
        </h2>
        {cosmetico.descricao ? (
          <p className="max-w-[42ch] text-[13px] text-ink-300">
            {cosmetico.descricao}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => onVisualizar(cosmetico)}
          className="mt-1 inline-flex h-10 w-max items-center gap-2 rounded-md bg-accent-500 px-5 text-[13px] font-bold text-[#04122b] transition-colors hover:bg-accent-400"
        >
          Visualizar
        </button>
      </div>
      <div className="grid min-h-[240px] place-items-center p-6">
        {/*
          `px=160`, nao 200: essa caixa cresce livre (sem overflow-hidden),
          entao nao corta — mas com `DECORACAO_ESCALA=2,2` um 200 faria a
          decoracao chegar a 440px, maior do que o hero pede. 160x2,2=352px
          mantem o tamanho visual parecido com o que era antes (200x1,8=360px).
        */}
        <MediaDoCosmetico
          cosmetico={cosmetico}
          user={user}
          px={160}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ card */

function Card({
  cosmetico,
  user,
  equipado,
  destaque,
  onAbrir,
}: {
  cosmetico: CosmeticoDeLoja;
  user: UserInfo;
  equipado: boolean;
  destaque?: boolean;
  onAbrir: () => void;
}) {
  const rar = raridadePorId(cosmetico.raridade);
  const tag = equipado
    ? { texto: "Equipado ✓", cls: "border-accent-500/45 text-accent-300" }
    : cosmetico.possui && cosmetico.precoMoedas != null
      ? { texto: "Adquirido", cls: "border-signal-online/40 text-signal-online" }
      : destaque
        ? { texto: "Em destaque", cls: "border-[#e5626b]/40 text-[#e5626b]" }
        : null;

  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label={`${cosmetico.nome} — ${TIPO_LABEL[cosmetico.tipo]}`}
      className="group grid grid-rows-[auto_1fr] overflow-hidden rounded-xl border border-line bg-base-850 text-left transition-[transform,border-color,background-color] duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:bg-base-800"
    >
      <div className="relative grid aspect-square place-items-center border-b border-line-soft bg-[radial-gradient(120%_120%_at_50%_0,var(--color-base-800),var(--color-base-950))]">
        {/*
          `px=78`, nao 148: este card tem `overflow-hidden` (pro fundo
          respeitar o `rounded-xl`) numa caixa `aspect-square` que pode ser tao
          estreita quanto o piso do grid (`minmax(190px,...)`). A decoracao
          renderiza a `DECORACAO_ESCALA`x da footprint (2,2 hoje) — em 148 ela
          precisaria de ~326px e saia cortada pela propria caixa. 78x2,2=172px
          cabe com folga mesmo no piso.
        */}
        <MediaDoCosmetico cosmetico={cosmetico} user={user} px={78} preferThumb />
        {tag ? (
          <span
            className={cn(
              "absolute right-2.5 top-2.5 rounded-md border bg-base-900 px-2 py-1 text-[11px] font-semibold",
              tag.cls,
            )}
          >
            {tag.texto}
          </span>
        ) : null}
      </div>

      <div className="grid content-start gap-1.5 p-3">
        <span className="text-[13.5px] font-semibold text-ink-100">
          {cosmetico.nome}
        </span>
        <span className="flex items-center gap-2 text-[12px] text-ink-400">
          <span
            className="inline-flex items-center gap-1.5 font-semibold"
            style={{ color: rar?.cor ?? "var(--color-ink-400)" }}
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rotate-45 rounded-[1.5px] bg-current"
            />
            {rar?.nome ?? cosmetico.raridade}
          </span>
          ·<span>{TIPO_LABEL[cosmetico.tipo]}</span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <Preco cosmetico={cosmetico} />
          {cosmetico.bloqueado ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-500">
              <AetherIcon name="lock" className="h-3 w-3" />
              {TIER_LABEL[cosmetico.tierMinimo] || "Bloqueado"}
            </span>
          ) : null}
        </span>
      </div>
    </button>
  );
}

function Preco({ cosmetico }: { cosmetico: CosmeticoDeLoja }) {
  if (cosmetico.precoMoedas == null) {
    return (
      <span className="text-[12px] font-semibold text-signal-online">Grátis</span>
    );
  }
  if (cosmetico.possui) {
    return <span className="text-[12px] font-semibold text-ink-300">Seu</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-300">
      <AetherIcon name="sparkle" className="h-3 w-3 text-accent-400" />
      <span className="font-mono tabular-nums">
        {cosmetico.precoMoedas.toLocaleString("pt-BR")}
      </span>
      <span className="text-ink-500">· em breve</span>
    </span>
  );
}

/* ------------------------------------------------- media (avatar / banner) */

function MediaDoCosmetico({
  cosmetico,
  user,
  px,
  preferThumb = false,
}: {
  cosmetico: CosmeticoDeLoja;
  user: UserInfo;
  /** footprint do avatar em px (a decoração renderiza a 1.8x disso, centrada) */
  px: number;
  /**
   * Usa a miniatura (160x160 webp) em vez do PNG cheio (200-600KB medidos em
   * assets reais) quando a decoração renderiza pequena — o card do catálogo
   * baixava o arquivo inteiro pra mostrar uns 170px de tela. So faz sentido
   * onde o layer final fica perto ou abaixo de 160px; num preview grande
   * (hero, px=160 -> layer ~350px) o thumb ficaria borrado.
   */
  preferThumb?: boolean;
}) {
  if (cosmetico.tipo === "BANNER") {
    return (
      <div
        className="w-[86%] overflow-hidden rounded-lg border border-line"
        style={{ aspectRatio: "3 / 1" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cosmetico.thumbUrl ?? cosmetico.assetUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      </div>
    );
  }
  return (
    <AvatarDecorado
      userId={user.id}
      name={user.displayName}
      src={user.avatarUrl}
      moldura={user.moldura}
      px={px}
      decoracao={{
        frenteUrl:
          preferThumb && cosmetico.thumbUrl
            ? cosmetico.thumbUrl
            : cosmetico.assetUrl,
        trasUrl: cosmetico.assetTrasUrl,
      }}
    />
  );
}

/* ------------------------------------------------------------------ prévia */

function PreviaDialog({
  cosmetico,
  user,
  equipado,
  pending,
  onFechar,
  onEquipar,
  onRemover,
}: {
  cosmetico: CosmeticoDeLoja;
  user: UserInfo;
  equipado: boolean;
  pending: boolean;
  onFechar: () => void;
  onEquipar: () => void;
  onRemover: () => void;
}) {
  const [fundo, setFundo] = useState<"escuro" | "claro">("escuro");
  const rar = raridadePorId(cosmetico.raridade);
  const usavel = cosmetico.possui && !cosmetico.bloqueado;

  return (
    <Modal
      open
      onClose={onFechar}
      title="Pré-visualizar"
      className="w-[min(680px,calc(100vw-2rem))]"
    >
      <div className="grid gap-6 sm:grid-cols-[240px_1fr]">
        <div className="flex flex-col items-center gap-3">
          <div
            className={cn(
              "grid aspect-square w-[200px] place-items-center rounded-lg border border-line",
              fundo === "escuro"
                ? "bg-[radial-gradient(120%_120%_at_50%_0,var(--color-base-800),var(--color-base-950))]"
                : "bg-ink-100",
            )}
          >
            {cosmetico.tipo === "BANNER" ? (
              <div className="w-[88%]">
                <div
                  className="overflow-hidden rounded-md border border-line"
                  style={{ aspectRatio: "3 / 1" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cosmetico.assetUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Avatar
                    userId={user.id}
                    name={user.displayName}
                    src={user.avatarUrl}
                    moldura={user.moldura}
                    px={34}
                  />
                  <span className="text-[12px] font-semibold text-ink-100">
                    {user.displayName}
                  </span>
                </div>
              </div>
            ) : (
              <AvatarDecorado
                userId={user.id}
                name={user.displayName}
                src={user.avatarUrl}
                moldura={user.moldura}
                // 95, nao 168: essa caixa e fixa em 200px e SEM
                // overflow-hidden — com a DECORACAO_ESCALA de 2,2 um px maior
                // faria a decoracao sobrar bem alem da caixa e invadir os
                // botoes de fundo escuro/claro logo abaixo. 95x2,2=209px fica
                // soltando so um pouco pra fora, do jeito que o preview pede.
                px={95}
                decoracao={{
                  frenteUrl: cosmetico.assetUrl,
                  trasUrl: cosmetico.assetTrasUrl,
                }}
              />
            )}
          </div>
          <div className="flex gap-2">
            {(["escuro", "claro"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={fundo === f}
                aria-label={`Fundo ${f}`}
                onClick={() => setFundo(f)}
                className={cn(
                  "h-7 w-7 rounded-full border border-line-strong transition-[outline]",
                  f === "escuro" ? "bg-base-950" : "bg-ink-100",
                  fundo === f && "outline outline-2 outline-offset-2 outline-accent-400",
                )}
              />
            ))}
          </div>
        </div>

        <div className="grid content-start gap-3">
          <div>
            <span
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold"
              style={{ color: rar?.cor ?? "var(--color-ink-400)" }}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rotate-45 rounded-[1.5px] bg-current"
              />
              {rar?.nome ?? cosmetico.raridade}
            </span>
            <h3 className="mt-0.5 text-[18px] font-semibold text-ink-100">
              {cosmetico.nome}
            </h3>
          </div>
          {cosmetico.descricao ? (
            <p className="text-[13px] leading-relaxed text-ink-300">
              {cosmetico.descricao}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-500">
              Preço
            </span>
            <Preco cosmetico={cosmetico} />
          </div>

          <div className="mt-1 flex flex-wrap gap-2">
            {cosmetico.bloqueado ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-[13px] text-ink-400">
                <AetherIcon name="lock" className="h-3.5 w-3.5" />
                {TIER_LABEL[cosmetico.tierMinimo] || "Bloqueado"}
              </span>
            ) : !usavel ? (
              <span className="rounded-md border border-line px-3 py-2 text-[13px] text-ink-400">
                Chega à loja em breve.
              </span>
            ) : equipado ? (
              <button
                type="button"
                disabled={pending}
                onClick={onRemover}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-line-strong bg-base-800 px-4 text-[13px] font-semibold text-ink-200 transition-colors hover:bg-base-700 disabled:opacity-60"
              >
                Remover
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={onEquipar}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-accent-500 px-4 text-[13px] font-bold text-[#04122b] transition-colors hover:bg-accent-400 disabled:opacity-60"
              >
                <AetherIcon name="check" className="h-4 w-4" />
                Equipar
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
