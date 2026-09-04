"use client";

import { useEffect, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
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
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { cn } from "@/lib/utils";

/**
 * Configuracoes avancadas de midia: codec da tela e tratamento do microfone.
 *
 * SO A CASCA VISUAL mora aqui. Decidir o que o navegador suporta, guardar a
 * escolha e traduzir para constraints e trabalho de `lib/voice/codecs.ts` e
 * `lib/voice/audio-prefs.ts` — este arquivo le e escreve, e nao sabe o que
 * `videoCodec` significa para o LiveKit.
 */

/**
 * As duas metades sao EXPORTADAS SEPARADAS, e nao mais empacotadas juntas.
 *
 * Elas estavam sob um titulo unico de "avancado", e isso misturava duas coisas
 * que nao tem relacao: como o SEU MICROFONE e tratado antes de sair, e como a
 * SUA TELA e codificada quando voce transmite. Quem foi procurar o codec da
 * tela passava por tres chaves de microfone; quem foi desligar a supressao de
 * ruido esbarrava em AV1.
 *
 * Agora cada uma entra no grupo a que pertence, e o agrupamento e feito por
 * quem monta a tela — nao aqui.
 */
export function CodecDaTela() {
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
      {/*
        Sem titulo proprio: o grupo "Transmissao" ja diz do que se trata, e
        repetir aqui empilharia dois cabecalhos dizendo a mesma coisa.
      */}
      <h4 className="text-[13px] font-medium text-ink-100">Codec do video</h4>
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
                  : "border-line bg-base-900 hover:border-line-strong",
                !disponivel &&
                  "cursor-not-allowed opacity-45 hover:border-line",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border",
                  ativo
                    ? "border-accent-500 bg-accent-500"
                    : "border-line-strong",
                )}
              >
                {ativo ? (
                  <AetherIcon
                    name="check"
                    size="sm"
                    className="h-2.5 w-2.5 text-base-950 [stroke-width:3]"
                  />
                ) : null}
              </span>

              <span className="min-w-0 flex-1 leading-tight">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-ink-100">
                    {codec.rotulo}
                  </span>
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
                    <span className="rounded-full border border-line-strong px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-ink-500">
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

export function TratamentoDoMicrofone() {
  const [tratamento, setTratamento] = useState<TratamentoDeAudio | null>(null);
  const roomControls = useRealtimeStore((s) => s.roomControls);

  useEffect(() => setTratamento(lerTratamentoDeAudio()), []);

  function alternar(campo: keyof TratamentoDeAudio) {
    if (!tratamento) return;
    const valorAtual = tratamento[campo];
    if (typeof valorAtual !== "boolean") return;
    const novo = { ...tratamento, [campo]: !valorAtual };
    setTratamento(novo);
    salvarTratamentoDeAudio(novo);
  }

  /** Forca do gate do RNNoise (0..1). Aplica ao vivo se houver call. */
  function ajustarForca(valor: number) {
    if (!tratamento) return;
    const novo = { ...tratamento, forcaRnnoise: valor };
    setTratamento(novo);
    salvarTratamentoDeAudio(novo);
    roomControls?.definirForcaSupressao(valor);
  }

  // Ate ler a preferencia, nao desenha caixa nenhuma: mostrar tudo ligado e
  // depois corrigir seria piscar um estado que pode nao ser o da pessoa.
  if (!tratamento) return null;

  return (
    <div className="border-t border-line pt-5">
      <h4 className="text-[13px] font-medium text-ink-100">
        Tratamento do microfone
      </h4>
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

      {/*
        RNNoise separado das tres nativas por uma linha: as outras sao chaves
        do navegador, esta baixa um modelo e roda a cada 10ms. Juntas, pareceria
        que custam a mesma coisa.
      */}
      <div className="mt-4 border-t border-line pt-4">
        <Chave
          ligada={tratamento.rnnoise}
          onChange={() => alternar("rnnoise")}
          titulo="Supressao de ruido avancada (RNNoise)"
          detalhe="Modelo de IA rodando na sua maquina, alem da supressao do navegador. Corta teclado, ventilador e ar-condicionado que a nativa deixa passar. Baixa ~1,9 MB na primeira vez e usa mais CPU."
        />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
          Nada do seu audio sai da maquina para isso: o modelo roda no proprio
          navegador. Se ele nao carregar, sua voz continua indo normalmente — so
          sem o filtro.
        </p>

        {tratamento.rnnoise ? (
          <div className="mt-3 rounded-md border border-line bg-base-900 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-200">
                Forca do gate
              </span>
              <span className="font-mono text-[11px] text-ink-500">
                {Math.round(tratamento.forcaRnnoise * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={tratamento.forcaRnnoise}
              onChange={(e) => ajustarForca(Number(e.target.value))}
              className="mt-1.5 w-full accent-[var(--color-accent-500)]"
              aria-label="Forca da supressao de ruido"
            />
            <p className="mt-1 flex justify-between text-[10px] text-ink-500">
              <span>suave (RNNoise puro)</span>
              <span>agressivo</span>
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
              O RNNoise deixa passar barulho impulsivo (teclado, estalo). O gate
              usa a deteccao de voz do proprio modelo para abaixar o som nas
              pausas. Mais forca corta melhor, mas pode engolir o comeco de
              palavras ou um sussurro.
            </p>
          </div>
        ) : null}
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
