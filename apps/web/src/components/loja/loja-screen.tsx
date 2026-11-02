"use client";

import { useMemo, useState, useTransition } from "react";
import { esquecerPerfil } from "@/lib/perfil-cache";
import {
  COSMETIC_TYPES,
  formatarMoedas,
  formatarProgresso,
  MOEDA,
  MOTIVO_LABEL,
  raridadePorId,
  rotuloDoPrazo,
  type Carteira,
  type ColecaoDaLoja,
  type MissaoDaPessoa,
  type CosmeticoDeLoja,
  type CosmeticType,
  type MovimentoPublico,
  type PlanTier,
} from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { AvatarDecorado } from "@/components/profile/avatar-decorado";
import {
  CamadaDeEfeito,
  FundoDePlaca,
} from "@/components/profile/cosmeticos-de-perfil";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import { equiparCosmeticoAction } from "@/server/actions/profile";
import {
  comprarCosmeticoAction,
  resgatarCosmeticoAction,
} from "@/server/actions/moedas";
import { resgatarMissaoAction } from "@/server/actions/missoes";
import { cn } from "@/lib/utils";

/**
 * A Loja de cosmeticos.
 *
 * Reproduz a vitrine do redesign (OpenDesign) com o que o backend ja entrega:
 * decoracoes de avatar e banners, gratis, por plano, ou PAGAS EM MOEDAS (a
 * carteira, `services/moedas.ts`). Comprar debita o saldo e entrega o item na
 * mesma transacao; a tela so atualiza o que o servidor devolveu.
 *
 * O trilho "Loja / Perfil" do mock NAO e reconstruido: o `HomeNavPanel` ja e
 * a navegacao do AETHER. Aqui e so o conteudo.
 *
 * `equiparCosmeticoAction` revalida TUDO no servidor (plano, posse, ativo) —
 * a tela so esconde o que seria recusado.
 */

type Aba = "destaques" | CosmeticType | "meus" | "moedas";

const TIPO_LABEL: Record<CosmeticType, string> = {
  DECORATION: "Decoração",
  BANNER: "Banner",
  NAMEPLATE: "Placa de nome",
  PROFILE_EFFECT: "Efeito de perfil",
};

/** O nome de cada tipo no plural — abas, secoes e grupos do inventario. */
const TIPO_PLURAL: Record<CosmeticType, string> = {
  DECORATION: "Decorações",
  BANNER: "Banners",
  NAMEPLATE: "Placas de nome",
  PROFILE_EFFECT: "Efeitos de perfil",
};

