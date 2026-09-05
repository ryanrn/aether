"use client";

import { useEffect, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { ToggleRow } from "@/components/ui/switch";
import {
  iniciaComWindows,
  podeIniciarComWindows,
  setIniciarComWindows,
} from "@/lib/desktop/game-activity";
import {
  aoMudarEstado,
  estadoDaAtualizacao,
  instalarAtualizacao,
  podeAtualizar,
  verificarAgora,
  type EstadoAtualizacao,
} from "@/lib/desktop/update";
import { cn } from "@/lib/utils";

/**
 * Este computador — o que vale so nesta maquina.
 *
 * POR QUE ABA PROPRIA: versao instalada e "abrir junto com o Windows" moravam
 * em "Atividade", que e sobre O QUE OS AMIGOS VEEM voce fazendo. Nao tem
 * relacao nenhuma. Cairam la pelo mesmo motivo que a deteccao de jogo caiu em
 * "Voz e video" antes: foi onde coube na hora.
 *
 * O criterio que separa esta aba do resto e real, e nao arrumacao: TUDO o
 * mais nas Configuracoes segue a CONTA — troca de computador e continua
 * valendo. Estas duas seguem a MAQUINA. Cada PC tem sua versao instalada e sua
 * propria escolha de abrir no boot.
 *
 * So existe no aplicativo de desktop. No navegador nao ha versao instalada
 * nem inicializacao do sistema — a aba inteira nao e montada (ver
 * `app-settings-modal.tsx`).
 */
export function EsteComputadorTab() {
  const [podeIniciar, setPodeIniciar] = useState(false);
  const [iniciaJunto, setIniciaJunto] = useState(false);
  const [salvandoInicio, setSalvandoInicio] = useState(false);
  const [atualizacao, setAtualizacao] = useState<EstadoAtualizacao | null>(
    null,
  );
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    // `window.aetherDesktop` nao existe no servidor: so depois de montar.
    setPodeIniciar(podeIniciarComWindows());
    void iniciaComWindows().then(setIniciaJunto);
    if (podeAtualizar()) {
      void estadoDaAtualizacao().then(setAtualizacao);
      return aoMudarEstado(setAtualizacao);
    }
  }, []);

  async function verificar() {
    setVerificando(true);
    setAtualizacao(await verificarAgora());
    setVerificando(false);
  }

  async function alternarInicio(desejado: boolean) {
    setSalvandoInicio(true);
    /**
     * Mostra o que o SISTEMA confirmou, e nao o que a caixa marcou. O Windows
     * pode recusar (politica de grupo, permissao), e a tela dizer "ligado"
     * enquanto o app nao abre no boot seria a pior forma de errar aqui.
     */
    setIniciaJunto(await setIniciarComWindows(desejado));
    setSalvandoInicio(false);
  }

  return (
    <section className="flex flex-col gap-6">
      {atualizacao ? (
        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[13px] font-medium text-ink-100">
                Versao do app
              </h3>
              <p className="mt-1 text-[12px] text-ink-400">
                {atualizacao.versaoAtual
                  ? `Voce esta na ${atualizacao.versaoAtual}.`
                  : "Casca do app."}{" "}
                {textoDaAtualizacao(atualizacao)}
              </p>
            </div>

            {/*
              Botao de VERIFICAR, e nao so a checagem automatica.

              A automatica roda 8s depois de abrir e de 6 em 6 horas, sem dizer
              nada. Quando ela nao funciona — e nao funcionou — nao ha como
              distinguir "ja estou atualizado" de "nem tentou".
            */}
            <button
              type="button"
              onClick={verificar}
              disabled={verificando || atualizacao.fase === "baixando"}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink-200 transition-colors hover:bg-base-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AetherIcon
                name="refresh"
                className={cn("h-3.5 w-3.5", verificando && "animate-spin")}
                strokeWidth={1.75}
              />
              Verificar
            </button>
          </div>

          {/*
            A BARRA DE PROGRESSO e o ponto principal desta secao. Sao 82 MB
            baixando; sem nada na tela, fechar o app no meio parece inofensivo
            — e descarta tudo, recomecando do zero na proxima abertura. Foi
            assim que a 0.1.10 nao chegou.
          */}
          {atualizacao.fase === "baixando" ? (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-base-800">
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{
                    width: `${atualizacao.progresso}%`,
                    backgroundColor: "#68af64",
                  }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-ink-500">
                Deixe o app aberto ate terminar — fechar agora descarta o que ja
                baixou.
              </p>
            </div>
          ) : null}

          {atualizacao.fase === "pronta" ? (
            <button
              type="button"
              onClick={() => void instalarAtualizacao()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: "#68af64" }}
            >
              <AetherIcon
                name="download"
                className="h-3.5 w-3.5"
                strokeWidth={2.25}
              />
              Reiniciar e instalar a {atualizacao.versao}
            </button>
          ) : null}
        </div>
      ) : null}

      {podeIniciar ? (
        <div className={cn(atualizacao && "border-t border-line pt-5")}>
          <h3 className="text-[13px] font-medium text-ink-100">
            Ao ligar o computador
          </h3>
          <ToggleRow
            checked={iniciaJunto}
            disabled={salvandoInicio}
            onCheckedChange={alternarInicio}
            title="Abrir o Aether junto com o Windows"
            description="A janela abre normalmente, nao escondida. Quem manda nisto e a inicializacao do Windows: tirar o Aether de la pelo Gerenciador de Tarefas tambem desmarca esta chave."
          />
        </div>
      ) : null}

      {/*
        A aba so e montada no desktop, mas as duas secoes dependem de pontes
        que podem faltar (versao antiga do app, permissao negada). Sem isto a
        aba abriria em branco, sem dizer por que.
      */}
      {!atualizacao && !podeIniciar ? (
        <p className="rounded-md border border-line bg-base-900 p-3 text-[13px] leading-relaxed text-ink-400">
          Nada para ajustar nesta maquina — o aplicativo instalado aqui nao
          expoe atualizacao nem inicializacao automatica.
        </p>
      ) : null}
    </section>
  );
}

/** A frase que descreve o estado, em portugues de gente. */
function textoDaAtualizacao(estado: EstadoAtualizacao): string {
  switch (estado.fase) {
    case "verificando":
      return "Procurando versao nova...";
    case "baixando":
      return `Baixando a ${estado.versao ?? "versao nova"} (${estado.progresso}%).`;
    case "pronta":
      return `A ${estado.versao ?? "versao nova"} esta pronta para instalar.`;
    case "atualizado":
      return "Esta e a versao mais recente.";
    case "erro":
      // A causa vai para o arquivo de log; aqui fica a versao curta.
      return "Nao consegui verificar agora.";
    default:
      return "";
  }
}
