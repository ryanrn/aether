"use client";

import { useEffect, useState, useTransition } from "react";
import { Field } from "@/components/ui/field";
import { carregarPerfilAction } from "@/server/actions/perfil";
import { atualizarBioAction } from "@/server/actions/profile";

/**
 * Bio do perfil global — a que aparece no cartao quando alguem clica no seu
 * nome no chat.
 *
 * Busca a bio atual ao abrir (nao chega no `user` da aba: bio nao viaja no
 * `PublicUser`). Vazia APAGA. Teto de 190, o mesmo do `bioSchema`.
 */
const MAX = 190;

export function EditorDeBio({ userId }: { userId: string }) {
  const [valor, setValor] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  useEffect(() => {
    let vivo = true;
    void carregarPerfilAction({ userId }).then((r) => {
      if (vivo && r.ok) {
        setValor(r.data.bio ?? "");
        setSalvo(r.data.bio ?? "");
      }
    });
    return () => {
      vivo = false;
    };
  }, [userId]);

  function guardar() {
    if (valor === null) return;
    setErro(null);
    iniciar(async () => {
      const r = await atualizarBioAction(valor);
      if (r.ok) setSalvo(r.data.bio ?? "");
      else setErro(r.error ?? "Nao deu certo.");
    });
  }

  const carregando = valor === null;
  const mudou = !carregando && valor.trim() !== (salvo ?? "");

  return (
    <Field
      label="Bio"
      hint="Aparece no seu cartao de perfil, no chat. Vazio remove."
    >
      <div className="rounded-md border border-line-strong bg-base-900">
        <textarea
          value={valor ?? ""}
          disabled={carregando || pendente}
          onChange={(e) => setValor(e.target.value.slice(0, MAX))}
          rows={3}
          placeholder={carregando ? "Carregando..." : "Escreva algo sobre voce"}
          className="block w-full resize-none bg-transparent px-3 py-2 text-[13px] leading-relaxed text-ink-100 outline-none placeholder:text-ink-600"
        />
        <div className="flex items-center justify-between border-t border-line px-3 py-1.5">
          <span className="font-mono text-[10px] tabular-nums text-ink-500">
            {(valor ?? "").length}/{MAX}
          </span>
          <button
            type="button"
            onClick={guardar}
            disabled={!mudou || pendente}
            className="text-[12px] font-medium text-accent-300 transition-colors hover:text-accent-200 disabled:cursor-not-allowed disabled:text-ink-600"
          >
            {pendente ? "Salvando..." : "Salvar bio"}
          </button>
        </div>
      </div>
      {erro ? (
        <p className="text-[12px] text-signal-dnd">{erro}</p>
      ) : null}
    </Field>
  );
}
