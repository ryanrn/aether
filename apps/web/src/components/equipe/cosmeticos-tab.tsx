"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  COSMETIC_ASSET_MAX_BYTES,
  COSMETIC_REGRAS,
  COSMETIC_TYPES,
  PLAN_ORDER,
  PLANS,
  RARIDADES,
  ROTULO_COSMETIC_TYPE,
  raridadePorId,
  type CosmeticoNoPainel,
  type CosmeticType,
  type PlanTier,
} from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Avatar } from "@/components/ui/avatar";
import { AvatarDecorado } from "@/components/profile/avatar-decorado";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Label } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SwitchVisual } from "@/components/ui/switch";
import {
  criarCosmeticoAction,
  definirCosmeticoAtivoAction,
  editarCosmeticoAction,
  excluirCosmeticoAction,
  listarCosmeticosAction,
} from "@/server/actions/cosmeticos";
import { cn } from "@/lib/utils";

/**
 * Cadastro de cosmeticos de perfil — decoracao de avatar e banner. SO A EQUIPE
 * ve; as actions revalidam por `sessaoDaEquipe()` e respondem "Nao encontrado"
 * para o resto.
 *
 * O fluxo e: preencher, anexar PNG/WEBP, enviar (upload passa pelo servidor e
 * grava no R2), conferir o preview, e SO ENTAO publicar. Todo cosmetico nasce
 * como rascunho.
 *
 * O preview ao vivo definitivo (sobre o `<Avatar>` real, nos tamanhos do app)
 * e o proximo passo; aqui ja da para ver a arte composta sobre um avatar.
 */

type Filtro = "TODOS" | CosmeticType;

const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: "TODOS", rotulo: "Todos" },
  ...COSMETIC_TYPES.map((t) => ({
    id: t,
    rotulo: `${ROTULO_COSMETIC_TYPE[t]}s`,
  })),
];

