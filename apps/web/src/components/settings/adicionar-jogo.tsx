"use client";

import { useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { listarCandidatosAJogo } from "@/lib/desktop/game-activity";
import { sugerirJogoAction } from "@/server/actions/jogos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * "Nao esta vendo seu jogo? Adicione-o."
 *
 * A deteccao so conhece jogo que alguma LOJA declarou ter instalado. Jogo fora
 * de loja nao tem quem responda "onde voce esta" — aqui a pessoa responde.
 *
 * A LISTA DE PROCESSOS SO E PEDIDA QUANDO ESTA TELA ABRE, e o processo
 * principal so responde se a deteccao estiver ligada. E uma excecao consciente
 * ao invariante de que a pagina nunca ve processos: acontece a pedido, uma vez,
 * e o que chega sao NOMES — jamais caminhos, que carregariam o nome de usuario
 * do Windows.
 *
 * O que a pessoa manda vai para uma FILA, e nao direto para o catalogo: um
 * jogo aprovado vale para a base inteira, e sem revisao bastaria alguem
 * sugerir `chrome.exe = Google Chrome` para todo mundo aparecer jogando
 * Chrome.
 */
export function AdicionarJogo() {
  const [aberto, setAberto] = useState(false);
  const [candidatos, setCandidatos] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function abrir() {
    setAberto(true);
    setAviso(null);
    setEscolhido(null);
    setCarregando(true);
    void listarCandidatosAJogo()
      .then(setCandidatos)
      .finally(() => setCarregando(false));
  }

  function escolher(executavel: string) {
    setEscolhido(executavel);
    /**
     * O nome sugerido comeca como o executavel SEM a extensao, e nao vazio: a
     * pessoa costuma so confirmar, e um campo em branco convida a desistir. A
     * revisao corrige depois o que vier torto.
     */
    setNome(executavel.replace(/\.exe$/i, ""));
    setAviso(null);
  }

  function enviar() {
    if (!escolhido) return;
    setAviso(null);
    startTransition(async () => {
      const r = await sugerirJogoAction(escolhido, nome);
      if (!r.ok) {
        setAviso(r.error);
        return;
      }
      if (r.data.status === "APROVADO") {
        setAviso(
          "Esse ja esta na biblioteca — deve aparecer na proxima verificacao.",
        );
      } else if (r.data.status === "RECUSADO") {
        setAviso("Esse ja foi analisado e recusado.");
      } else if (r.data.jaSugerido) {
        setAviso("Voce ja tinha sugerido esse. Esta na fila.");
      } else {
        setAviso("Recebido. Vamos conferir antes de valer para todo mundo.");
      }
      setEscolhido(null);
      setCandidatos((atual) => atual.filter((c) => c !== escolhido));
    });
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={abrir}
        className="self-start text-[12px] text-ink-500 transition-colors hover:text-accent-300"
      >
        Nao esta vendo seu jogo?{" "}
        <span className="text-accent-400 underline underline-offset-2">
          Adicione-o
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-line bg-base-950 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
          adicionar um jogo
        </p>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="text-[11px] text-ink-500 hover:text-ink-300"
        >
          fechar
        </button>
      </div>

      <p className="text-[12px] leading-relaxed text-ink-400">
        Escolha o programa do jogo na lista. Ele entra numa fila e, depois de
        conferido, passa a ser reconhecido para todo mundo.
      </p>

      {aviso ? (
        <p className="rounded-md border border-line bg-base-900 px-2.5 py-2 text-[12px] text-ink-300">
          {aviso}
        </p>
      ) : null}

      {carregando ? (
        <p className="text-[12px] text-ink-500">
          Lendo os programas abertos...
        </p>
      ) : candidatos.length === 0 ? (
        <p className="text-[12px] text-ink-500">
          Nada para sugerir. Abra o jogo antes, e deixe a deteccao ligada.
        </p>
      ) : (
        <div className="max-h-44 overflow-y-auto rounded-md border border-line">
          {candidatos.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => escolher(c)}
              className={cn(
                "block w-full truncate px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors",
                escolhido === c
                  ? "bg-accent-500/15 text-accent-200"
                  : "text-ink-400 hover:bg-base-850 hover:text-ink-200",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {escolhido ? (
        <div className="flex items-center gap-2">
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do jogo"
            maxLength={80}
            className="h-8 text-[13px]"
          />
          <Button type="button" size="sm" onClick={enviar} disabled={pending}>
            <AetherIcon name="plus" className="h-3.5 w-3.5" />
            {pending ? "Enviando..." : "Enviar"}
          </Button>
        </div>
      ) : null}

      {/*
        O mesmo cuidado do resto desta aba: quem vai mandar algo merece saber
        exatamente o que vai junto. Aqui a frase importa mais do que em
        qualquer outro lugar, porque e a unica tela do app em que a pessoa ve
        a propria lista de programas.
      */}
      <p className="text-[11px] leading-relaxed text-ink-500">
        Vai apenas o <span className="text-ink-300">nome do programa</span> e o
        nome que voce escrever. O caminho da instalacao nao sai da sua maquina.
      </p>
    </div>
  );
}
