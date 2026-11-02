"use client";

import { useState, useTransition } from "react";
import { colecaoNoAr, type ColecaoNoPainel } from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import {
  criarColecaoAction,
  editarColecaoAction,
  excluirColecaoAction,
} from "@/server/actions/colecoes";
import { cn } from "@/lib/utils";

/**
 * Colecoes da loja, no painel da equipe (aba Cosmeticos).
 *
 * Uma colecao agrupa itens na vitrine e, com periodo, decide quando eles se
 * vendem. Fora do periodo os itens saem da loja; quem ja os tem fica com eles.
 * A regra e `@aether/shared/colecoes` — aqui so o cadastro.
 */

type Estado = "no-ar" | "agendada" | "encerrada" | "rascunho";

const ESTADO: Record<Estado, { texto: string; cls: string }> = {
  "no-ar": { texto: "No ar", cls: "border-signal-online/40 text-signal-online" },
  agendada: { texto: "Agendada", cls: "border-accent-500/40 text-accent-300" },
  encerrada: { texto: "Encerrada", cls: "border-line text-ink-500" },
  rascunho: { texto: "Rascunho", cls: "border-line text-ink-400" },
};

function estadoDe(c: ColecaoNoPainel, agora: Date): Estado {
  if (!c.ativa) return "rascunho";
  const linha = {
    ativa: c.ativa,
    inicioEm: c.inicioEm ? new Date(c.inicioEm) : null,
    fimEm: c.fimEm ? new Date(c.fimEm) : null,
  };
  if (colecaoNoAr(linha, agora)) return "no-ar";
  return linha.inicioEm && agora < linha.inicioEm ? "agendada" : "encerrada";
}

/** ISO -> valor de `<input type="datetime-local">`, no fuso de quem edita. */
function paraCampoLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Valor do campo local -> ISO. Converte AQUI, no navegador, para o horario
 * ser o de quem digitou — o servidor roda em UTC e leria "18:00" como 18:00 UTC.
 */
function campoLocalParaIso(v: string): string {
  return v ? new Date(v).toISOString() : "";
}

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ColecoesSecao({
  colecoes,
  onMudou,
}: {
  colecoes: ColecaoNoPainel[];
  /** recarregar a lista (e o select de colecao do formulario de item) */
  onMudou: () => void;
}) {
  const [editando, setEditando] = useState<ColecaoNoPainel | "nova" | null>(null);
  const [excluindo, setExcluindo] = useState<ColecaoNoPainel | null>(null);
  const agora = new Date();

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-base-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-ink-100">Coleções</h3>
          <p className="text-[12px] text-ink-400">
            Agrupam itens na vitrine. Com período, os itens só se vendem dentro
            dele; quem já tem fica com o item.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setEditando("nova")}>
          <AetherIcon name="plus" className="h-3.5 w-3.5" />
          Nova coleção
        </Button>
      </div>

      {colecoes.length === 0 ? (
        <p className="text-[12px] text-ink-500">Nenhuma coleção ainda.</p>
      ) : (
        <ul className="grid gap-2">
          {colecoes.map((c) => {
            const e = ESTADO[estadoDe(c, agora)];
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-base-850 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink-100">
                    {c.nome}
                    {c.destaque ? (
                      <span className="ml-2 text-[11px] font-medium text-[#e5626b]">
                        destaque
                      </span>
                    ) : null}
                  </p>
                  <p className="font-mono text-[11px] text-ink-500">
                    {formatarData(c.inicioEm)} → {formatarData(c.fimEm)} ·{" "}
                    {c.itens} {c.itens === 1 ? "item" : "itens"}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                    e.cls,
                  )}
                >
                  {e.texto}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setEditando(c)}>
                  Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setExcluindo(c)}>
                  Excluir
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {editando ? (
        <FormularioColecao
          inicial={editando === "nova" ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
            onMudou();
          }}
        />
      ) : null}

      {excluindo ? (
        <ExcluirColecao
          colecao={excluindo}
          onFechar={() => setExcluindo(null)}
          onExcluida={() => {
            setExcluindo(null);
            onMudou();
          }}
        />
      ) : null}
    </section>
  );
}