export function CosmeticosTab() {
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [itens, setItens] = useState<CosmeticoNoPainel[] | null>(null);
  const [porTipo, setPorTipo] = useState<Record<CosmeticType, number> | null>(
    null,
  );
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<CosmeticoNoPainel | "novo" | null>(
    null,
  );
  const [excluindo, setExcluindo] = useState<CosmeticoNoPainel | null>(null);
  const [ativando, setAtivando] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const carregar = useCallback(() => {
    listarCosmeticosAction().then((r) => {
      if (r.ok) {
        setItens(r.data.itens);
        setPorTipo(r.data.porTipo);
        setErro(null);
      } else {
        setErro(r.error);
      }
    });
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const visiveis = useMemo(() => {
    if (!itens) return [];
    return filtro === "TODOS"
      ? itens
      : itens.filter((c) => c.tipo === filtro);
  }, [itens, filtro]);

  function alternarAtivo(c: CosmeticoNoPainel) {
    setErro(null);
    setAtivando(c.id);
    startTransition(async () => {
      const r = await definirCosmeticoAtivoAction(c.id, !c.ativo);
      setAtivando(null);
      if (r.ok) {
        setItens((atual) =>
          (atual ?? []).map((x) => (x.id === c.id ? r.data : x)),
        );
      } else {
        setErro(r.error);
      }
    });
  }

  if (erro && !itens) {
    return <p className="text-[13px] text-signal-dnd">{erro}</p>;
  }
  if (!itens || !porTipo) {
    return <p className="text-[13px] text-ink-500">Carregando…</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] leading-snug text-ink-400">
          Decorações de avatar e banners de perfil. O arquivo vai para o
          Cloudflare R2; o banco guarda só a referência. Adicionar um cosmético
          não precisa de deploy.
        </p>
        <Button
          size="sm"
          variant="primary"
          onClick={() => setEditando("novo")}
        >
          <AetherIcon name="plus" className="h-3.5 w-3.5" />
          Novo cosmético
        </Button>
      </div>

      <div className="flex gap-1">
        {FILTROS.map((f) => {
          const n =
            f.id === "TODOS"
              ? itens.length
              : (porTipo[f.id as CosmeticType] ?? 0);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[12px] transition-colors",
                filtro === f.id
                  ? "bg-base-800 text-ink-100"
                  : "text-ink-400 hover:bg-base-850 hover:text-ink-200",
              )}
            >
              {f.rotulo}
              <span className="ml-1.5 font-mono text-[10px] text-ink-500">
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {erro ? (
        <p className="rounded-md border border-signal-dnd/30 bg-signal-dnd/10 px-3 py-2 text-xs text-signal-dnd">
          {erro}
        </p>
      ) : null}

      {visiveis.length === 0 ? (
        <p className="rounded-md border border-line bg-base-850/60 px-3 py-8 text-center text-xs text-ink-500">
          Nenhum cosmético{filtro !== "TODOS" ? " deste tipo" : ""} ainda.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visiveis.map((c) => (
            <CartaoCosmetico
              key={c.id}
              cosmetico={c}
              ocupado={pending && ativando === c.id}
              onAlternar={() => alternarAtivo(c)}
              onEditar={() => setEditando(c)}
              onExcluir={() => setExcluindo(c)}
            />
          ))}
        </ul>
      )}

      {editando ? (
        <FormularioCosmetico
          inicial={editando === "novo" ? null : editando}
          tipoPadrao={filtro !== "TODOS" ? (filtro as CosmeticType) : "DECORATION"}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
            carregar();
          }}
        />
      ) : null}

      {excluindo ? (
        <DialogoExcluir
          cosmetico={excluindo}
          onFechar={() => setExcluindo(null)}
          onExcluido={() => {
            setExcluindo(null);
            carregar();
          }}
        />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ cartao -- */

function CartaoCosmetico({
  cosmetico: c,
  ocupado,
  onAlternar,
  onEditar,
  onExcluir,
}: {
  cosmetico: CosmeticoNoPainel;
  ocupado: boolean;
  onAlternar: () => void;
  onEditar: () => void;
  onExcluir: () => void;
}) {
  const rar = raridadePorId(c.raridade);
  return (
    <li className="flex gap-3 rounded-lg border border-line bg-base-850/60 p-3">
      <div className="shrink-0">
        <MiniPreview cosmetico={c} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-ink-100">
            {c.nome}
          </span>
          {!c.ativo ? (
            <span className="shrink-0 rounded-xs bg-base-700 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-ink-400">
              rascunho
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-400">
          <span>{ROTULO_COSMETIC_TYPE[c.tipo]}</span>
          {rar ? (
            <span
              className="inline-flex items-center gap-1 font-medium"
              style={{ color: rar.cor }}
            >
              <span
                className="h-1.5 w-1.5 rotate-45"
                style={{ background: rar.cor }}
              />
              {rar.nome}
            </span>
          ) : null}
          <span className="text-ink-500">
            {c.precoMoedas == null
              ? "Grátis"
              : `${c.precoMoedas.toLocaleString("pt-BR")} moedas`}
          </span>
          {c.tierMinimo !== "FREE" ? (
            <span className="text-ink-500">· {PLANS[c.tierMinimo].rotulo}</span>
          ) : null}
        </div>

        <p className="truncate font-mono text-[10px] text-ink-600">
          {c.slug} · ordem {c.ordem}
        </p>

        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={c.ativo}
            aria-label={c.ativo ? "Despublicar" : "Publicar"}
            disabled={ocupado}
            onClick={onAlternar}
            className="rounded-pill transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent-500 disabled:cursor-not-allowed active:scale-95"
          >
            <SwitchVisual checked={c.ativo} disabled={ocupado} />
          </button>
          <span className="mr-auto pl-1 text-[11px] text-ink-500">
            {c.ativo ? "Publicado" : "Publicar"}
          </span>

          <Button size="sm" variant="ghost" onClick={onEditar} title="Editar">
            <AetherIcon name="pencil" className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onExcluir} title="Excluir">
            <AetherIcon name="trash" className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </li>
  );
}

type ArteDoCosmetico = Pick<
  CosmeticoNoPainel,
  "tipo" | "nome" | "assetUrl" | "assetTrasUrl" | "thumbUrl"
>;

/** O item na lista: decoracao sobre um avatar de teste, ou a faixa 3:1. */
function MiniPreview({ cosmetico: c, px = 60 }: { cosmetico: ArteDoCosmetico; px?: number }) {
  if (c.tipo === "BANNER") {
    return (
      <div
        className="overflow-hidden rounded-md border border-line bg-base-900"
        style={{ width: px * 1.8, height: (px * 1.8) / 3 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={c.thumbUrl ?? c.assetUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      </div>
    );
  }
  return (
    <div
      className="grid place-items-center overflow-hidden rounded-md border border-line bg-[radial-gradient(120%_120%_at_50%_0,var(--color-base-800),var(--color-base-950))]"
      style={{ width: px, height: px }}
    >
      {/*
        0.42, nao 0.62: essa caixa e fixa (`overflow-hidden`, width/height=px).
        Com `DECORACAO_ESCALA=2,2`, a decoracao precisa caber DENTRO de `px` —
        0.42*2,2=0.924, ~92% da caixa, com uma margem pequena.
      */}
      <AvatarDecorado
        userId={`pv-${c.nome}`}
        name="AE"
        px={Math.round(px * 0.42)}
        decoracao={{ frenteUrl: c.assetUrl, trasUrl: c.assetTrasUrl }}
      />
    </div>
  );
}

const FUNDOS = [
  { id: "escuro", rotulo: "Escuro", cor: "var(--color-base-950)" },
  { id: "claro", rotulo: "Claro", cor: "#e9ebef" },
  { id: "faixa", rotulo: "Faixa", cor: "var(--color-accent-700)" },
] as const;

/**
 * O preview do formulario. Decoracao: sobre o `<Avatar>` real, em tres tamanhos
 * do app (lista, cabecalho, cartao) e com troca de fundo — arte transparente so
 * se confere assim. Banner: dentro de um cartao de perfil de mentira.
 */
function PreviaCosmetico({ cosmetico: c }: { cosmetico: ArteDoCosmetico }) {
  const [fundo, setFundo] = useState<(typeof FUNDOS)[number]["id"]>("escuro");
  const corFundo = FUNDOS.find((f) => f.id === fundo)!.cor;

  if (c.tipo === "BANNER") {
    return (
      <div className="w-full max-w-[300px] overflow-hidden rounded-lg border border-line bg-base-900">
        <div className="aspect-[3/1] w-full bg-base-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.assetUrl} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="-mt-8 px-4 pb-4">
          <Avatar userId="pv-banner" name="AE" px={56} ring="border-base-900" />
          <p className="mt-1.5 text-[14px] font-semibold text-ink-100">Nome</p>
          <p className="font-mono text-[11px] text-ink-500">@usuario</p>
        </div>
      </div>
    );
  }

  const deco = { frenteUrl: c.assetUrl, trasUrl: c.assetTrasUrl };
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="flex items-end gap-6 rounded-lg border border-line px-9 py-7"
        style={{ background: corFundo }}
      >
        {[28, 44, 72].map((px) => (
          <AvatarDecorado
            key={px}
            userId="pv-deco"
            name="AE"
            px={px}
            decoracao={deco}
          />
        ))}
      </div>
      <div className="flex gap-1.5">
        {FUNDOS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFundo(f.id)}
            aria-pressed={fundo === f.id}
            className={cn(
              "h-6 w-6 rounded-full border border-line-strong transition-transform",
              fundo === f.id && "outline outline-2 outline-offset-2 outline-accent-500",
            )}
            style={{ background: f.cor }}
            title={f.rotulo}
          />
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- formulario -- */

interface Rascunho {
  nome: string;
  descricao: string;
  tipo: CosmeticType;
  slug: string;
  raridade: string;
  precoMoedas: string;
  tierMinimo: PlanTier;
  ordem: string;
}

function slugify(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFKD") // "coração" -> "c" + "o" + "r" + "a" + "c" + combinante + "a" + "o"
    .replace(/[^\x20-\x7e]/g, "") // fora do ASCII imprimivel (marcas, emoji) some
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function FormularioCosmetico({
  inicial,
  tipoPadrao,
  onFechar,
  onSalvo,
}: {
  inicial: CosmeticoNoPainel | null;
  tipoPadrao: CosmeticType;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const editando = inicial != null;

  const [r, setR] = useState<Rascunho>(() => ({
    nome: inicial?.nome ?? "",
    descricao: inicial?.descricao ?? "",
    tipo: inicial?.tipo ?? tipoPadrao,
    slug: inicial?.slug ?? "",
    raridade: inicial?.raridade ?? RARIDADES[0]!.id,
    precoMoedas: inicial?.precoMoedas != null ? String(inicial.precoMoedas) : "",
    tierMinimo: inicial?.tierMinimo ?? "FREE",
    ordem: String(inicial?.ordem ?? 0),
  }));
  const [slugManual, setSlugManual] = useState(editando);
  const [asset, setAsset] = useState<File | null>(null);
  const [assetTras, setAssetTras] = useState<File | null>(null);
  const [erro, setErro] = useState<{ msg: string; campo?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const regra = COSMETIC_REGRAS[r.tipo];
  const previewFrente = useObjectUrl(asset) ?? inicial?.assetUrl ?? null;
  const previewTras = useObjectUrl(assetTras) ?? inicial?.assetTrasUrl ?? null;

  function set<K extends keyof Rascunho>(k: K, v: Rascunho[K]) {
    setR((atual) => {
      const proximo = { ...atual, [k]: v };
      if (k === "nome" && !slugManual) proximo.slug = slugify(String(v));
      return proximo;
    });
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!editando && !asset) {
      setErro({ msg: "Envie o arquivo do cosmético.", campo: "asset" });
      return;
    }

    const fd = new FormData();
    if (inicial) fd.set("id", inicial.id);
    fd.set("nome", r.nome);
    fd.set("descricao", r.descricao);
    fd.set("tipo", r.tipo);
    fd.set("slug", r.slug);
    fd.set("raridade", r.raridade);
    fd.set("precoMoedas", r.precoMoedas);
    fd.set("tierMinimo", r.tierMinimo);
    fd.set("ordem", r.ordem);
    if (asset) fd.set("asset", asset);
    if (assetTras) fd.set("assetTras", assetTras);

    startTransition(async () => {
      const acao = editando ? editarCosmeticoAction : criarCosmeticoAction;
      const res = await acao(fd);
      if (res.ok) onSalvo();
      else setErro({ msg: res.error, campo: res.field });
    });
  }

  return (
    <Modal
      open
      onClose={onFechar}
      title={editando ? "Editar cosmético" : "Novo cosmético"}
      className="max-w-[560px]"
    >
      <form onSubmit={enviar} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" required>
            <Input
              value={r.nome}
              onChange={(e) => set("nome", e.target.value)}
              maxLength={60}
              autoFocus
            />
          </Field>
          <Field label="Slug" required hint="Identificador estável. Não muda depois.">
            <Input
              value={r.slug}
              onChange={(e) => {
                setSlugManual(true);
                set("slug", e.target.value);
              }}
              disabled={editando}
              className="font-mono"
            />
          </Field>
        </div>

        <Field label="Descrição">
          <textarea
            value={r.descricao}
            onChange={(e) => set("descricao", e.target.value)}
            maxLength={240}
            rows={2}
            className="w-full rounded-md border border-line-strong bg-base-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-accent-600 focus:outline-none"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo" required>
            <select
              value={r.tipo}
              onChange={(e) => set("tipo", e.target.value as CosmeticType)}
              disabled={editando}
              className="h-10 w-full rounded-md border border-line-strong bg-base-900 px-3 text-sm text-ink-100 focus:border-accent-600 focus:outline-none disabled:opacity-50"
            >
              {COSMETIC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_COSMETIC_TYPE[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Raridade" required>
            <select
              value={r.raridade}
              onChange={(e) => set("raridade", e.target.value)}
              className="h-10 w-full rounded-md border border-line-strong bg-base-900 px-3 text-sm text-ink-100 focus:border-accent-600 focus:outline-none"
            >
              {RARIDADES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Preço (moedas)" hint="Vazio = grátis">
            <Input
              value={r.precoMoedas}
              onChange={(e) =>
                set("precoMoedas", e.target.value.replace(/[^\d]/g, ""))
              }
              inputMode="numeric"
              placeholder="grátis"
            />
          </Field>
          <Field label="Plano mínimo">
            <select
              value={r.tierMinimo}
              onChange={(e) => set("tierMinimo", e.target.value as PlanTier)}
              className="h-10 w-full rounded-md border border-line-strong bg-base-900 px-3 text-sm text-ink-100 focus:border-accent-600 focus:outline-none"
            >
              {PLAN_ORDER.map((t) => (
                <option key={t} value={t}>
                  {t === "FREE" ? "Qualquer um" : PLANS[t].rotulo}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ordem">
            <Input
              value={r.ordem}
              onChange={(e) => set("ordem", e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
            />
          </Field>
        </div>

        {/* asset */}
        <div className="flex flex-col gap-3">
          <Field
            label={r.tipo === "DECORATION" ? "Arte (frente)" : "Imagem do banner"}
            required={!editando}
            hint={regra.alvo}
          >
            <ArquivoInput
              arquivo={asset}
              temAtual={editando}
              onEscolher={setAsset}
            />
          </Field>

          {r.tipo === "DECORATION" ? (
            <Field
              label="Arte de trás (opcional)"
              hint="Fica atrás do avatar — só se a peça tiver duas camadas."
            >
              <ArquivoInput
                arquivo={assetTras}
                temAtual={Boolean(inicial?.assetTrasUrl)}
                onEscolher={setAssetTras}
              />
            </Field>
          ) : null}
        </div>

        {/* preview */}
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-base-900/40 p-4">
          <Label>Preview</Label>
          {previewFrente ? (
            <PreviaCosmetico
              cosmetico={{
                tipo: r.tipo,
                nome: r.nome || "preview",
                assetUrl: previewFrente,
                assetTrasUrl: previewTras,
                thumbUrl: null,
              }}
            />
          ) : (
            <div className="grid h-28 w-full place-items-center rounded-md border border-dashed border-line text-[11px] text-ink-600">
              anexe a arte para ver o preview
            </div>
          )}
        </div>

        <FieldError>{erro?.msg}</FieldError>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onFechar} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={pending}>
            {pending ? (
              <>
                <AetherIcon name="loader" className="h-4 w-4 animate-spin" />
                Enviando…
              </>
            ) : editando ? (
              "Salvar"
            ) : (
              "Criar rascunho"
            )}
          </Button>
        </div>

        {!editando ? (
          <p className="text-[11px] text-ink-500">
            O cosmético entra como rascunho. Confira o preview e publique pela
            lista.
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function ArquivoInput({
  arquivo,
  temAtual,
  onEscolher,
}: {
  arquivo: File | null;
  temAtual: boolean;
  onEscolher: (f: File | null) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-base-900 px-3 py-2 text-[13px] text-ink-300 transition-colors hover:border-line-strong hover:text-ink-100">
      <AetherIcon name="upload" className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {arquivo
          ? arquivo.name
          : temAtual
            ? "Trocar arquivo (mantém o atual)"
            : "Escolher PNG ou WEBP"}
      </span>
      {arquivo ? (
        <span className="shrink-0 font-mono text-[10px] text-ink-500">
          {(arquivo.size / 1024).toFixed(0)} KB
        </span>
      ) : null}
      <input
        type="file"
        accept="image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (f && f.size > COSMETIC_ASSET_MAX_BYTES) {
            onEscolher(null);
            e.target.value = "";
            alert(
              `Imagem maior que ${Math.round(COSMETIC_ASSET_MAX_BYTES / 1024 / 1024)} MB`,
            );
            return;
          }
          onEscolher(f);
        }}
      />
    </label>
  );
}

/* ------------------------------------------------------------------ excluir -- */

function DialogoExcluir({
  cosmetico: c,
  onFechar,
  onExcluido,
}: {
  cosmetico: CosmeticoNoPainel;
  onFechar: () => void;
  onExcluido: () => void;
}) {
  const [apagarArte, setApagarArte] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmar() {
    setErro(null);
    startTransition(async () => {
      const r = await excluirCosmeticoAction(c.id, apagarArte);
      if (r.ok) onExcluido();
      else setErro(r.error);
    });
  }

  return (
    <Modal
      open
      onClose={onFechar}
      title="Excluir cosmético"
      className="max-w-[440px]"
    >
      <p className="text-[13px] leading-relaxed text-ink-300">
        Isso apaga <b className="text-ink-100">{c.nome}</b> do catálogo{" "}
        <b className="text-signal-dnd">e o registro de posse de quem já
        tinha</b> — quem comprou ou recebeu esse item perde esse histórico
        para sempre, não só o de exibir. Não dá para desfazer recadastrando
        com o mesmo nome.
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
        Se a intenção é só tirar da loja sem apagar nada, use o interruptor
        “Publicado” na lista em vez de excluir — reversível a qualquer hora.
      </p>

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-md border border-line bg-base-900 px-3 py-2.5">
        <input
          type="checkbox"
          checked={apagarArte}
          onChange={(e) => setApagarArte(e.target.checked)}
          className="mt-0.5 accent-signal-dnd"
        />
        <span className="text-[12px] leading-snug text-ink-300">
          Apagar também o arquivo do Cloudflare R2.{" "}
          <b className="text-signal-dnd">Não dá para desfazer.</b> Sem isto, o
          arquivo fica lá e um novo cadastro com o mesmo asset o reaproveita.
        </span>
      </label>

      {erro ? (
        <p className="mt-3 text-[12px] text-signal-dnd">{erro}</p>
      ) : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onFechar} disabled={pending}>
          Cancelar
        </Button>
        <Button variant="danger" onClick={confirmar} disabled={pending}>
          {pending
            ? "Excluindo…"
            : apagarArte
              ? "Excluir e apagar arte"
              : "Excluir do catálogo"}
        </Button>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------- utils -- */

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}
