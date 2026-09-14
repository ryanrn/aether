"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { DenunciaNaFila } from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import {
  apagarMensagemDenunciadaAction,
  listarDenunciasAction,
  resolverDenunciaAction,
  silenciarUsuarioAction,
} from "@/server/actions/denuncia";
import { cn } from "@/lib/utils";

/**
 * Fila de denuncias. So a equipe — `sessaoDaEquipe()` nas actions, 404 para o
 * resto. Cada linha: o que foi denunciado, quantas denuncias existem sobre o
 * mesmo alvo (reincidencia), e o que fazer.
 *
 * As acoes sao SEPARADAS de proposito: "resolver" fecha a denuncia; "silenciar
 * o autor" e "apagar a mensagem" sao decisoes proprias, cada uma com seu
 * rastro no log. Fechar a denuncia nao aplica nada sozinho.
 */

const MOTIVO_ROTULO: Record<string, string> = {
  spam: "Spam",
  assedio: "Assédio",
  conteudo: "Conteúdo impróprio",
  impersonacao: "Falsa identidade",
  outro: "Outro",
};

const TIPO_ROTULO: Record<string, string> = {
  MENSAGEM: "Mensagem",
  USUARIO: "Usuário",
  SERVIDOR: "Servidor",
};

export function DenunciasTab({ onAbertas }: { onAbertas: (n: number) => void }) {
  const [itens, setItens] = useState<DenunciaNaFila[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const [agindoEm, setAgindoEm] = useState<string | null>(null);
  /**
   * Id da denuncia esperando confirmacao de "apagar mensagem". Apagar
   * conteudo de outra pessoa e IRREVERSIVEL — antes disto era um clique so,
   * sem nenhuma barreira, a unica acao da fila sem confirmacao nenhuma.
   */
  const [confirmandoApagar, setConfirmandoApagar] =
    useState<DenunciaNaFila | null>(null);
  /**
   * Denuncia esperando a duracao do silenciamento. Era `window.prompt` — a
   * unica caixa nativa do navegador que sobrava no admin, contradizendo a
   * propria decisao de `confirm-dialog.tsx` de nunca usar caixa do sistema.
   */
  const [confirmandoSilenciar, setConfirmandoSilenciar] =
    useState<DenunciaNaFila | null>(null);
  const [diasSilenciar, setDiasSilenciar] = useState("");

  const carregar = useCallback(() => {
    void listarDenunciasAction({ status: "ABERTA" }).then((r) => {
      if (r.ok) {
        setItens(r.data.itens);
        onAbertas(r.data.itens.length);
      } else setErro(r.error);
    });
  }, [onAbertas]);

  useEffect(() => carregar(), [carregar]);

  function agir(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setErro(null);
    setAgindoEm(id);
    startTransition(async () => {
      const r = await fn();
      setAgindoEm(null);
      if (!r.ok) setErro(r.error ?? "Algo deu errado.");
      else carregar();
    });
  }

  if (erro && !itens) {
    return <p className="text-[13px] text-signal-dnd">{erro}</p>;
  }
  if (!itens) return <p className="text-[13px] text-ink-500">Carregando…</p>;
  if (itens.length === 0) {
    return (
      <p className="text-[13px] text-ink-500">Nenhuma denúncia aberta.</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {erro ? <p className="text-[12px] text-signal-dnd">{erro}</p> : null}

      {itens.map((d) => {
        const ocupado = pendente && agindoEm === d.id;
        return (
          <div
            key={d.id}
            className={cn(
              "rounded-lg border border-line bg-base-800 p-4",
              d.totalSobreAlvo > 1 && "border-amber-400/40",
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-xs bg-base-700 px-1.5 py-0.5 font-mono uppercase tracking-[0.04em] text-ink-300">
                {TIPO_ROTULO[d.tipo]}
              </span>
              <span className="rounded-xs bg-signal-dnd/15 px-1.5 py-0.5 text-signal-dnd">
                {MOTIVO_ROTULO[d.motivo] ?? d.motivo}
              </span>
              {d.totalSobreAlvo > 1 ? (
                <span className="flex items-center gap-1 rounded-xs bg-amber-400/15 px-1.5 py-0.5 text-amber-300">
                  <AetherIcon name="alert" className="h-3 w-3" />
                  {d.totalSobreAlvo} denúncias sobre este alvo
                </span>
              ) : null}
              <span className="ml-auto text-ink-500">
                {new Date(d.createdAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>

            {d.snapshot ? (
              <p className="mt-2 rounded-sm border border-line-soft bg-base-950 px-3 py-2 text-[12px] leading-snug text-ink-300">
                {d.snapshot}
              </p>
            ) : (
              <p className="mt-2 text-[12px] italic text-ink-500">
                O alvo não existe mais.
              </p>
            )}

            {d.detalhe ? (
              <p className="mt-2 text-[12px] leading-snug text-ink-400">
                “{d.detalhe}”
              </p>
            ) : null}

            <p className="mt-2 text-[11px] text-ink-500">
              por {d.reporter ? `@${d.reporter.username}` : "conta removida"}
              {" · "}
              <span className="font-mono">{d.tipo.toLowerCase()}:{d.alvoId.slice(0, 10)}</span>
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={ocupado}
                onClick={() =>
                  agir(d.id, () => resolverDenunciaAction(d.id, "RESOLVIDA"))
                }
                className="rounded-sm border border-signal-online/40 px-2.5 py-1 text-[11px] font-medium text-signal-online transition-colors hover:bg-signal-online/15 disabled:opacity-50"
              >
                Resolver
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() =>
                  agir(d.id, () => resolverDenunciaAction(d.id, "DESCARTADA"))
                }
                className="rounded-sm border border-line-strong px-2.5 py-1 text-[11px] font-medium text-ink-300 transition-colors hover:bg-base-750 disabled:opacity-50"
              >
                Descartar
              </button>

              {d.tipo === "MENSAGEM" ? (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => setConfirmandoApagar(d)}
                  className="rounded-sm border border-signal-dnd/40 px-2.5 py-1 text-[11px] font-medium text-signal-dnd transition-colors hover:bg-signal-dnd/15 disabled:opacity-50"
                >
                  Apagar mensagem + resolver
                </button>
              ) : null}

              {d.autorDoAlvoId ? (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => {
                    setDiasSilenciar("");
                    setConfirmandoSilenciar(d);
                  }}
                  className="rounded-sm border border-amber-400/40 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-400/15 disabled:opacity-50"
                >
                  Silenciar autor
                </button>
              ) : null}
            </div>
          </div>
        );
      })}

      <p className="mt-1 text-[12px] leading-snug text-ink-500">
        “Silenciar autor” revoga as sessões e derruba os sockets — a pessoa
        continua lendo mas não manda mensagem. Sem log de auditoria global
        ainda; o rastro fica no log estruturado (<code>moderacao.*</code>).
      </p>

      <ConfirmDialog
        open={confirmandoApagar !== null}
        onClose={() => setConfirmandoApagar(null)}
        title="Apagar mensagem"
        confirmLabel="Apagar e resolver"
        pendingLabel="Apagando..."
        pending={
          pendente &&
          confirmandoApagar !== null &&
          agindoEm === confirmandoApagar.id
        }
        onConfirm={() => {
          const alvo = confirmandoApagar;
          if (!alvo) return;
          agir(alvo.id, async () => {
            const r = await apagarMensagemDenunciadaAction(alvo.alvoId);
            if (r.ok) {
              await resolverDenunciaAction(alvo.id, "RESOLVIDA", "mensagem apagada");
              setConfirmandoApagar(null);
            }
            return r;
          });
        }}
      >
        Isso apaga o conteúdo da mensagem denunciada para sempre — não dá para
        desfazer.
        {confirmandoApagar?.snapshot ? (
          <span className="mt-2 block rounded-sm border border-line-soft bg-base-950 px-3 py-2 text-ink-400">
            “{confirmandoApagar.snapshot}”
          </span>
        ) : null}
      </ConfirmDialog>

      <Modal
        open={confirmandoSilenciar !== null}
        onClose={() => setConfirmandoSilenciar(null)}
        title="Silenciar autor"
        className="max-w-[380px]"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="den-dias-silenciar">
            Por quantos dias{" "}
            <span className="font-normal text-ink-500">
              — vazio = indefinido
            </span>
          </Label>
          <Input
            id="den-dias-silenciar"
            inputMode="numeric"
            autoFocus
            value={diasSilenciar}
            onChange={(e) => setDiasSilenciar(e.target.value)}
            placeholder="7"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => setConfirmandoSilenciar(null)}
            disabled={
              pendente &&
              confirmandoSilenciar !== null &&
              agindoEm === confirmandoSilenciar.id
            }
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={
              pendente &&
              confirmandoSilenciar !== null &&
              agindoEm === confirmandoSilenciar.id
            }
            onClick={() => {
              const alvo = confirmandoSilenciar;
              if (!alvo?.autorDoAlvoId) return;
              const dias = diasSilenciar.trim();
              agir(alvo.id, async () => {
                const r = await silenciarUsuarioAction({
                  userId: alvo.autorDoAlvoId!,
                  motivo: MOTIVO_ROTULO[alvo.motivo],
                  dias: dias ? Number(dias) : null,
                });
                if (r.ok) {
                  await resolverDenunciaAction(alvo.id, "RESOLVIDA", "autor silenciado");
                  setConfirmandoSilenciar(null);
                }
                return r;
              });
            }}
          >
            {pendente &&
            confirmandoSilenciar !== null &&
            agindoEm === confirmandoSilenciar.id
              ? "Silenciando..."
              : "Silenciar"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