function slugify(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function FormularioColecao({
  inicial,
  onFechar,
  onSalvo,
}: {
  inicial: ColecaoNoPainel | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const editando = inicial != null;
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [slug, setSlug] = useState(inicial?.slug ?? "");
  const [slugManual, setSlugManual] = useState(editando);
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [inicio, setInicio] = useState(paraCampoLocal(inicial?.inicioEm ?? null));
  const [fim, setFim] = useState(paraCampoLocal(inicial?.fimEm ?? null));
  const [destaque, setDestaque] = useState(inicial?.destaque ?? false);
  const [ativa, setAtiva] = useState(inicial?.ativa ?? false);
  const [ordem, setOrdem] = useState(String(inicial?.ordem ?? 0));
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const input = {
      nome,
      slug,
      descricao,
      inicioEm: campoLocalParaIso(inicio),
      fimEm: campoLocalParaIso(fim),
      destaque,
      ativa,
      ordem,
    };
    startTransition(async () => {
      const r = inicial
        ? await editarColecaoAction(inicial.id, input)
        : await criarColecaoAction(input);
      if (r.ok) onSalvo();
      else setErro(r.error);
    });
  }

  return (
    <Modal
      open
      onClose={onFechar}
      title={editando ? "Editar coleção" : "Nova coleção"}
      className="max-w-[520px]"
    >
      <form onSubmit={enviar} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" required>
            <Input
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                if (!slugManual) setSlug(slugify(e.target.value));
              }}
              maxLength={60}
              autoFocus
            />
          </Field>
          <Field label="Slug" required hint="Identificador estável. Não muda depois.">
            <Input
              value={slug}
              onChange={(e) => {
                setSlugManual(true);
                setSlug(e.target.value);
              }}
              disabled={editando}
              className="font-mono"
            />
          </Field>
        </div>

        <Field label="Descrição">
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            maxLength={240}
            rows={2}
            className="w-full rounded-md border border-line-strong bg-base-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-accent-600 focus:outline-none"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Início" hint="Vazio = já começou">
            <Input
              type="datetime-local"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
            />
          </Field>
          <Field label="Fim" hint="Vazio = sem prazo">
            <Input
              type="datetime-local"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-5">
          <label className="inline-flex items-center gap-2 text-[13px] text-ink-200">
            <input
              type="checkbox"
              checked={ativa}
              onChange={(e) => setAtiva(e.target.checked)}
              className="accent-accent-500"
            />
            Publicada
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] text-ink-200">
            <input
              type="checkbox"
              checked={destaque}
              onChange={(e) => setDestaque(e.target.checked)}
              className="accent-accent-500"
            />
            Em destaque na loja
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] text-ink-200">
            Ordem
            <Input
              value={ordem}
              onChange={(e) => setOrdem(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="w-20"
            />
          </label>
        </div>

        <p className="text-[12px] text-ink-500">
          Item grátis numa coleção com fim vira “Resgatar grátis”: quem resgata
          fica com ele depois do prazo.
        </p>

        <FieldError>{erro}</FieldError>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ExcluirColecao({
  colecao,
  onFechar,
  onExcluida,
}: {
  colecao: ColecaoNoPainel;
  onFechar: () => void;
  onExcluida: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Modal open onClose={onFechar} title="Excluir coleção" className="max-w-[440px]">
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-ink-300">
          Excluir <b className="text-ink-100">{colecao.nome}</b>? Os{" "}
          {colecao.itens} itens dela continuam no catálogo, sem coleção e sem
          prazo. Para tirar os itens da loja, despublique a coleção em vez de
          excluir.
        </p>
        <FieldError>{erro}</FieldError>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await excluirColecaoAction(colecao.id);
                if (r.ok) onExcluida();
                else setErro(r.error);
              })
            }
          >
            {pending ? "Excluindo…" : "Excluir"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
