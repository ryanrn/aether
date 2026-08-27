"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  CODECS_DE_TELA,
  codecDisponivel,
  codecsSuportados,
  lerCodecDeTela,
  salvarCodecDeTela,
  type EscolhaDeCodec,
} from "@/lib/voice/codecs";
import {
  lerTratamentoDeAudio,
  salvarTratamentoDeAudio,
  type TratamentoDeAudio,
} from "@/lib/voice/audio-prefs";
import { cn } from "@/lib/utils";

/**
 * Configuracoes avancadas de midia: codec da tela e tratamento do microfone.
 *
 * SO A CASCA VISUAL mora aqui. Decidir o que o navegador suporta, guardar a
 * escolha e traduzir para constraints e trabalho de `lib/voice/codecs.ts` e
 * `lib/voice/audio-prefs.ts` — este arquivo le e escreve, e nao sabe o que
 * `videoCodec` significa para o LiveKit.
 */

export function MediaAdvanced() {
  return (
    <div className="flex flex-col gap-6">
      <CodecDaTela />
      <TratamentoDoMicrofone />
    </div>
  );
}

function CodecDaTela() {
  const [escolha, setEscolha] = useState<EscolhaDeCodec>(null);
  const [suportados, setSuportados] = useState<Set<string> | null>(null);

  /**
   * Depois de montar: `localStorage` e `RTCRtpSender` nao existem no servidor,
   * e ler no primeiro render daria erro de hidratacao.
   */
  useEffect(() => {
    setEscolha(lerCodecDeTela());
    setSuportados(codecsSuportados());
  }, []);

  function escolher(valor: EscolhaDeCodec) {
    setEscolha(valor);
    salvarCodecDeTela(valor);
  }

  return (
    <div>
      <h3 className="text-[13px] font-medium text-ink-100">
        Codec do compartilhamento de tela
      </h3>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
        Vale para a proxima transmissao. Quem ja estiver assistindo continua no
        codec em que a atual comecou.
      </p>

      <div className="mt-3 flex flex-col gap-1">
        {CODECS_DE_TELA.map((codec) => {
          const disponivel = codecDisponivel(codec.valor, suportados);
          const ativo = escolha === codec.valor;

          return (
            <button
              key={codec.rotulo}
              type="button"
              disabled={!disponivel}
              onClick={() => escolher(codec.valor)}
              className={cn(
                "flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors",
                ativo
                  ? "border-accent-600/60 bg-accent-600/10"
                  : "border-base-700 bg-base-900 hover:border-base-600",
                !disponivel && "cursor-not-allowed opacity-45 hover:border-base-700",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border",
                  ativo
                    ? "border-accent-500 bg-accent-500"
                    : "border-base-600",
                )}
              >
                {ativo ? (
                  <Check className="h-2.5 w-2.5 text-base-950" strokeWidth={3.5} />
                ) : null}
              </span>

              <span className="min-w-0 flex-1 leading-tight">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-ink-100">{codec.rotulo}</span>
                  {codec.recomendado ? (
                    <span className="rounded-full bg-accent-600/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-accent-300">
                      recomendado
                    </span>
                  ) : null}
                  {/*
                    O aviso e sobre CODIFICAR, nao decodificar. Quase todo
                    navegador abre H.265; quase nenhum consegue gerar. Sem
                    dizer isso, a pessoa escolheria e a transmissao falharia.
                  */}
                  {!disponivel ? (
                    <span className="rounded-full border border-base-600 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-ink-500">
                      seu navegador nao codifica
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[11px] text-ink-500">
                  {descricao(codec.valor)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** O que cada escolha significa na pratica, sem jargao de codec. */
function descricao(codec: EscolhaDeCodec): string {
  switch (codec) {
    case null:
      return "O app escolhe o melhor que a sua placa de video consegue codificar em hardware.";
    case "vp8":
      return "O mais compativel de todos. Gasta mais banda para a mesma nitidez.";
    case "h264":
      return "Compatibilidade ampla e codificacao em hardware na maioria das maquinas.";
    case "vp9":
      return "Bem mais eficiente que o VP8; pode pesar na CPU se nao houver hardware.";
    case "av1":
      return "A melhor compressao. Exige placa recente para nao pesar.";
    case "h265":
      return "Otima compressao, mas poucos navegadores conseguem codificar.";
  }
}

function TratamentoDoMicrofone() {
  const [tratamento, setTratamento] = useState<TratamentoDeAudio | null>(null);

  useEffect(() => setTratamento(lerTratamentoDeAudio()), []);

  function alternar(campo: keyof TratamentoDeAudio) {
    if (!tratamento) return;
    const novo = { ...tratamento, [campo]: !tratamento[campo] };
    setTratamento(novo);
    salvarTratamentoDeAudio(novo);
  }

  // Ate ler a preferencia, nao desenha caixa nenhuma: mostrar tudo ligado e
  // depois corrigir seria piscar um estado que pode nao ser o da pessoa.
  if (!tratamento) return null;

  return (
    <div className="border-t border-base-800 pt-5">
      <h3 className="text-[13px] font-medium text-ink-100">
        Tratamento do microfone
      </h3>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
        Os tres vem ligados e sao o certo para conversa. Desligue se voce toca,
        canta ou passa uma mesa de som pelo microfone — eles foram feitos para
        favorecer fala e achatam o resto.
      </p>

      <div className="mt-3 flex flex-col gap-2.5">
        <Chave
          ligada={tratamento.supressaoDeRuido}
          onChange={() => alternar("supressaoDeRuido")}
          titulo="Supressao de ruido"
          detalhe="Corta ventilador, teclado e chiado constante. Tambem corta sustentacao e reverberacao de instrumento."
        />
        <Chave
          ligada={tratamento.cancelamentoDeEco}
          onChange={() => alternar("cancelamentoDeEco")}
          titulo="Cancelamento de eco"
          detalhe="Impede que o som da sua caixa volte para a call. Desligado, use fone — sem ele o eco e certo."
        />
        <Chave
          ligada={tratamento.ganhoAutomatico}
          onChange={() => alternar("ganhoAutomatico")}
          titulo="Ganho automatico"
          detalhe="Equilibra o volume da sua voz. Em musica, ele bombeia: sobe nas pausas e abaixa no ataque."
        />
      </div>

      <p className="mt-3 text-[11px] text-ink-500">
        A mudanca vale na proxima vez que voce entrar numa call.
      </p>
    </div>
  );
}

function Chave({
  ligada,
  onChange,
  titulo,
  detalhe,
}: {
  ligada: boolean;
  onChange: () => void;
  titulo: string;
  detalhe: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={ligada}
        onChange={onChange}
        className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-accent-500)]"
      />
      <span className="leading-tight">
        <span className="block text-[13px] text-ink-200">{titulo}</span>
        <span className="block text-[11px] text-ink-500">{detalhe}</span>
      </span>
    </label>
  );
}