const ABAS: { id: Aba; label: string }[] = [
  { id: "destaques", label: "Destaques" },
  ...COSMETIC_TYPES.map((tipo) => ({ id: tipo, label: TIPO_PLURAL[tipo] })),
  { id: "meus", label: "Meus cosméticos" },
  { id: "moedas", label: `Minhas ${MOEDA.plural}` },
];

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
  itens: itensDoServidor,
  carteira,
  missoes,
  colecoes,
  agoraIso,
  plano: _plano,
  user,
}: {
  itens: CosmeticoDeLoja[];
  carteira: Carteira;
  missoes: MissaoDaPessoa[];
  /** as colecoes no ar, na ordem da vitrine (a de destaque primeiro) */
  colecoes: ColecaoDaLoja[];
  /**
   * O "agora" do servidor, para o selo de prazo sair igual no HTML e na
   * hidratacao (calcular `new Date()` dos dois lados poderia divergir).
   */
  agoraIso: string;
  plano: PlanTier;
  user: UserInfo;
}) {
  const agora = useMemo(() => new Date(agoraIso), [agoraIso]);
  const [aba, setAba] = useState<Aba>("destaques");
  const [saldo, setSaldo] = useState(carteira.saldo);
  /**
   * Comprados NESTA visita. O servidor ja gravou; marcar aqui evita recarregar
   * a pagina para o item aparecer como seu. O extrato atualiza na proxima
   * visita (a compra nova entra no topo dele).
   */
  const [compradas, setCompradas] = useState<Set<string>>(() => new Set());
  const itens = useMemo(
    () =>
      itensDoServidor.map((c) =>
        compradas.has(c.id) ? { ...c, possui: true, exigeResgate: false } : c,
      ),
    [itensDoServidor, compradas],
  );
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<{
    possui: boolean;
    naoPossui: boolean;
    equipado: boolean;
  }>({ possui: false, naoPossui: false, equipado: false });

  // Estado local do equipado, por tipo — otimista, volta atras se o servidor recusa.
  const [equipado, setEquipado] = useState<Record<CosmeticType, string | null>>(
    () =>
      Object.fromEntries(
        COSMETIC_TYPES.map((tipo) => [
          tipo,
          itens.find((c) => c.tipo === tipo && c.equipado)?.id ?? null,
        ]),
      ) as Record<CosmeticType, string | null>,
  );
  const [previa, setPrevia] = useState<CosmeticoDeLoja | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const estaEquipado = (c: CosmeticoDeLoja) => equipado[c.tipo] === c.id;

  /** O que a pessoa usa agora, por tipo — a base da previa "No seu perfil". */
  const equipados = useMemo(
    () =>
      Object.fromEntries(
        COSMETIC_TYPES.map((tipo) => [
          tipo,
          itens.find((c) => c.id === equipado[tipo]) ?? null,
        ]),
      ) as Record<CosmeticType, CosmeticoDeLoja | null>,
    [itens, equipado],
  );

  function resgatar(c: CosmeticoDeLoja) {
    setErro(null);
    startTransition(async () => {
      const r = await resgatarCosmeticoAction(c.id);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setCompradas((s) => new Set(s).add(c.id));
      setPrevia({ ...c, possui: true, exigeResgate: false });
    });
  }

  function comprar(c: CosmeticoDeLoja) {
    setErro(null);
    startTransition(async () => {
      const r = await comprarCosmeticoAction(c.id);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setSaldo(r.data.saldo);
      setCompradas((s) => new Set(s).add(c.id));
      // A previa continua aberta, agora com o item como seu e "Equipar".
      setPrevia({ ...c, possui: true });
    });
  }

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
      } else {
        esquecerPerfil(user.id);
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

  /**
   * A colecao que abre Destaques: a primeira marcada como destaque que tenha
   * algum item visivel. Sem ela, vale o heroi por raridade de antes.
   */
  const colecaoDestaque = useMemo(
    () =>
      colecoes.find(
        (c) => c.destaque && itens.some((i) => i.colecaoId === c.id),
      ) ?? null,
    [colecoes, itens],
  );

  /** "Novidades" e o que entrou por ultimo no catalogo. */
  function maisNovos(lista: CosmeticoDeLoja[]) {
    return [...lista].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  }

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
            <button
              type="button"
              onClick={() => setAba("moedas")}
              title={`Seu saldo de ${MOEDA.plural}`}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-base-900 px-4 text-[13px] font-semibold text-ink-100 transition-colors hover:border-line-strong"
            >
              <AetherIcon name="sparkle" className="h-4 w-4 text-accent-400" />
              <span className="font-mono tabular-nums">
                {saldo.toLocaleString("pt-BR")}
              </span>
              <span className="text-ink-400">{MOEDA.plural}</span>
            </button>
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

          {/* toolbar — busca e filtros sao de cosmetico; o extrato nao usa */}
          {aba === "moedas" ? null : (
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
          )}

          {erro ? (
            <p className="mt-3 text-[13px] text-signal-dnd">{erro}</p>
          ) : null}

          {/* conteúdo */}
          {aba === "moedas" ? (
            <>
              <Missoes inicial={missoes} onResgatar={setSaldo} />
              <Extrato saldo={saldo} movimentos={carteira.movimentos} />
            </>
          ) : aba === "meus" ? (
            <Inventario
              itens={ordenar(filtrado.filter((c) => c.possui))}
              user={user}
              agora={agora}
              estaEquipado={estaEquipado}
              onAbrir={setPrevia}
            />
          ) : aba === "destaques" ? (
            <>
              {colecaoDestaque ? (
                <ColecaoEmDestaque
                  colecao={colecaoDestaque}
                  itens={ordenar(
                    filtrado.filter((c) => c.colecaoId === colecaoDestaque.id),
                  )}
                  user={user}
                  agora={agora}
                  estaEquipado={estaEquipado}
                  onAbrir={setPrevia}
                />
              ) : heroi ? (
                <Hero cosmetico={heroi} user={user} onVisualizar={setPrevia} />
              ) : null}
              {colecoes
                .filter((col) => col.id !== colecaoDestaque?.id)
                .map((col) => {
                  const doGrupo = filtrado.filter((c) => c.colecaoId === col.id);
                  if (doGrupo.length === 0) return null;
                  return (
                    <Secao
                      key={col.id}
                      titulo={col.nome}
                      subtitulo={
                        [col.descricao, rotuloDoPrazo(col.fimEm, agora)]
                          .filter(Boolean)
                          .join(" · ") || undefined
                      }
                      itens={ordenar(doGrupo)}
                      user={user}
                      agora={agora}
                      estaEquipado={estaEquipado}
                      onAbrir={setPrevia}
                    />
                  );
                })}
              <Secao
                titulo="Novidades"
                itens={maisNovos(filtrado).slice(0, 8)}
                user={user}
                agora={agora}
                estaEquipado={estaEquipado}
                heroiId={colecaoDestaque ? undefined : heroi?.id}
                onAbrir={setPrevia}
              />
            </>
          ) : (
            <Secao
              titulo={TIPO_PLURAL[aba]}
              itens={ordenar(filtrado.filter((c) => c.tipo === aba))}
              user={user}
              agora={agora}
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
          saldo={saldo}
          erro={erro}
          pending={pending}
          onComprar={() => comprar(previa)}
          onResgatar={() => resgatar(previa)}
          equipados={equipados}
          agora={agora}
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
  subtitulo,
  itens,
  user,
  agora,
  estaEquipado,
  heroiId,
  onAbrir,
}: {
  titulo: string;
  subtitulo?: string;
  itens: CosmeticoDeLoja[];
  user: UserInfo;
  agora: Date;
  estaEquipado: (c: CosmeticoDeLoja) => boolean;
  heroiId?: string;
  onAbrir: (c: CosmeticoDeLoja) => void;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-3.5 font-brand text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-300">
        {titulo}
        {subtitulo ? (
          <span className="ml-3 font-sans text-[12px] font-normal normal-case tracking-normal text-ink-500">
            {subtitulo}
          </span>
        ) : null}
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
              agora={agora}
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
  agora,
  estaEquipado,
  onAbrir,
}: {
  itens: CosmeticoDeLoja[];
  user: UserInfo;
  agora: Date;
  estaEquipado: (c: CosmeticoDeLoja) => boolean;
  onAbrir: (c: CosmeticoDeLoja) => void;
}) {
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
        COSMETIC_TYPES.map((tipo) => {
          const doTipo = itens.filter((c) => c.tipo === tipo);
          if (doTipo.length === 0) return null;
          return (
            <div key={tipo} className="mt-6 first:mt-0">
              <span className="mb-2.5 block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-400">
                {TIPO_PLURAL[tipo]}
              </span>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
                {doTipo.map((c) => (
                  <Card
                    key={c.id}
                    cosmetico={c}
                    user={user}
                    agora={agora}
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

/* ------------------------------------------------------ colecao em destaque */

/**
 * O topo de Destaques quando ha uma colecao marcada: nome, descricao e prazo
 * da colecao, e os itens dela logo abaixo.
 */
function ColecaoEmDestaque({
  colecao,
  itens,
  user,
  agora,
  estaEquipado,
  onAbrir,
}: {
  colecao: ColecaoDaLoja;
  itens: CosmeticoDeLoja[];
  user: UserInfo;
  agora: Date;
  estaEquipado: (c: CosmeticoDeLoja) => boolean;
  onAbrir: (c: CosmeticoDeLoja) => void;
}) {
  const prazo = rotuloDoPrazo(colecao.fimEm, agora);
  return (
    <section
      className="mt-5 rounded-2xl border border-line bg-base-850 p-6 shadow-[var(--shadow-pop)] sm:p-8"
      style={{
        backgroundImage:
          "radial-gradient(80% 130% at 88% 0, color-mix(in oklch, var(--color-accent-700) 26%, transparent), transparent 60%)",
      }}
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent-300">
        Coleção em destaque{prazo ? ` · ${prazo}` : ""}
      </span>
      <h2 className="mt-2 font-brand text-[clamp(22px,3vw,30px)] font-semibold tracking-[0.02em] text-ink-100">
        {colecao.nome}
      </h2>
      {colecao.descricao ? (
        <p className="mt-1 max-w-[56ch] text-[13px] text-ink-300">
          {colecao.descricao}
        </p>
      ) : null}
      {itens.length === 0 ? (
        <p className="mt-5 text-[13px] text-ink-400">
          Nenhum item desta coleção bate com a busca ou os filtros.
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
          {itens.map((c) => (
            <Card
              key={c.id}
              cosmetico={c}
              user={user}
              agora={agora}
              equipado={estaEquipado(c)}
              onAbrir={() => onAbrir(c)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ card */

function Card({
  cosmetico,
  user,
  agora,
  equipado,
  destaque,
  onAbrir,
}: {
  cosmetico: CosmeticoDeLoja;
  user: UserInfo;
  agora: Date;
  equipado: boolean;
  destaque?: boolean;
  onAbrir: () => void;
}) {
  const rar = raridadePorId(cosmetico.raridade);
  // "Adquirido": comprado, ou resgatado de uma colecao com prazo.
  const seu =
    cosmetico.possui &&
    (cosmetico.precoMoedas != null || cosmetico.fimEm != null);
  // O prazo so interessa a quem ainda nao tem o item.
  const prazo = seu ? null : rotuloDoPrazo(cosmetico.fimEm, agora);
  const tag = equipado
    ? { texto: "Equipado ✓", cls: "border-accent-500/45 text-accent-300" }
    : seu
      ? { texto: "Adquirido", cls: "border-signal-online/40 text-signal-online" }
      : prazo
        ? { texto: prazo, cls: "border-signal-idle/40 text-signal-idle" }
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
      <span className="text-[12px] font-semibold text-signal-online">
        {cosmetico.exigeResgate ? "Grátis · resgate" : "Grátis"}
      </span>
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
      <span className="text-ink-500">{MOEDA.plural}</span>
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
  const url =
    preferThumb && cosmetico.thumbUrl ? cosmetico.thumbUrl : cosmetico.assetUrl;
  if (cosmetico.tipo === "NAMEPLATE") {
    // A linha da lista de membros, com a placa atras — como ela aparece.
    return (
      <div className="relative isolate flex w-[90%] items-center gap-2 overflow-hidden rounded-md px-2 py-[7px]">
        <FundoDePlaca url={url} />
        <Avatar
          userId={user.id}
          name={user.displayName}
          src={user.avatarUrl}
          moldura={user.moldura}
          px={Math.max(24, Math.round(px * 0.3))}
        />
        <span className="truncate text-[13px] font-medium text-ink-100">
          {user.displayName}
        </span>
      </div>
    );
  }
  if (cosmetico.tipo === "PROFILE_EFFECT") {
    // Um cartao de perfil em miniatura, com o efeito por cima.
    return (
      <div className="relative aspect-[3/4] w-[58%] rounded-lg border border-line bg-base-850">
        <div className="h-[28%] rounded-t-lg bg-gradient-to-r from-accent-700/40 to-accent-500/15" />
        <div className="-mt-[14%] px-[10%]">
          <Avatar
            userId={user.id}
            name={user.displayName}
            src={user.avatarUrl}
            moldura={user.moldura}
            px={Math.max(28, Math.round(px * 0.4))}
          />
          <span className="mt-1 block truncate text-[12px] font-semibold text-ink-100">
            {user.displayName}
          </span>
        </div>
        <CamadaDeEfeito url={cosmetico.assetUrl} />
      </div>
    );
  }
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
      decoracao={{ frenteUrl: url, trasUrl: cosmetico.assetTrasUrl }}
    />
  );
}

/* ------------------------------------------------------------------ prévia */

function PreviaDialog({
  cosmetico,
  user,
  equipado,
  equipados,
  agora,
  saldo,
  erro,
  pending,
  onComprar,
  onResgatar,
  onFechar,
  onEquipar,
  onRemover,
}: {
  cosmetico: CosmeticoDeLoja;
  user: UserInfo;
  equipado: boolean;
  /** o que a pessoa usa hoje, por tipo — para a previa "No seu perfil" */
  equipados: Record<CosmeticType, CosmeticoDeLoja | null>;
  agora: Date;
  saldo: number;
  erro: string | null;
  pending: boolean;
  onComprar: () => void;
  onResgatar: () => void;
  onFechar: () => void;
  onEquipar: () => void;
  onRemover: () => void;
}) {
  const [fundo, setFundo] = useState<"escuro" | "claro">("escuro");
  const [modo, setModo] = useState<"item" | "perfil">("item");
  const prazo = cosmetico.possui ? null : rotuloDoPrazo(cosmetico.fimEm, agora);
  const rar = raridadePorId(cosmetico.raridade);
  const usavel = cosmetico.possui && !cosmetico.bloqueado;
  const preco = cosmetico.precoMoedas ?? 0;
  const falta = Math.max(0, preco - saldo);

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
            role="tablist"
            aria-label="Modo da prévia"
            className="flex rounded-md border border-line bg-base-900 p-0.5 text-[12px]"
          >
            {(
              [
                ["item", "Item"],
                ["perfil", "No seu perfil"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={modo === m}
                onClick={() => setModo(m)}
                className={cn(
                  "rounded px-2.5 py-1 font-medium transition-colors",
                  modo === m
                    ? "bg-base-750 text-ink-100"
                    : "text-ink-400 hover:text-ink-100",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {modo === "perfil" ? (
            <PreviaNoPerfil
              cosmetico={cosmetico}
              equipados={equipados}
              user={user}
            />
          ) : (
          <div
            className={cn(
              "grid aspect-square w-[200px] place-items-center rounded-lg border border-line",
              fundo === "escuro"
                ? "bg-[radial-gradient(120%_120%_at_50%_0,var(--color-base-800),var(--color-base-950))]"
                : "bg-ink-100",
            )}
          >
            {cosmetico.tipo === "NAMEPLATE" ||
            cosmetico.tipo === "PROFILE_EFFECT" ? (
              <MediaDoCosmetico cosmetico={cosmetico} user={user} px={110} />
            ) : cosmetico.tipo === "BANNER" ? (
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
          )}
          <div className={cn("flex gap-2", modo === "perfil" && "hidden")}>
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
            {prazo ? (
              <span className="text-[12px] font-semibold text-signal-idle">
                · {prazo}
              </span>
            ) : null}
          </div>

          <div className="mt-1 flex flex-wrap gap-2">
            {cosmetico.bloqueado ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-[13px] text-ink-400">
                <AetherIcon name="lock" className="h-3.5 w-3.5" />
                {TIER_LABEL[cosmetico.tierMinimo] || "Bloqueado"}
              </span>
            ) : cosmetico.exigeResgate ? (
              <div className="grid gap-1.5">
                <button
                  type="button"
                  disabled={pending}
                  onClick={onResgatar}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-accent-500 px-4 text-[13px] font-bold text-[#04122b] transition-colors hover:bg-accent-400 disabled:opacity-60"
                >
                  <AetherIcon name="sparkle" className="h-4 w-4" />
                  {pending ? "Resgatando…" : "Resgatar grátis"}
                </button>
                <span className="text-[12px] text-ink-400">
                  Por tempo limitado. Resgatado, fica seu depois do prazo.
                </span>
              </div>
            ) : !usavel ? (
              <div className="grid gap-1.5">
                <button
                  type="button"
                  disabled={pending || falta > 0}
                  onClick={onComprar}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-accent-500 px-4 text-[13px] font-bold text-[#04122b] transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AetherIcon name="sparkle" className="h-4 w-4" />
                  {pending ? "Comprando…" : `Comprar por ${formatarMoedas(preco)}`}
                </button>
                <span className="text-[12px] text-ink-400">
                  {falta > 0
                    ? `Faltam ${formatarMoedas(falta)}. Você tem ${formatarMoedas(saldo)}.`
                    : `Você tem ${formatarMoedas(saldo)}.`}
                </span>
              </div>
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
          {erro ? <p className="text-[12px] text-signal-dnd">{erro}</p> : null}
        </div>
      </div>
    </Modal>
  );
}

/**
 * O cartao de perfil da pessoa com o item APLICADO sobre o que ela ja usa:
 * cada tipo mostra o item da previa se for dele, senao o equipado hoje. So
 * visual — nada aqui equipa.
 */
function PreviaNoPerfil({
  cosmetico,
  equipados,
  user,
}: {
  cosmetico: CosmeticoDeLoja;
  equipados: Record<CosmeticType, CosmeticoDeLoja | null>;
  user: UserInfo;
}) {
  const com = (tipo: CosmeticType) =>
    cosmetico.tipo === tipo ? cosmetico : equipados[tipo];
  const banner = com("BANNER");
  const deco = com("DECORATION");
  const placa = com("NAMEPLATE");
  const efeito = com("PROFILE_EFFECT");

  return (
    <div className="grid w-[220px] gap-2">
      <div className="relative rounded-xl border border-line bg-base-900">
        <div className="overflow-hidden rounded-t-xl">
          {banner ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={banner.assetUrl} alt="" className="h-[60px] w-full object-cover" />
          ) : (
            <div className="h-[52px] bg-gradient-to-r from-accent-700/40 to-accent-500/15" />
          )}
        </div>
        <div className="-mt-7 px-3 pb-4">
          {deco ? (
            <AvatarDecorado
              userId={user.id}
              name={user.displayName}
              src={user.avatarUrl}
              moldura={user.moldura}
              px={52}
              ring="border-base-900"
              decoracao={{ frenteUrl: deco.assetUrl, trasUrl: deco.assetTrasUrl }}
            />
          ) : (
            <Avatar
              userId={user.id}
              name={user.displayName}
              src={user.avatarUrl}
              moldura={user.moldura}
              px={52}
              ring="border-base-900"
            />
          )}
          <p className="mt-1.5 truncate text-[14px] font-semibold text-ink-100">
            {user.displayName}
          </p>
        </div>
        {efeito ? <CamadaDeEfeito url={efeito.assetUrl} /> : null}
      </div>
      <div className="relative isolate flex items-center gap-2 overflow-hidden rounded-md border border-line bg-base-900 px-2 py-[7px]">
        {placa ? <FundoDePlaca url={placa.assetUrl} /> : null}
        <Avatar
          userId={user.id}
          name={user.displayName}
          src={user.avatarUrl}
          moldura={user.moldura}
          size="sm"
        />
        <span className="truncate text-[13px] font-medium text-ink-100">
          {user.displayName}
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- missões */

function Missoes({
  inicial,
  onResgatar,
}: {
  inicial: MissaoDaPessoa[];
  onResgatar: (saldo: number) => void;
}) {
  const [missoes, setMissoes] = useState(inicial);
  const [resgatando, setResgatando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function resgatar(m: MissaoDaPessoa) {
    setErro(null);
    setResgatando(m.id);
    startTransition(async () => {
      const r = await resgatarMissaoAction(m.id);
      setResgatando(null);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      onResgatar(r.data.saldo);
      setMissoes((lista) =>
        lista.map((x) => (x.id === m.id ? { ...x, resgatada: true } : x)),
      );
    });
  }

  if (missoes.length === 0) return null;

  return (
    <section className="mt-7">
      <h2 className="text-[14px] font-semibold text-ink-100">Missões</h2>
      <p className="mt-1 text-[12.5px] text-ink-400">
        As diárias recomeçam à meia-noite (Brasília); as semanais, toda segunda.
        Tempo em voz conta com mais alguém no canal; tempo jogando conta com o
        app de desktop detectando o jogo.
      </p>
      {erro ? <p className="mt-2 text-[13px] text-signal-dnd">{erro}</p> : null}
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {missoes.map((m) => {
          const pct = Math.min(100, Math.round((m.valor / m.meta) * 100));
          return (
            <li
              key={m.id}
              className="grid gap-2 rounded-xl border border-line bg-base-900 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-ink-100">
                    {m.titulo}
                    <span className="ml-2 rounded border border-line px-1.5 py-px align-middle text-[10px] font-medium uppercase tracking-[0.06em] text-ink-500">
                      {m.periodo === "DIARIA" ? "Diária" : "Semanal"}
                    </span>
                  </p>
                  {m.descricao ? (
                    <p className="mt-0.5 text-[12px] text-ink-400">{m.descricao}</p>
                  ) : null}
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[12.5px] font-semibold text-accent-300">
                  <AetherIcon name="sparkle" className="h-3.5 w-3.5" />+{m.recompensa}
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={m.meta}
                aria-valuenow={Math.min(m.valor, m.meta)}
                aria-label={m.titulo}
                className="h-1.5 overflow-hidden rounded-full bg-base-750"
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width]",
                    m.concluida ? "bg-signal-online" : "bg-accent-500",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11.5px] tabular-nums text-ink-400">
                  {formatarProgresso(m.metrica, m.valor, m.meta)}
                </span>
                {m.resgatada ? (
                  <span className="text-[12px] font-semibold text-signal-online">
                    Resgatada ✓
                  </span>
                ) : m.concluida ? (
                  <button
                    type="button"
                    disabled={resgatando === m.id}
                    onClick={() => resgatar(m)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent-500 px-3 text-[12px] font-bold text-[#04122b] transition-colors hover:bg-accent-400 disabled:opacity-60"
                  >
                    {resgatando === m.id ? "Resgatando…" : "Resgatar"}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- extrato */

function Extrato({
  saldo,
  movimentos,
}: {
  saldo: number;
  movimentos: MovimentoPublico[];
}) {
  return (
    <section className="mt-7">
      <div className="rounded-xl border border-line bg-base-850 p-5">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-500">
          Saldo
        </span>
        <p className="mt-1 flex items-center gap-2 text-[26px] font-semibold text-ink-100">
          <AetherIcon name="sparkle" className="h-5 w-5 text-accent-400" />
          <span className="font-mono tabular-nums">{saldo.toLocaleString("pt-BR")}</span>
          <span className="text-[15px] font-medium text-ink-400">{MOEDA.plural}</span>
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-400">
          Use para comprar decorações e banners. Ganhe {MOEDA.plural} com as
          missões acima: tempo em voz, horas jogando e dias em que você aparece.
        </p>
      </div>

      <h2 className="mt-7 text-[14px] font-semibold text-ink-100">Extrato</h2>
      {movimentos.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-400">
          Nada por aqui ainda. Cada {MOEDA.singular} que entrar ou sair aparece
          nesta lista.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
          {movimentos.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 bg-base-900 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink-100">
                  {MOTIVO_LABEL[m.motivo]}
                  {m.descricao ? (
                    <span className="font-normal text-ink-400"> · {m.descricao}</span>
                  ) : null}
                </p>
                <time
                  dateTime={m.createdAt}
                  className="text-[11.5px] text-ink-500"
                  suppressHydrationWarning
                >
                  {new Date(m.createdAt).toLocaleString("pt-BR")}
                </time>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={cn(
                    "font-mono text-[13px] font-semibold tabular-nums",
                    m.valor > 0 ? "text-signal-online" : "text-ink-200",
                  )}
                >
                  {m.valor > 0 ? "+" : "−"}
                  {Math.abs(m.valor).toLocaleString("pt-BR")}
                </p>
                <p className="font-mono text-[11px] tabular-nums text-ink-500">
                  saldo {m.saldoDepois.toLocaleString("pt-BR")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
