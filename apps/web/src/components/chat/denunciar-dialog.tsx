"use client";

import { useState, useTransition } from "react";
import { MOTIVOS_DE_DENUNCIA } from "@aether/shared";
import { Modal } from "@/components/ui/modal";
import { denunciarAction } from "@/server/actions/denuncia";
import { cn } from "@/lib/utils";

/**
 * Dialogo de denuncia. Reutilizado para mensagem, usuario e servidor — o que
 * muda e o `tipo` e o `alvoId`. A resposta e sempre "recebemos", inclusive
 * para denuncia duplicada: nada a ganhar em distinguir para quem denuncia.
 */

const MOTIVOS = MOTIVOS_DE_DENUNCIA;

export function DenunciarDialog({
  open,
  onClose,
  tipo,
  alvoId,
  oQue,
}: {
  open: boolean;
  onClose: () => void;
  tipo: "MENSAGEM" | "USUARIO" | "SERVIDOR";
  alvoId: string;
  /** texto curto do que está sendo denunciado, para o cabeçalho */
  oQue: string;
}) {
  const [motivo, setMotivo] = useState<string>("");
  const [detalhe, setDetalhe] = useState("");
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, start] = useTransition();

  function fechar() {
    onClose();
    // reset depois da animação de saída
    setTimeout(() => {
      setMotivo("");
      setDetalhe("");
      setPronto(false);
      setErro(null);
    }, 200);
  }

  function enviar() {
    if (!motivo) return;
    setErro(null);
    start(async () => {
      const r = await denunciarAction({
        tipo,
        alvoId,
        motivo,
        detalhe: detalhe.trim() || undefined,
      });
      if (r.ok) setPronto(true);
      else setErro(r.error);
    });
  }

  return (
    <Modal
      open={open}
      onClose={fechar}
      title="Denunciar"
      description={pronto ? undefined : oQue}
    >
      {pronto ? (
        <div className="flex flex-col gap-3 py-2">
          <p className="text-[13px] text-ink-300">
            Recebemos sua denúncia. A equipe vai revisar. Obrigado por ajudar a
            manter o AETHER seguro.
          </p>
          <button
            type="button"
            onClick={fechar}
            className="self-end rounded-sm bg-accent-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-600"
          >
            Fechar
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            {MOTIVOS.map((m) => (
              <label
                key={m.valor}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-sm border px-3 py-2 text-[13px] transition-colors",
                  motivo === m.valor
                    ? "border-accent-line bg-accent-500/10 text-ink-100"
                    : "border-line text-ink-300 hover:bg-base-800",
                )}
              >
                <input
                  type="radio"
                  name="motivo"
                  value={m.valor}
                  checked={motivo === m.valor}
                  onChange={() => setMotivo(m.valor)}
                  className="accent-accent-500"
                />
                {m.rotulo}
              </label>
            ))}
          </fieldset>

          <textarea
            value={detalhe}
            onChange={(e) => setDetalhe(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Detalhe (opcional) — o que aconteceu?"
            className="rounded-sm border border-line bg-base-950 px-3 py-2 text-[13px] text-ink-100 placeholder:text-ink-500 focus:border-accent-line focus:outline-none"
          />

          {erro ? <p className="text-[12px] text-signal-dnd">{erro}</p> : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={fechar}
              className="rounded-sm border border-line-strong px-4 py-2 text-[13px] text-ink-300 hover:bg-base-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={enviar}
              disabled={!motivo || enviando}
              className="rounded-sm bg-signal-dnd px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-50"
            >
              {enviando ? "Enviando…" : "Denunciar"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
