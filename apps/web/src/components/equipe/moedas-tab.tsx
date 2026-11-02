"use client";

import { useState, useTransition } from "react";
import { CONCESSAO_MAXIMA, formatarMoedas, MOEDA } from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { concederMoedasAction } from "@/server/actions/moedas";

/**
 * Dar ou tirar moedas de alguem: premio de evento, correcao de erro, teste.
 *
 * Valor negativo tira; tirar mais do que a pessoa tem e recusado inteiro (o
 * saldo nunca fica negativo). Cada envio vira uma linha no extrato da pessoa
 * e uma entrada na auditoria global, com quem enviou e a nota.
 */
export function MoedasTab() {
  const [username, setUsername] = useState("");
  const [valor, setValor] = useState("");
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setFeito(null);
    const n = Number(valor);
    startTransition(async () => {
      const r = await concederMoedasAction(username, n, nota);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setFeito(
        `${n > 0 ? "Enviado" : "Retirado"}: ${formatarMoedas(n)} para @${username.trim()}. Saldo agora: ${formatarMoedas(r.data.saldo)}.`,
      );
      setValor("");
      setNota("");
    });
  }

  const campo =
    "h-10 w-full rounded-md border border-line bg-base-900 px-3 text-[13px] text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-500";

  return (
    <form onSubmit={enviar} className="grid max-w-md gap-4">
      <p className="text-[13px] leading-relaxed text-ink-400">
        Envie {MOEDA.plural} para alguém (prêmio, correção, teste). Use um valor
        negativo para retirar. Tudo fica no extrato da pessoa e na auditoria
        global.
      </p>

      <label className="grid gap-1.5">
        <span className="text-[12px] font-medium text-ink-300">Usuário</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="nomedeusuario"
          autoComplete="off"
          className={campo}
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[12px] font-medium text-ink-300">
          Valor (até {CONCESSAO_MAXIMA.toLocaleString("pt-BR")}, negativo retira)
        </span>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value.replace(/[^\d-]/g, ""))}
          inputMode="numeric"
          placeholder="500"
          className={campo}
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[12px] font-medium text-ink-300">
          Nota (aparece no extrato da pessoa)
        </span>
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={200}
          placeholder="Prêmio do evento de sábado"
          className={campo}
        />
      </label>

      <button
        type="submit"
        disabled={pendente || !username.trim() || !valor || valor === "-"}
        className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-accent-500 px-4 text-[13px] font-bold text-[#04122b] transition-colors hover:bg-accent-400 disabled:opacity-50"
      >
        <AetherIcon name="sparkle" className="h-4 w-4" />
        {pendente ? "Enviando…" : "Enviar"}
      </button>

      {erro ? <p className="text-[13px] text-signal-dnd">{erro}</p> : null}
      {feito ? <p className="text-[13px] text-signal-online">{feito}</p> : null}
    </form>
  );
}
